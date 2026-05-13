use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

use crate::file_index::{FileIndex, FileSearchResult};
use crate::mem_file_index::MemFileIndex;

use std::sync::Arc;

/// 计算文件名与搜索词的相关性得分（越高越相关）
/// path 用于计算路径深度和系统目录降权
fn score_match(file_name: &str, path: &str, query: &str) -> i32 {
    let file_lower = file_name.to_lowercase();
    let query_lower = query.to_lowercase();
    let path_lower = path.to_lowercase();
    let mut score = 0;

    // 完全匹配（不含扩展名） → 最高优先级
    let name_without_ext = match file_lower.rfind('.') {
        Some(pos) => &file_lower[..pos],
        None => &file_lower,
    };
    if name_without_ext == query_lower {
        score += 100;
    } else if file_lower == query_lower {
        // 含扩展名的完全匹配
        score += 95;
    } else if name_without_ext.starts_with(&query_lower) {
        // 文件名（去扩展名）以搜索词开头
        score += 80;
    } else if file_lower.starts_with(&query_lower) {
        // 含扩展名以搜索词开头
        score += 75;
    }

    // 词边界匹配：搜索词出现在分隔符之后
    let separators = [' ', '_', '-', '.', '/', '\\'];
    if score < 70 {
        if let Some(pos) = file_lower.find(&query_lower) {
            if pos == 0 || file_lower[..pos].chars().last().map_or(false, |c| separators.contains(&c)) {
                score += 60;
            } else {
                // 简单包含
                score += 40;
            }
        }
    }

    // 可执行文件加分（搜索词大概率在找程序）
    let ext = file_name.rsplit('.').next().unwrap_or("").to_lowercase();
    let exec_exts = ["exe", "bat", "cmd", "com", "msi", "lnk"];
    if exec_exts.contains(&ext.as_str()) {
        score += 15;
    }

    // 路径深度惩罚（越靠近根目录的文件通常越重要）
    let depth = path.chars().filter(|c| *c == '\\' || *c == '/').count() as i32;
    if depth > 0 {
        score -= depth.min(5); // 最多减5分
    }

    // 系统目录降权（避免系统文件淹没正常搜索结果）
    let sys_paths = ["\\windows\\", "\\program files\\", "\\program files (x86)\\"];
    if sys_paths.iter().any(|&sys| path_lower.contains(sys)) {
        score -= 20;
    }

    score
}

const MAX_RESULTS: usize = 5000;
const BATCH_SIZE: usize = 50;

/// 获取搜索根目录列表
fn get_search_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    // 获取所有驱动器根目录 (Windows)
    if cfg!(windows) {
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            let path = PathBuf::from(&drive);
            if path.exists() {
                roots.push(path);
            }
        }
    } else {
        // Linux/macOS: 从根目录开始
        roots.push(PathBuf::from("/"));
    }

    // 用户常用目录（优先搜索）
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

/// 跳过目录的条件（跳过无意义目录、回收站、构建产物等）
/// 注意：降级搜索必须跳过 Windows/Program Files 以避免遍历整个系统盘
/// （完整索引器在 file_index.rs 中有独立规则，仍会索引这些目录）
fn should_skip_dir(entry: &walkdir::DirEntry) -> bool {
    let file_name = entry.file_name().to_string_lossy();

    // 跳过隐藏文件/目录（以 . 开头）
    if file_name.starts_with('.') {
        return true;
    }

    // 跳过真正无意义的目录
    let skip_dirs = [
        // 回收站和系统卷信息
        "$Recycle.Bin",
        "System Volume Information",
        "Recovery",
        // Windows 系统目录（文件量极大，降级搜索必须排除）
        "Windows",
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

    if skip_dirs.contains(&file_name.as_ref()) {
        return true;
    }

    // 跳过 Program Files 目录（包括 x86 版本）
    let pf_lower = file_name.to_lowercase();
    if pf_lower == "program files" || pf_lower == "program files (x86)" {
        return true;
    }

    false
}

/// 判断是否跳过
fn should_skip(entry: &walkdir::DirEntry) -> bool {
    if entry.file_type().is_dir() {
        return should_skip_dir(entry);
    }
    false
}

/// 搜索文件（优先使用内存索引，降级为 SQLite FTS5 / WalkDir）
#[tauri::command]
pub fn search_files(
    app: AppHandle,
    file_index: State<Arc<FileIndex>>,
    mem_index: State<Arc<MemFileIndex>>,
    query: String,
) -> Result<(), String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        app.emit("file-search://done", "").map_err(|e| e.to_string())?;
        return Ok(());
    }

    let fi = file_index.inner().clone();
    let mi = mem_index.inner().clone();

    // 优先使用内存索引（零磁盘 I/O）
    if mi.is_ready() {
        return search_with_mem_index(app, mi, query);
    }

    // 降级：检查 SQLite 索引是否可用
    if fi.has_index() {
        return search_with_index(app, fi.clone(), query);
    }

    // 最终降级：使用WalkDir遍历（同时触发后台建索引）
    let fi_clone = fi.clone();
    std::thread::spawn(move || {
        if !fi_clone.has_index() {
            let _ = fi_clone.build_index(|_current, _total, _msg| {
                // 后台建索引，不发送进度事件
            });
            println!("后台文件索引构建完成");
        }
    });

    search_fallback_with_walkdir(app, query)
}

