use rusqlite::{Connection, params};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use walkdir::WalkDir;

#[derive(Clone, Serialize)]
pub struct FileSearchResult {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    #[serde(skip)]
    pub score: i32,
}

#[derive(Clone, Serialize)]
pub struct IndexStatus {
    pub indexed_count: u64,
    pub last_indexed_at: Option<i64>,
    pub is_indexing: bool,
}

/// 计算文件名与搜索词的相关性得分（越高越相关）
/// path 用于计算路径深度和系统目录降权
fn score_match(file_name: &str, path: &str, query: &str, is_dir: bool) -> i32 {
    let file_lower = file_name.to_lowercase();
    let query_lower = query.to_lowercase();
    let path_lower = path.to_lowercase();
    let mut score = 0;

    let name_without_ext = match file_lower.rfind('.') {
        Some(pos) => &file_lower[..pos],
        None => &file_lower,
    };
    if name_without_ext == query_lower {
        score += 100;
    } else if file_lower == query_lower {
        score += 95;
    } else if name_without_ext.starts_with(&query_lower) {
        score += 80;
    } else if file_lower.starts_with(&query_lower) {
        score += 75;
    }

    let separators = [' ', '_', '-', '.', '/', '\\'];
    if score < 70 {
        if let Some(pos) = file_lower.find(&query_lower) {
            if pos == 0 || file_lower[..pos].chars().last().map_or(false, |c| separators.contains(&c)) {
                score += 60;
            } else {
                score += 40;
            }
        }
    }

    let ext = file_name.rsplit('.').next().unwrap_or("").to_lowercase();
    let exec_exts = ["exe", "bat", "cmd", "com", "msi", "lnk"];
    if exec_exts.contains(&ext.as_str()) {
        score += 35; // 应用程序大幅加分（优先于目录）
    }

    // 目录降权：用户搜 app 名时想找的是可执行文件，不是同名目录
    if is_dir {
        score -= 15;
    }

    // 路径深度惩罚（越靠近根目录的文件通常越重要）
    let depth = path.chars().filter(|c| *c == '\\' || *c == '/').count() as i32;
    if depth > 0 {
        score -= depth.min(5);
    }

    // 系统目录降权（避免系统文件淹没正常搜索结果）
    let sys_paths = ["\\windows\\", "\\program files\\", "\\program files (x86)\\"];
    if sys_paths.iter().any(|&sys| path_lower.contains(sys)) {
        score -= 20;
    }

    score
}

/// 跳过目录的条件（跳过无意义目录、回收站、构建产物等）
/// 注意：不再跳过 Windows / Program Files，以支持系统文件和已安装软件搜索
fn should_skip_dir_name(dir_name: &str) -> bool {
    // 跳过隐藏文件/目录（以 . 开头）
    if dir_name.starts_with('.') {
        return true;
    }

    let skip_dirs = [
        // 回收站和系统卷信息
        "$Recycle.Bin",
        "System Volume Information",
        "Recovery",
        // AppData（用户应用数据，文件量大但对用户无直接意义）
        "AppData",
        // 构建/缓存/依赖目录
        "node_modules",
        "target",
        ".git",
        "__pycache__",
        "vendor",
        ".idea",
        ".vscode",
    ];

    skip_dirs.contains(&dir_name)
}

/// 获取搜索根目录列表
fn get_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if cfg!(windows) {
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            let path = PathBuf::from(&drive);
            if path.exists() {
                roots.push(path);
            }
        }
    } else {
        roots.push(PathBuf::from("/"));
    }

    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let home = PathBuf::from(home);
        let common_dirs = ["Desktop", "Documents", "Downloads"];
        for d in &common_dirs {
            let dir = home.join(d);
            if dir.exists() {
                roots.push(dir);
            }
        }
    }

    roots
}

/// 构建FTS5查询: 将用户输入转为前缀匹配
fn build_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

pub struct FileIndex {
    conn: Mutex<Connection>,
}

