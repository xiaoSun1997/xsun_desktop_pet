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

    // 修复的添加项目方法
    fn add_item_safe(&self, content: String) -> Result<(), String> {
        let mut items = self.items.lock()
            .map_err(|e| format!("获取items锁失败: {}", e))?;

        let mut next_id = self.next_id.lock()
            .map_err(|e| format!("获取next_id锁失败: {}", e))?;

        // 检查是否与最近的内容重复
        if let Some(last_item) = items.front() {
            if last_item.content == content {
                return Ok(()); // 内容重复，直接返回
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

        // 先添加新项目到队列前面
        items.push_front(new_item);
        *next_id += 1;

        // 确保队列长度不超过5
        // 使用更安全的方式：检查长度并明确移除最后一个元素
        const MAX_ITEMS: usize = 5;
        while items.len() > MAX_ITEMS {
            if let Some(removed) = items.pop_back() {
                println!("移除旧记录: ID {} (保持最大 {} 条记录)", removed.id, MAX_ITEMS);
            } else {
                // 如果pop_back返回None，说明队列为空，这不应该发生
                eprintln!("警告: 尝试从空队列移除元素");
                break;
            }
        }

        let preview = if content.len() > 100  {
            format!("{}...", &content[..100])
        } else {
            content
        };

        println!("添加剪贴板项目: ID {}, 内容: {}, 当前总数: {}",
                 *next_id - 1, preview, items.len());

        Ok(())
    }

    // 更安全的检查和更新方法
    pub fn check_and_update_safe(&self, app: &AppHandle) -> Result<bool, String> {
        let current_content = app.clipboard().read_text()
            .map_err(|e| format!("读取剪贴板失败: {}", e))?;

        if current_content.trim().is_empty() {
            return Ok(false);
        }

        if current_content.len() > 200_000 {
            return Err("剪贴板内容过长".to_string());
        }

        let mut last_content = self.last_content.lock()
            .map_err(|e| format!("获取last_content锁失败: {}", e))?;

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

            self.add_item_safe(current_content)?;
            return Ok(true);
        }

        Ok(false)
    }
}

#[tauri::command]
pub fn get_clipboard_history(
    history: State<'_, std::sync::Arc<ClipboardHistory>>
) -> Result<Vec<ClipboardItem>, String> {
    let items = history.items.lock()
        .map_err(|e| format!("获取历史记录失败: {}", e))?;

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

    let preview = if content.len() > 100 {
        format!("{}...", &content[..100])
    } else {
        content.clone()
    };
    println!("手动添加剪贴板项目: {}", preview);

    history.add_item_safe(content)?;
    Ok(())
}

#[tauri::command]
pub fn copy_to_clipboard(
    content: String,
    app: AppHandle,
) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("内容不能为空".to_string());
    }

    if content.len() > 10000 {
        return Err("内容过长".to_string());
    }

    let preview = if content.len() > 100 {
        format!("{}...", &content[..100])
    } else {
        content.clone()
    };
    println!("复制内容: {}", preview);

    app.clipboard().write_text(content)
        .map_err(|e| format!("复制失败: {}", e))?;

    println!("复制成功");
    Ok(())
}

#[tauri::command]
pub fn get_current_clipboard(app: AppHandle) -> Result<String, String> {
    app.clipboard().read_text()
        .map_err(|e| format!("获取剪贴板内容失败: {}", e))
}

#[tauri::command]
pub fn clear_clipboard_history(
    history: State<std::sync::Arc<ClipboardHistory>>
) -> Result<(), String> {
    if let Ok(mut items) = history.items.lock() {
        items.clear();
        println!("清空 {} 条历史记录", items.len());
    }

    if let Ok(mut next_id) = history.next_id.lock() {
        *next_id = 0;
    }

    if let Ok(mut last_content) = history.last_content.lock() {
        *last_content = None;
    }

    println!("剪贴板历史已完全清空");
    Ok(())
}

#[tauri::command]
pub fn manual_clipboard_check(
    app: AppHandle,
    history: State<'_, std::sync::Arc<ClipboardHistory>>
) -> Result<String, String> {
    match history.check_and_update_safe(&app) {
        Ok(true) => Ok("发现并添加新内容".to_string()),
        Ok(false) => Ok("无新内容".to_string()),
        Err(e) => Ok(format!("检查失败: {}", e)),
    }
}

// 新增：安全的批量添加测试命令
#[tauri::command]
pub fn test_add_multiple_items(
    history: State<'_, std::sync::Arc<ClipboardHistory>>
) -> Result<String, String> {
    println!("开始批量添加测试...");

    for i in 1..=10 {
        let content = format!("测试内容 {}", i);
        match history.add_item_safe(content) {
            Ok(()) => println!("成功添加测试项目 {}", i),
            Err(e) => {
                let error_msg = format!("添加测试项目 {} 失败: {}", i, e);
                eprintln!("{}", error_msg);
                return Err(error_msg);
            }
        }
    }

    let items_count = history.items.lock()
        .map(|items| items.len())
        .unwrap_or(0);

    Ok(format!("批量添加测试完成，当前共 {} 条记录", items_count))
}