/// 使用内存索引搜索（零磁盘 I/O，毫秒级响应）
fn search_with_mem_index(app: AppHandle, mi: Arc<MemFileIndex>, query: String) -> Result<(), String> {
    std::thread::spawn(move || {
        match mi.search(&query, 50) {
            Ok(results) => {
                let _ = app.emit("file-search://result", results);
                let _ = app.emit("file-search://done", "");
            }
            Err(e) => {
                eprintln!("内存索引搜索失败: {}", e);
                let _ = app.emit("file-search://done", "");
            }
        }
    });

    Ok(())
}

/// 使用FTS5索引搜索
fn search_with_index(app: AppHandle, fi: Arc<FileIndex>, query: String) -> Result<(), String> {
    std::thread::spawn(move || {
        match fi.search(&query, 50, 0) {
            Ok((results, _total)) => {
                let _ = app.emit("file-search://result", results);
                let _ = app.emit("file-search://done", "");
            }
            Err(e) => {
                eprintln!("索引搜索失败: {}", e);
                let _ = app.emit("file-search://done", "");
            }
        }
    });

    Ok(())
}

/// 降级方案：使用WalkDir遍历
fn search_fallback_with_walkdir(app: AppHandle, query: String) -> Result<(), String> {
    let query_lower = query.to_lowercase();

    // 在独立线程中执行阻塞的 IO 操作
    std::thread::spawn(move || {
        let roots = get_search_roots();
        let mut results: Vec<FileSearchResult> = Vec::new();
        let mut searched_roots = std::collections::HashSet::new();

        for root in &roots {
            let root_str = root.to_string_lossy().to_string();
            if !searched_roots.insert(root_str.clone()) {
                continue;
            }

            if !root.exists() {
                continue;
            }

            let walker = WalkDir::new(root)
                .follow_links(false)
                .max_depth(20)
                .into_iter()
                .filter_entry(|e| !should_skip(e));

            for entry in walker {
                if results.len() >= MAX_RESULTS {
                    break;
                }

                match entry {
                    Ok(entry) => {
                        let name = entry.file_name().to_string_lossy().to_lowercase();
                        if name.contains(&query_lower) {
                            let file_name = entry.file_name().to_string_lossy().to_string();
                            let file_path = entry.path().to_string_lossy().to_string();
                            let metadata = entry.metadata().ok();
                            let score = score_match(&file_name, &file_path, &query_lower);
                            results.push(FileSearchResult {
                                name: file_name,
                                path: file_path,
                                size: metadata.as_ref().map(|m| m.len()).unwrap_or(0),
                                is_dir: entry.file_type().is_dir(),
                                score,
                            });
                        }
                    }
                    Err(e) => {
                        if e.depth() == 0 {
                            eprintln!("无法访问目录 {}: {}", root_str, e);
                        }
                    }
                }
            }

            if results.len() >= MAX_RESULTS {
                break;
            }
        }

        // 按相关性得分降序排列，然后将结果分批推送
        results.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.name.cmp(&b.name)));

        for batch_start in (0..results.len()).step_by(BATCH_SIZE) {
            let batch_end = (batch_start + BATCH_SIZE).min(results.len());
            let batch = results[batch_start..batch_end].to_vec();
            let _ = app.emit("file-search://result", batch);
        }

        let _ = app.emit("file-search://done", "");
    });

    Ok(())
}

