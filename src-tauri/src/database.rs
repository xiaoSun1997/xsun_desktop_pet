use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::calendar::{TodoItem, TodoPriority, CalendarEvent};
use crate::clipboard::ClipboardItem;

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_pinned: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub struct ChatMessageRecord {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

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
                content_type TEXT NOT NULL DEFAULT 'text',
                timestamp INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_clipboard_timestamp ON clipboard_history(timestamp DESC);

            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '新对话',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);

            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, timestamp);
        ",
        )
        .map_err(|e| format!("创建表失败: {}", e))?;

        // 迁移: 如果旧的clipboard_history没有content_type列, 添加它
        let has_content_type: bool = conn
            .prepare("PRAGMA table_info(clipboard_history)")
            .map_err(|e| format!("检查表结构失败: {}", e))?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("查询列信息失败: {}", e))?
            .filter_map(|r| r.ok())
            .any(|name| name == "content_type");

        if !has_content_type {
            conn.execute_batch(
                "ALTER TABLE clipboard_history ADD COLUMN content_type TEXT NOT NULL DEFAULT 'text';"
            )
            .map_err(|e| format!("迁移clipboard_history表失败: {}", e))?;
            println!("迁移: 已为clipboard_history添加content_type列");
        }

        // 迁移: 如果旧的chat_sessions没有is_pinned列, 添加它
        let has_is_pinned: bool = conn
            .prepare("PRAGMA table_info(chat_sessions)")
            .map_err(|e| format!("检查表结构失败: {}", e))?
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("查询列信息失败: {}", e))?
            .filter_map(|r| r.ok())
            .any(|name| name == "is_pinned");

        if !has_is_pinned {
            conn.execute_batch(
                "ALTER TABLE chat_sessions ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;"
            )
            .map_err(|e| format!("迁移chat_sessions表失败: {}", e))?;
            println!("迁移: 已为chat_sessions添加is_pinned列");
        }

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
                "SELECT id, content, content_type, timestamp FROM clipboard_history 
                 ORDER BY timestamp DESC LIMIT 10",
            )
            .map_err(|e| format!("准备查询失败: {}", e))?;

        let items = stmt
            .query_map([], |row| {
                Ok(ClipboardItem {
                    id: row.get::<_, i64>(0)? as usize,
                    content: row.get(1)?,
                    content_type: row.get(2)?,
                    timestamp: row.get(3)?,
                })
            })
            .map_err(|e| format!("查询剪贴板历史失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(items)
    }

    pub fn get_clipboard_history_paginated(&self, page: usize, page_size: usize) -> Result<Vec<ClipboardItem>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let offset = (page.saturating_sub(1)) * page_size;

        let mut stmt = conn
            .prepare(
                "SELECT id, content, content_type, timestamp FROM clipboard_history 
                 ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2",
            )
            .map_err(|e| format!("准备查询失败: {}", e))?;

        let items = stmt
            .query_map(params![page_size as i64, offset as i64], |row| {
                Ok(ClipboardItem {
                    id: row.get::<_, i64>(0)? as usize,
                    content: row.get(1)?,
                    content_type: row.get(2)?,
                    timestamp: row.get(3)?,
                })
            })
            .map_err(|e| format!("查询剪贴板历史失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(items)
    }

    pub fn delete_clipboard_item(&self, id: usize) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        conn.execute(
            "DELETE FROM clipboard_history WHERE id = ?1",
            params![id as i64],
        )
        .map_err(|e| format!("删除剪贴板记录失败: {}", e))?;
        Ok(())
    }

    pub fn cleanup_old_clipboard_items(&self, days: i64) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            - (days * 86400);

        let deleted = conn
            .execute("DELETE FROM clipboard_history WHERE timestamp < ?1", params![cutoff])
            .map_err(|e| format!("清理旧剪贴板记录失败: {}", e))?;

        Ok(deleted)
    }

    pub fn add_clipboard_item(&self, item: &ClipboardItem) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        conn.execute(
            "INSERT INTO clipboard_history (content, content_type, timestamp) VALUES (?1, ?2, ?3)",
            params![item.content, item.content_type, item.timestamp],
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

    // ==================== 对话历史方法 ====================

    pub fn create_chat_session(&self, title: &str) -> Result<String, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let id = Uuid::new_v4().to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, title, now, now],
        )
        .map_err(|e| format!("创建对话会话失败: {}", e))?;

        Ok(id)
    }

    pub fn get_chat_sessions(&self) -> Result<Vec<ChatSession>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, title, created_at, updated_at, is_pinned FROM chat_sessions ORDER BY is_pinned DESC, updated_at DESC",
            )
            .map_err(|e| format!("准备查询失败: {}", e))?;

        let sessions = stmt
            .query_map([], |row| {
                Ok(ChatSession {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    is_pinned: row.get::<_, i32>(4)? != 0,
                })
            })
            .map_err(|e| format!("查询对话会话失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(sessions)
    }

    pub fn get_chat_session(&self, id: &str) -> Result<Option<ChatSession>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        let mut stmt = conn
            .prepare("SELECT id, title, created_at, updated_at, is_pinned FROM chat_sessions WHERE id = ?1")
            .map_err(|e| format!("准备查询失败: {}", e))?;

        match stmt.query_row(params![id], |row| {
            Ok(ChatSession {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                is_pinned: row.get::<_, i32>(4)? != 0,
            })
        }) {
            Ok(session) => Ok(Some(session)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("查询对话会话失败: {}", e)),
        }
    }

    pub fn delete_chat_session(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        // 先删除会话下的所有消息
        conn.execute("DELETE FROM chat_messages WHERE session_id = ?1", params![id])
            .map_err(|e| format!("删除对话消息失败: {}", e))?;
        // 再删除会话本身
        conn.execute("DELETE FROM chat_sessions WHERE id = ?1", params![id])
            .map_err(|e| format!("删除对话会话失败: {}", e))?;
        Ok(())
    }

    pub fn update_chat_session_title(&self, id: &str, title: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        conn.execute(
            "UPDATE chat_sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now, id],
        )
        .map_err(|e| format!("更新对话标题失败: {}", e))?;
        Ok(())
    }

    pub fn add_chat_message(&self, session_id: &str, role: &str, content: &str) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        // 插入消息
        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, timestamp) VALUES (?1, ?2, ?3, ?4)",
            params![session_id, role, content, now],
        )
        .map_err(|e| format!("添加对话消息失败: {}", e))?;

        let message_id = conn.last_insert_rowid();

        // 更新会话的更新时间
        conn.execute(
            "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )
        .map_err(|e| format!("更新会话时间失败: {}", e))?;

        Ok(message_id)
    }

    pub fn get_chat_messages(&self, session_id: &str) -> Result<Vec<ChatMessageRecord>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, timestamp FROM chat_messages 
                 WHERE session_id = ?1 ORDER BY timestamp ASC",
            )
            .map_err(|e| format!("准备查询失败: {}", e))?;

        let messages = stmt
            .query_map(params![session_id], |row| {
                Ok(ChatMessageRecord {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    timestamp: row.get(4)?,
                })
            })
            .map_err(|e| format!("查询对话消息失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(messages)
    }

    pub fn update_chat_session_timestamp(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        conn.execute(
            "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(|e| format!("更新会话时间失败: {}", e))?;
        Ok(())
    }

    pub fn toggle_chat_session_pin(&self, id: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        // 先查询当前状态
        let current: bool = conn
            .query_row(
                "SELECT is_pinned FROM chat_sessions WHERE id = ?1",
                params![id],
                |row| row.get::<_, i32>(0).map(|v| v != 0),
            )
            .map_err(|e| format!("查询置顶状态失败: {}", e))?;
        let new_value = !current;
        conn.execute(
            "UPDATE chat_sessions SET is_pinned = ?1 WHERE id = ?2",
            params![new_value as i32, id],
        )
        .map_err(|e| format!("更新置顶状态失败: {}", e))?;
        Ok(new_value)
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
        // 启动时清理超过7天的剪贴板记录
        match self.cleanup_old_clipboard_items(7) {
            Ok(count) => {
                if count > 0 {
                    println!("自动清理了 {} 条过期剪贴板记录(>7天)", count);
                }
            }
            Err(e) => eprintln!("清理过期剪贴板记录失败: {}", e),
        }

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
