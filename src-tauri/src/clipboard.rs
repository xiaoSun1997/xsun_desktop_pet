// src-tauri/src/clipboard.rs
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{State, AppHandle};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub struct ClipboardItem {
    pub content: String,
    pub timestamp: i64,
    pub id: usize,
}

pub struct ClipboardHistory {
    pub items: Mutex<VecDeque<ClipboardItem>>,
    pub next_id: Mutex<usize>,
    pub last_content: Mutex<Option<String>>,
}

impl ClipboardHistory {
    pub fn new() -> Self {
        Self {
            items: Mutex::new(VecDeque::new()),
            next_id: Mutex::new(0),
            last_content: Mutex::new(None),
        }
    }

    pub fn check_and_update(&self, app: &AppHandle) -> Result<bool, String> {
        // 直接调用，不使用 catch_unwind
        let current_content = match app.clipboard().read_text() {
            Ok(content) => content,
            Err(e) => return Err(format!("读取剪贴板失败: {}", e)),
        };

        // 检查内容是否为空或只有空白字符
        if current_content.trim().is_empty() {
            return Ok(false);
        }

        // 限制内容长度，防止内存问题
        if current_content.len() > 10000 {
            return Err("剪贴板内容过长".to_string());
        }

        let mut last_content = match self.last_content.lock() {
            Ok(guard) => guard,
            Err(e) => return Err(format!("获取锁失败: {}", e)),
        };

        let is_new = match &*last_content {
            Some(last) => last != &current_content,
            None => true,
        };

        if is_new {
            let preview = if current_content.len() > 50 {
                format!("{}...", &current_content[..50])
            } else {
                current_content.clone()
            };
            println!("发现新的剪贴板内容: {}", preview);

            *last_content = Some(current_content.clone());
            drop(last_content); // 显式释放锁

            self.add_item(current_content)?;
            return Ok(true);
        }

        Ok(false)
    }

    fn add_item(&self, content: String) -> Result<(), String> {
        let mut items = match self.items.lock() {
            Ok(guard) => guard,
            Err(e) => return Err(format!("获取items锁失败: {}", e)),
        };

        let mut next_id = match self.next_id.lock() {
            Ok(guard) => guard,
            Err(e) => return Err(format!("获取next_id锁失败: {}", e)),
        };

        // 检查是否与最近的内容重复
        if let Some(last_item) = items.front() {
            if last_item.content == content {
                return Ok(());
            }
        }

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let new_item = ClipboardItem {
            content: content.clone(),
            timestamp,
            id: *next_id,
        };

        items.push_front(new_item);
        *next_id += 1;

        // 保持最多5个历史记录
        while items.len() > 5 {
            items.pop_back();
        }

        let preview = if content.len() > 50 {
            format!("{}...", &content[..50])
        } else {
            content
        };
        println!("添加剪贴板项目: ID {}, 内容: {}", *next_id - 1, preview);

        Ok(())
    }
}

#[tauri::command]
pub fn get_clipboard_history(
    app: AppHandle,
    history: State<'_, std::sync::Arc<ClipboardHistory>>
) -> Result<Vec<ClipboardItem>, String> {
    // 先检查是否有新内容，忽略错误
    let _ = history.check_and_update(&app);

    let items = match history.items.lock() {
        Ok(guard) => guard,
        Err(e) => return Err(format!("获取历史记录失败: {}", e)),
    };

    let result: Vec<ClipboardItem> = items.iter().cloned().collect();
    println!("获取剪贴板历史，共 {} 条记录", result.len());
    Ok(result)
}

#[tauri::command]
pub fn add_to_clipboard_history(
    content: String,
    history: State<std::sync::Arc<ClipboardHistory>>
) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("内容不能为空".to_string());
    }

    if content.len() > 10000 {
        return Err("内容过长".to_string());
    }

    let preview = if content.len() > 50 {
        format!("{}...", &content[..50])
    } else {
        content.clone()
    };
    println!("手动添加剪贴板项目: {}", preview);

    history.add_item(content)?;
    Ok(())
}

#[tauri::command]
pub fn copy_to_clipboard(
    content: String,
    app: AppHandle,
    history: State<'_, std::sync::Arc<ClipboardHistory>>
) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("内容不能为空".to_string());
    }

    if content.len() > 10000 {
        return Err("内容过长".to_string());
    }

    app.clipboard().write_text(content.clone())
        .map_err(|e| format!("设置剪贴板内容失败: {}", e))?;

    // 更新最后内容，避免重复添加
    if let Ok(mut last_content) = history.last_content.lock() {
        *last_content = Some(content);
    }

    println!("已复制到剪贴板");
    Ok(())
}

#[tauri::command]
pub fn get_current_clipboard(app: AppHandle) -> Result<String, String> {
    match app.clipboard().read_text() {
        Ok(content) => {
            let preview = if content.len() > 50 {
                format!("{}...", &content[..50])
            } else {
                content.clone()
            };
            println!("获取当前剪贴板内容: {}", preview);
            Ok(content)
        },
        Err(e) => Err(format!("获取剪贴板内容失败: {}", e))
    }
}

#[tauri::command]
pub fn clear_clipboard_history(
    history: State<std::sync::Arc<ClipboardHistory>>
) -> Result<(), String> {
    if let Ok(mut items) = history.items.lock() {
        items.clear();
    }

    if let Ok(mut next_id) = history.next_id.lock() {
        *next_id = 0;
    }

    println!("剪贴板历史已清空");
    Ok(())
}

#[tauri::command]
pub fn manual_clipboard_check(
    app: AppHandle,
    history: State<'_, std::sync::Arc<ClipboardHistory>>
) -> Result<String, String> {
    match history.check_and_update(&app) {
        Ok(true) => Ok("发现新内容".to_string()),
        Ok(false) => Ok("无新内容".to_string()),
        Err(e) => Ok(format!("检查失败: {}", e)),
    }
}