/// 加载更多搜索结果（内存索引模式）
#[tauri::command]
pub fn search_files_load_more(
    app: AppHandle,
    file_index: State<Arc<FileIndex>>,
    mem_index: State<Arc<MemFileIndex>>,
    query: String,
    offset: usize,
) -> Result<(), String> {
    let query = query.trim().to_string();
    let mi = mem_index.inner().clone();
    let fi = file_index.inner().clone();

    if query.is_empty() {
        app.emit("file-search://more-done", "").map_err(|e| e.to_string())?;
        return Ok(());
    }

    // 优先使用内存索引
    if mi.is_ready() {
        let limit = 50;
        std::thread::spawn(move || {
            match mi.search(&query, offset + limit) {
                Ok(results) => {
                    let more = results.into_iter().skip(offset).take(limit).collect::<Vec<_>>();
                    if more.is_empty() {
                        let _ = app.emit("file-search://more-done", "");
                    } else {
                        let _ = app.emit("file-search://result", more);
                    }
                }
                Err(e) => {
                    eprintln!("内存索引加载更多失败: {}", e);
                    let _ = app.emit("file-search://more-done", "");
                }
            }
        });
        return Ok(());
    }

    // 降级：SQLite 索引
    if !fi.has_index() {
        app.emit("file-search://more-done", "").map_err(|e| e.to_string())?;
        return Ok(());
    }

    std::thread::spawn(move || {
        match fi.search(&query, 50, offset) {
            Ok((results, _total)) => {
                if results.is_empty() {
                    let _ = app.emit("file-search://more-done", "");
                } else {
                    let _ = app.emit("file-search://result", results);
                }
            }
            Err(e) => {
                eprintln!("加载更多失败: {}", e);
                let _ = app.emit("file-search://more-done", "");
            }
        }
    });

    Ok(())
}

/// 构建文件索引
#[tauri::command]
pub fn build_file_index(
    app: AppHandle,
    file_index: State<Arc<FileIndex>>,
    mem_index: State<Arc<MemFileIndex>>,
) -> Result<(), String> {
    let fi = file_index.inner().clone();
    let mi = mem_index.inner().clone();

    // 防止并发构建
    if !mi.try_start_build() {
        return Ok(()); // 已有构建任务在进行中
    }

    let app_clone = app.clone();

    // 先发送开始事件（不等待，避免阻塞 invoke 返回）
    let _ = app.emit("file-index://status", serde_json::json!({
        "phase": "building",
        "message": "正在扫描文件..."
    }));

    std::thread::spawn(move || {
        let app_for_progress = app_clone.clone();

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            fi.build_index(move |current, total, msg| {
                let _ = app_for_progress.emit("file-index://progress", serde_json::json!({
                    "current": current,
                    "total": total,
                    "message": msg
                }));
            })
        }));

        match result {
            Ok(Ok(count)) => {
                // 索引构建成功后同步到内存索引
                if let Err(e) = mi.sync_from_sqlite(&fi) {
                    eprintln!("同步内存索引失败: {}", e);
                }
                mi.finish_build();
                let _ = app_clone.emit("file-index://status", serde_json::json!({
                    "phase": "done",
                    "count": count,
                    "message": format!("索引完成，共 {} 个文件", count)
                }));
                println!("文件索引构建完成，共 {} 个文件", count);
            }
            Ok(Err(e)) => {
                mi.finish_build();
                eprintln!("文件索引构建失败: {}", e);
                let _ = app_clone.emit("file-index://status", serde_json::json!({
                    "phase": "error",
                    "message": format!("索引失败: {}", e)
                }));
            }
            Err(panic_info) => {
                mi.finish_build();
                let msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_info.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "未知内部错误".to_string()
                };
                eprintln!("文件索引构建发生panic: {}", msg);
                let _ = app_clone.emit("file-index://status", serde_json::json!({
                    "phase": "error",
                    "message": format!("索引过程异常: {}", msg)
                }));
            }
        }
    });

    Ok(())
}

/// 获取索引状态
#[tauri::command]
pub fn get_index_status(file_index: State<Arc<FileIndex>>) -> Result<serde_json::Value, String> {
    match file_index.get_status() {
        Ok(status) => Ok(serde_json::json!({
            "indexed_count": status.indexed_count,
            "last_indexed_at": status.last_indexed_at,
            "is_indexing": status.is_indexing
        })),
        Err(e) => Err(e),
    }
}
