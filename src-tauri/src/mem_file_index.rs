use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use crate::file_index::{FileIndex, FileSearchResult};

/// 内存中的文件条目（预计算 name_lower 避免搜索时重复 to_lowercase）
#[derive(Clone)]
pub struct FileEntry {
    pub name: String,
    pub name_lower: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
}

/// 纯内存文件索引 — Listary 风格的高速搜索
/// SQLite 仅用于持久化，搜索完全在 Vec + HashMap 中完成，零磁盘 I/O
pub struct MemFileIndex {
    entries: RwLock<Vec<FileEntry>>,
    access_scores: RwLock<HashMap<String, (i64, i64)>>, // path -> (access_count, last_access_at)
    is_ready: AtomicBool,
    is_building: AtomicBool,
}

impl MemFileIndex {
    pub fn new() -> Self {
        Self {
            entries: RwLock::new(Vec::new()),
            access_scores: RwLock::new(HashMap::new()),
            is_ready: AtomicBool::new(false),
            is_building: AtomicBool::new(false),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.is_ready.load(Ordering::Acquire)
    }

    /// 尝试获取构建锁，返回 true 表示成功获取并开始构建
    pub fn try_start_build(&self) -> bool {
        self.is_building.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_ok()
    }

    /// 释放构建锁
    pub fn finish_build(&self) {
        self.is_building.store(false, Ordering::Release);
    }

    /// 从 SQLite 批量加载所有文件条目和访问记录到内存
    pub fn load_from_sqlite(&self, fi: &FileIndex) -> Result<(), String> {
        // 加载文件条目
        let raw_entries = fi.read_all_entries()?;
        let entries: Vec<FileEntry> = raw_entries
            .into_iter()
            .map(|(name, path, size, is_dir)| FileEntry {
                name_lower: name.to_lowercase(),
                name,
                path,
                size,
                is_dir,
            })
            .collect();

        let count = entries.len();
        {
            let mut e = self.entries.write().map_err(|e| format!("获取写锁失败: {}", e))?;
            *e = entries;
        }

        // 加载访问记录
        let scores = fi.read_all_access_scores()?;
        {
            let mut s = self.access_scores.write().map_err(|e| format!("获取写锁失败: {}", e))?;
            *s = scores;
        }

        self.is_ready.store(true, Ordering::Release);
        println!("[MemFileIndex] 已从 SQLite 加载 {} 个文件到内存", count);
        Ok(())
    }

    /// 索引重建后重新从 SQLite 同步
    pub fn sync_from_sqlite(&self, fi: &FileIndex) -> Result<(), String> {
        self.is_ready.store(false, Ordering::Release);
        self.load_from_sqlite(fi)
    }

    /// 纯内存搜索 — 零磁盘 I/O
    /// 返回 Vec<FileSearchResult>（不含排序，由调用方处理）
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<FileSearchResult>, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }

        let query_lower = query.to_lowercase();

        let entries = self.entries.read().map_err(|e| format!("获取读锁失败: {}", e))?;
        let scores = self.access_scores.read().map_err(|e| format!("获取读锁失败: {}", e))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        // 第一阶段：过滤 + 打分（单次遍历）
        let mut results: Vec<FileSearchResult> = entries
            .iter()
            .filter(|e| e.name_lower.contains(&query_lower))
            .map(|e| {
                let mut score = score_match_mem(&e.name_lower, &e.path, &query_lower, e.is_dir);

                // 访问历史加权（从内存 HashMap 直接查）
                if let Some(&(count, last_at)) = scores.get(&e.path) {
                    score += (count * 3).min(30) as i32;
                    let days_since = (now - last_at) / 86400;
                    if days_since <= 7 {
                        score += 15;
                    } else if days_since <= 30 {
                        score += 5;
                    }
                }

                FileSearchResult {
                    name: e.name.clone(),
                    path: e.path.clone(),
                    size: e.size,
                    is_dir: e.is_dir,
                    score,
                }
            })
            .collect();

        // 第二阶段：排序 + 截断
        results.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));
        results.truncate(limit);

        Ok(results)
    }

    /// 记录文件访问（更新内存 + 异步写 SQLite）
    pub fn record_access(&self, path: &str, fi: Option<&Arc<FileIndex>>) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        // 更新内存
        if let Ok(mut scores) = self.access_scores.write() {
            if let Some((count, _)) = scores.get_mut(path) {
                *count += 1;
            } else {
                scores.insert(path.to_string(), (1, now));
            }
            // 同步更新 last_access_at
            if let Some(entry) = scores.get_mut(path) {
                entry.1 = now;
            }
        }

        // 异步写 SQLite
        if let Some(fi) = fi {
            let path = path.to_string();
            let fi = fi.clone();
            std::thread::spawn(move || {
                let _ = fi.record_access(&path);
            });
        }
    }
}

// ===== 以下是从 file_index.rs 复制的评分函数（纯内存版本） =====

/// 计算文件名与搜索词的相关性得分（越高越相关）
fn score_match_mem(name_lower: &str, path: &str, query_lower: &str, is_dir: bool) -> i32 {
    let path_lower = path.to_lowercase();
    let mut score = 0;

    let name_without_ext = match name_lower.rfind('.') {
        Some(pos) => &name_lower[..pos],
        None => name_lower,
    };
    if name_without_ext == query_lower {
        score += 100;
    } else if name_lower == query_lower {
        score += 95;
    } else if name_without_ext.starts_with(query_lower) {
        score += 80;
    } else if name_lower.starts_with(query_lower) {
        score += 75;
    }

    let separators = [' ', '_', '-', '.', '/', '\\'];
    if score < 70 {
        if let Some(pos) = name_lower.find(query_lower) {
            if pos == 0
                || name_lower[..pos]
                    .chars()
                    .last()
                    .map_or(false, |c| separators.contains(&c))
            {
                score += 60;
            } else {
                score += 40;
            }
        }
    }

    let ext = name_lower.rsplit('.').next().unwrap_or("").to_lowercase();
    let exec_exts = ["exe", "bat", "cmd", "com", "msi", "lnk"];
    if exec_exts.contains(&ext.as_str()) {
        score += 35; // 应用程序大幅加分（优先于目录）
    }

    // 目录降权：用户搜 app 名时想找的是可执行文件，不是同名目录
    if is_dir {
        score -= 15;
    }

    let depth = path_lower.chars().filter(|c| *c == '\\' || *c == '/').count() as i32;
    if depth > 0 {
        score -= depth.min(5);
    }

    let sys_paths = ["\\windows\\", "\\program files\\", "\\program files (x86)\\"];
    if sys_paths.iter().any(|&sys| path_lower.contains(sys)) {
        score -= 20;
    }

    score
}
