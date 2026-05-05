use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::calendar::{TodoItem, TodoPriority, CalendarEvent};
use crate::clipboard::ClipboardItem;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建数据库目录失败: {}", e))?;
        }

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("打开数据库失败: {}", e))?;

        // WAL模式提升并发性能
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("设置WAL模式失败: {}", e))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn init_tables(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS configs (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                content TEXT NOT NULL,
                completed INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                priority TEXT,
                category TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_todos_date ON todos(date);

            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                start_time INTEGER,
                end_time INTEGER,
                all_day INTEGER NOT NULL DEFAULT 0,
                color TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

            CREATE TABLE IF NOT EXISTS clipboard_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            );
        ",
        )
        .map_err(|e| format!("创建表失败: {}", e))?;

        Ok(())
    }

    // ==================== Config 通用方法 ====================

    pub fn set_config(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO configs (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, now],
        )
        .map_err(|e| format!("保存配置失败: {}", e))?;

        Ok(())
    }

    pub fn get_config(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        let mut stmt = conn
            .prepare("SELECT value FROM configs WHERE key = ?1")
            .map_err(|e| format!("准备查询失败: {}", e))?;

        match stmt.query_row(params![key], |row| row.get::<_, String>(0)) {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("读取配置失败: {}", e)),
        }
    }

    pub fn delete_config(&self, key: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        conn.execute("DELETE FROM configs WHERE key = ?1", params![key])
            .map_err(|e| format!("删除配置失败: {}", e))?;
        Ok(())
    }

    // ==================== Todo 方法 ====================

    pub fn get_todos_by_date(&self, date: &str) -> Result<Vec<TodoItem>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, content, completed, created_at, priority, category 
                 FROM todos WHERE date = ?1 ORDER BY created_at",
            )
            .map_err(|e| format!("准备查询失败: {}", e))?;

        let todos = stmt
            .query_map(params![date], |row| {
                let priority_str: Option<String> = row.get(4)?;
                let priority = priority_str.and_then(|p| match p.as_str() {
                    "Low" => Some(TodoPriority::Low),
                    "Medium" => Some(TodoPriority::Medium),
                    "High" => Some(TodoPriority::High),
                    _ => None,
                });

                Ok(TodoItem {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    completed: row.get::<_, i32>(2)? != 0,
                    created_at: row.get(3)?,
                    priority,
                    category: row.get(5)?,
                })
            })
            .map_err(|e| format!("查询待办失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(todos)
    }

    pub fn save_todos_for_date(&self, date: &str, todos: &[TodoItem]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("开始事务失败: {}", e))?;

        tx.execute("DELETE FROM todos WHERE date = ?1", params![date])
            .map_err(|e| format!("删除旧待办失败: {}", e))?;

        for todo in todos {
            let priority_str = todo.priority.as_ref().map(|p| match p {
                TodoPriority::Low => "Low",
                TodoPriority::Medium => "Medium",
                TodoPriority::High => "High",
            });

            tx.execute(
                "INSERT INTO todos (id, date, content, completed, created_at, priority, category) 
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    todo.id,
                    date,
                    todo.content,
                    todo.completed as i32,
                    todo.created_at,
                    priority_str,
                    todo.category,
                ],
            )
            .map_err(|e| format!("插入待办失败: {}", e))?;
        }

        tx.commit().map_err(|e| format!("提交事务失败: {}", e))?;
        Ok(())
    }

    // ==================== Event 方法 ====================

    pub fn get_events_by_date(&self, date: &str) -> Result<Vec<CalendarEvent>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, title, description, start_time, end_time, all_day, color 
                 FROM events WHERE date = ?1 ORDER BY start_time",
            )
            .map_err(|e| format!("准备查询失败: {}", e))?;

        let events = stmt
            .query_map(params![date], |row| {
                Ok(CalendarEvent {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    description: row.get(2)?,
                    start_time: row.get(3)?,
                    end_time: row.get(4)?,
                    all_day: row.get::<_, i32>(5)? != 0,
                    color: row.get(6)?,
                })
            })
            .map_err(|e| format!("查询事件失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(events)
    }

    pub fn save_events_for_date(&self, date: &str, events: &[CalendarEvent]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| format!("开始事务失败: {}", e))?;

        tx.execute("DELETE FROM events WHERE date = ?1", params![date])
            .map_err(|e| format!("删除旧事件失败: {}", e))?;

        for event in events {
            tx.execute(
                "INSERT INTO events (id, date, title, description, start_time, end_time, all_day, color) 
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    event.id,
                    date,
                    event.title,
                    event.description,
                    event.start_time,
                    event.end_time,
                    event.all_day as i32,
                    event.color,
                ],
            )
            .map_err(|e| format!("插入事件失败: {}", e))?;
        }

        tx.commit().map_err(|e| format!("提交事务失败: {}", e))?;
        Ok(())
    }

    // ==================== 剪贴板历史方法 ====================

    pub fn get_clipboard_history(&self) -> Result<Vec<ClipboardItem>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, content, timestamp FROM clipboard_history 
                 ORDER BY timestamp DESC LIMIT 50",
            )
            .map_err(|e| format!("准备查询失败: {}", e))?;

        let items = stmt
            .query_map([], |row| {
                Ok(ClipboardItem {
                    id: row.get::<_, i64>(0)? as usize,
                    content: row.get(1)?,
                    timestamp: row.get(2)?,
                })
            })
            .map_err(|e| format!("查询剪贴板历史失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(items)
    }

    pub fn add_clipboard_item(&self, item: &ClipboardItem) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        conn.execute(
            "INSERT INTO clipboard_history (content, timestamp) VALUES (?1, ?2)",
            params![item.content, item.timestamp],
        )
        .map_err(|e| format!("添加剪贴板记录失败: {}", e))?;

        Ok(())
    }

    pub fn clear_clipboard_history(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        conn.execute("DELETE FROM clipboard_history", [])
            .map_err(|e| format!("清空剪贴板历史失败: {}", e))?;
        Ok(())
    }

    // ==================== 地图绘制数据方法 ====================

    pub fn save_map(&self, name: &str, data: &str) -> Result<(), String> {
        let key = format!("map_drawing:{}", name);
        self.set_config(&key, data)
    }

    pub fn get_map(&self, name: &str) -> Result<Option<String>, String> {
        let key = format!("map_drawing:{}", name);
        self.get_config(&key)
    }

    pub fn delete_map(&self, name: &str) -> Result<(), String> {
        let key = format!("map_drawing:{}", name);
        self.delete_config(&key)
    }

    pub fn list_map_names(&self) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let prefix = "map_drawing:";
        let mut stmt = conn
            .prepare("SELECT key FROM configs WHERE key LIKE ?1 ORDER BY updated_at DESC")
            .map_err(|e| format!("准备查询失败: {}", e))?;

        let names = stmt
            .query_map(rusqlite::params![format!("{}%", prefix)], |row| {
                let key: String = row.get(0)?;
                Ok(key.replacen(prefix, "", 1))
            })
            .map_err(|e| format!("查询地图列表失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(names)
    }

    // ==================== 数据迁移（从旧JSON文件） ====================

    pub fn migrate_from_json(&self, app: &AppHandle) -> Result<(), String> {
        use std::io::Read;

        // 如果已经迁移过则跳过
        if self.get_config("_migrated")?.is_some() {
            return Ok(());
        }

        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

        // 迁移 AI 配置 (deepseek_config.json)
        let ai_path = app_data_dir.join("deepseek_config.json");
        if ai_path.exists() {
            if let Ok(mut file) = std::fs::File::open(&ai_path) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok()
                    && !content.trim().is_empty()
                {
                    self.set_config("ai_config", &content).ok();
                }
            }
        }

        // 迁移 AI 配置 (ai_config.json - jira模块中的重复配置)
        let ai_config_path = app_data_dir.join("ai_config.json");
        if ai_config_path.exists() {
            if let Ok(mut file) = std::fs::File::open(&ai_config_path) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok()
                    && !content.trim().is_empty()
                {
                    if self.get_config("ai_config")?.is_none() {
                        self.set_config("ai_config", &content).ok();
                    }
                }
            }
        }

        // 迁移有道翻译配置
        let youdao_path = app_data_dir.join("youdao_config.json");
        if youdao_path.exists() {
            if let Ok(mut file) = std::fs::File::open(&youdao_path) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok()
                    && !content.trim().is_empty()
                {
                    self.set_config("youdao_config", &content).ok();
                }
            }
        }

        // 迁移 JIRA 配置
        let jira_path = app_data_dir.join("jira_config.json");
        if jira_path.exists() {
            if let Ok(mut file) = std::fs::File::open(&jira_path) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok()
                    && !content.trim().is_empty()
                {
                    self.set_config("jira_config", &content).ok();
                }
            }
        }

        // 迁移 Git 配置
        let git_path = app_data_dir.join("git_config.json");
        if git_path.exists() {
            if let Ok(mut file) = std::fs::File::open(&git_path) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok()
                    && !content.trim().is_empty()
                {
                    self.set_config("git_config", &content).ok();
                }
            }
        }

        // 迁移日历设置
        let cal_settings_path = app_data_dir.join("calendar_settings.json");
        if cal_settings_path.exists() {
            if let Ok(mut file) = std::fs::File::open(&cal_settings_path) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok()
                    && !content.trim().is_empty()
                {
                    self.set_config("calendar_settings", &content).ok();
                }
            }
        }

        // 迁移待办事项 (HashMap<String, Vec<TodoItem>> 格式)
        let todos_path = app_data_dir.join("todos.json");
        if todos_path.exists() {
            if let Ok(mut file) = std::fs::File::open(&todos_path) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok()
                    && !content.trim().is_empty()
                {
                    if let Ok(all_todos) = serde_json::from_str::<
                        std::collections::HashMap<String, Vec<TodoItem>>,
                    >(&content)
                    {
                        for (date, todos) in all_todos {
                            self.save_todos_for_date(&date, &todos).ok();
                        }
                    }
                }
            }
        }

        // 迁移日历事件 (HashMap<String, Vec<CalendarEvent>> 格式)
        let events_path = app_data_dir.join("events.json");
        if events_path.exists() {
            if let Ok(mut file) = std::fs::File::open(&events_path) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok()
                    && !content.trim().is_empty()
                {
                    if let Ok(all_events) = serde_json::from_str::<
                        std::collections::HashMap<String, Vec<CalendarEvent>>,
                    >(&content)
                    {
                        for (date, events) in all_events {
                            self.save_events_for_date(&date, &events).ok();
                        }
                    }
                }
            }
        }

        // 标记迁移完成
        self.set_config("_migrated", "true")?;

        Ok(())
    }
}