impl FileIndex {
    pub fn new(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建数据库目录失败: {}", e))?;
        }

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("打开文件索引数据库失败: {}", e))?;

        // WAL模式提升并发性能
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("设置WAL模式失败: {}", e))?;

        // 性能优化
        conn.execute_batch(
            "PRAGMA synchronous=NORMAL; PRAGMA cache_size=-64000; PRAGMA temp_store=MEMORY;"
        )
        .map_err(|e| format!("设置性能参数失败: {}", e))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn init_tables(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS file_index_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                size INTEGER NOT NULL DEFAULT 0,
                is_dir INTEGER NOT NULL DEFAULT 0,
                indexed_at INTEGER NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS file_index_fts USING fts5(
                name,
                path,
                content='',
                tokenize='unicode61'
            );

            CREATE TABLE IF NOT EXISTS file_access_log (
                path TEXT PRIMARY KEY,
                access_count INTEGER NOT NULL DEFAULT 1,
                last_access_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_file_access_time ON file_access_log(last_access_at DESC);",
        )
        .map_err(|e| format!("创建索引表失败: {}", e))?;

        Ok(())
    }

    /// 获取索引状态
    pub fn get_status(&self) -> Result<IndexStatus, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        let count: u64 = conn
            .query_row("SELECT COUNT(*) FROM file_index_data", [], |row| row.get(0))
            .unwrap_or(0);

        let last_indexed: Option<i64> = conn
            .query_row(
                "SELECT MAX(indexed_at) FROM file_index_data",
                [],
                |row| row.get(0),
            )
            .unwrap_or(None);

        Ok(IndexStatus {
            indexed_count: count,
            last_indexed_at: last_indexed,
            is_indexing: false, // 由外部管理
        })
    }

    /// 构建文件索引（后台线程调用）
    pub fn build_index(
        &self,
        progress_callback: impl Fn(u32, u32, String) + Send + 'static,
    ) -> Result<u64, String> {
        let roots = get_search_roots();
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        // 清空旧索引
        conn.execute_batch(
            "DELETE FROM file_index_data;
             DELETE FROM file_index_fts;",
        )
        .map_err(|e| format!("清空旧索引失败: {}", e))?;

        drop(conn); // 释放锁，让后续操作可以获取

        let mut total_files = 0u64;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let mut batch: Vec<(String, String, u64, bool)> = Vec::with_capacity(5000);
        let mut searched_roots = std::collections::HashSet::new();

        // 先统计总数用于进度（快速预扫）
        let mut total_estimate = 0u32;
        for root in &roots {
            let root_str = root.to_string_lossy().to_string();
            if !searched_roots.insert(root_str) || !root.exists() {
                continue;
            }
            let walker = WalkDir::new(root)
                .follow_links(false)
                .max_depth(20)
                .into_iter()
                .filter_entry(|e| {
                    if e.file_type().is_dir() {
                        !should_skip_dir_name(&e.file_name().to_string_lossy())
                    } else {
                        true
                    }
                });
            for entry in walker {
                if let Ok(entry) = entry {
                    if entry.file_type().is_file() || entry.file_type().is_dir() {
                        total_estimate += 1;
                    }
                }
            }
        }

        // 实际遍历并批量插入
        let mut searched_roots = std::collections::HashSet::new();
        let mut processed = 0u32;

        for root in &roots {
            let root_str = root.to_string_lossy().to_string();
            if !searched_roots.insert(root_str) || !root.exists() {
                continue;
            }

            let walker = WalkDir::new(root)
                .follow_links(false)
                .max_depth(20)
                .into_iter()
                .filter_entry(|e| {
                    if e.file_type().is_dir() {
                        !should_skip_dir_name(&e.file_name().to_string_lossy())
                    } else {
                        true
                    }
                });

            for entry in walker {
                match entry {
                    Ok(entry) => {
                        if !entry.file_type().is_file() && !entry.file_type().is_dir() {
                            continue;
                        }

                        let name = entry.file_name().to_string_lossy().to_string();
                        let path = entry.path().to_string_lossy().to_string();
                        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                        let is_dir = entry.file_type().is_dir();

                        batch.push((name, path, size, is_dir));
                        processed += 1;

                        // 每5000条批量写入
                        if batch.len() >= 5000 {
                            let batch_size = batch.len() as u64;
                            self.insert_batch(&batch, now)?;
                            total_files += batch_size;
                            batch.clear();

                            progress_callback(processed, total_estimate.max(1), "正在索引...".into());
                        }
                    }
                    Err(e) => {
                        if e.depth() == 0 {
                            eprintln!("无法访问目录: {}", e);
                        }
                    }
                }
            }
        }

        // 写入剩余数据
        if !batch.is_empty() {
            let batch_size = batch.len() as u64;
            self.insert_batch(&batch, now)?;
            total_files += batch_size;
        }

        progress_callback(processed, processed, "索引完成".into());

        Ok(total_files)
    }

    /// 批量插入记录到SQLite
    fn insert_batch(&self, batch: &[(String, String, u64, bool)], indexed_at: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        let tx = conn.unchecked_transaction().map_err(|e| format!("开始事务失败: {}", e))?;

        for (name, path, size, is_dir) in batch {
            tx.execute(
                "INSERT OR IGNORE INTO file_index_data (name, path, size, is_dir, indexed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![name, path, *size as i64, *is_dir as i32, indexed_at],
            )
            .map_err(|e| format!("插入索引失败: {}", e))?;

            // 同步插入FTS表
            let rowid = tx.last_insert_rowid();
            if rowid > 0 {
                tx.execute(
                    "INSERT INTO file_index_fts (rowid, name, path) VALUES (?1, ?2, ?3)",
                    params![rowid, name, path],
                )
                .map_err(|e| format!("插入FTS索引失败: {}", e))?;
            }
        }

        tx.commit().map_err(|e| format!("提交事务失败: {}", e))?;

        Ok(())
    }

    /// 从索引中搜索文件
    /// 返回 (结果列表, 总数)
    pub fn search(&self, query: &str, limit: usize, offset: usize) -> Result<(Vec<FileSearchResult>, usize), String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok((vec![], 0));
        }

        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;

        let fts_query = build_fts_query(query);

        // 第一阶段：通过FTS5快速过滤
        let mut stmt = conn
            .prepare(
                "SELECT d.name, d.path, d.size, d.is_dir
                 FROM file_index_fts f
                 JOIN file_index_data d ON f.rowid = d.id
                 WHERE file_index_fts MATCH ?1
                 ORDER BY rank",
            )
            .map_err(|e| format!("准备FTS查询失败: {}", e))?;

        let query_lower = query.to_lowercase();

        // 收集所有匹配结果用于评分和排序
        let mut all_results: Vec<FileSearchResult> = stmt
            .query_map(params![fts_query], |row| {
                Ok(FileSearchResult {
                    name: row.get(0)?,
                    path: row.get(1)?,
                    size: row.get::<_, i64>(2)? as u64,
                    is_dir: row.get::<_, i32>(3)? != 0,
                    score: 0i32,
                })
            })
            .map_err(|e| format!("执行FTS查询失败: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

        // 第二阶段：Rust侧计算相关性得分
        for result in &mut all_results {
            result.score = score_match(&result.name, &result.path, &query_lower, result.is_dir);
        }

        // 第三阶段：结合访问历史调整得分
        let paths: Vec<String> = all_results.iter().map(|r| r.path.clone()).collect();
        if let Ok(access_scores) = self.get_access_scores(&paths) {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            for result in &mut all_results {
                if let Some((count, last_at)) = access_scores.get(&result.path) {
                    // 使用频率加分（每次访问+3分，最多+30分）
                    result.score += (count * 3).min(30) as i32;
                    // 最近访问加分（7天内访问额外+15分，30天内+5分）
                    let days_since = (now - last_at) / 86400;
                    if days_since <= 7 {
                        result.score += 15;
                    } else if days_since <= 30 {
                        result.score += 5;
                    }
                }
            }
        }

        let total = all_results.len();
        all_results.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));

        // 分页
        let results = all_results
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect();

        Ok((results, total))
    }

    /// 清空索引
    pub fn clear_index(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        conn.execute_batch(
            "DELETE FROM file_index_data; DELETE FROM file_index_fts;",
        )
        .map_err(|e| format!("清空索引失败: {}", e))?;
        Ok(())
    }

    /// 记录文件访问历史
    pub fn record_access(&self, path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO file_access_log (path, access_count, last_access_at)
             VALUES (?1, 1, ?2)
             ON CONFLICT(path) DO UPDATE SET
                 access_count = access_count + 1,
                 last_access_at = ?2",
            params![path, now],
        )
        .map_err(|e| format!("记录文件访问失败: {}", e))?;

        Ok(())
    }

    /// 批量获取文件访问分数
    /// 返回 HashMap<path, (access_count, last_access_at)>
    pub fn get_access_scores(&self, paths: &[String]) -> Result<std::collections::HashMap<String, (i64, i64)>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let mut map = std::collections::HashMap::new();

        if paths.is_empty() {
            return Ok(map);
        }

        // 构建 IN 子句参数
        let placeholders: Vec<String> = paths.iter().map(|_| "?".to_string()).collect();
        let sql = format!(
            "SELECT path, access_count, last_access_at FROM file_access_log WHERE path IN ({})",
            placeholders.join(", ")
        );

        let mut stmt = conn.prepare(&sql).map_err(|e| format!("准备访问历史查询失败: {}", e))?;
        let params: Vec<&dyn rusqlite::ToSql> = paths.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
        let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        }).map_err(|e| format!("查询访问历史失败: {}", e))?;

        for row in rows {
            if let Ok((path, count, last_at)) = row {
                map.insert(path, (count, last_at));
            }
        }

        Ok(map)
    }

    /// 检查索引是否可用
    pub fn has_index(&self) -> bool {
        match self.get_status() {
            Ok(status) => status.indexed_count > 0,
            Err(_) => false,
        }
    }

    /// 批量读取所有索引条目（供 MemFileIndex 加载用）
    /// 返回 Vec<(name, path, size, is_dir)>
    pub fn read_all_entries(&self) -> Result<Vec<(String, String, u64, bool)>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let mut stmt = conn
            .prepare("SELECT name, path, size, is_dir FROM file_index_data")
            .map_err(|e| format!("准备查询失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? as u64,
                    row.get::<_, i32>(3)? != 0,
                ))
            })
            .map_err(|e| format!("查询失败: {}", e))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.map_err(|e| format!("读取行失败: {}", e))?);
        }
        Ok(entries)
    }

    /// 批量读取所有访问记录（供 MemFileIndex 加载用）
    pub fn read_all_access_scores(
        &self,
    ) -> Result<std::collections::HashMap<String, (i64, i64)>, String> {
        let conn = self.conn.lock().map_err(|e| format!("获取锁失败: {}", e))?;
        let mut stmt = conn
            .prepare("SELECT path, access_count, last_access_at FROM file_access_log")
            .map_err(|e| format!("准备查询失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| format!("查询失败: {}", e))?;

        let mut map = std::collections::HashMap::new();
        for row in rows {
            let (path, count, last_at) = row.map_err(|e| format!("读取行失败: {}", e))?;
            map.insert(path, (count, last_at));
        }
        Ok(map)
    }
}
