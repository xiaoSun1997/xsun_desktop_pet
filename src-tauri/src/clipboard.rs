// src-tauri/src/clipboard.rs
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{State, AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::database::Database;

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
pub struct ClipboardItem {
    pub content: String,
    pub content_type: String, // "text" 或 "image"
    pub timestamp: i64,
    pub id: usize,
}

pub struct ClipboardHistory {
    pub items: Mutex<VecDeque<ClipboardItem>>,
    pub next_id: Mutex<usize>,
    pub last_content: Mutex<Option<String>>,
    pub last_image_hash: Mutex<Option<u64>>,
}

impl ClipboardHistory {
    pub fn new() -> Self {
        Self {
            items: Mutex::new(VecDeque::new()),
            next_id: Mutex::new(0),
            last_content: Mutex::new(None),
            last_image_hash: Mutex::new(None),
        }
    }

    fn add_item_safe(&self, content: String, content_type: &str) -> Result<(), String> {
        let mut items = self.items.lock()
            .map_err(|e| format!("获取items锁失败: {}", e))?;

        let mut next_id = self.next_id.lock()
            .map_err(|e| format!("获取next_id锁失败: {}", e))?;

        // 检查是否与最近的内容重复
        if let Some(last_item) = items.front() {
            if last_item.content == content && last_item.content_type == content_type {
                return Ok(());
            }
        }

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        let new_item = ClipboardItem {
            content: content.clone(),
            content_type: content_type.to_string(),
            timestamp,
            id: *next_id,
        };

        items.push_front(new_item);
        *next_id += 1;

        // 保留最多10条
        const MAX_ITEMS: usize = 10;
        while items.len() > MAX_ITEMS {
            if let Some(removed) = items.pop_back() {
                println!("移除旧记录: ID {} (保持最大 {} 条记录)", removed.id, MAX_ITEMS);
            }
        }

        let preview = if content.len() > 80 {
            format!("{}...", &content[..80])
        } else {
            content
        };

        println!("添加剪贴板项目: ID {}, 类型: {}, 内容: {}, 当前总数: {}",
                 *next_id - 1, content_type, preview, items.len());

        Ok(())
    }

    pub fn check_and_update_safe(&self, app: &AppHandle) -> Result<bool, String> {
        // 1. 先检查文本
        let text_opt = app.clipboard().read_text().ok();
        if let Some(ref current_text) = text_opt {
            let trimmed = current_text.trim();
            if !trimmed.is_empty() && trimmed.len() <= 5_000_000 { // 提高到5MB
                let mut last_content = self.last_content.lock()
                    .map_err(|e| format!("获取last_content锁失败: {}", e))?;

                let is_new = match &*last_content {
                    Some(last) => last != current_text,
                    None => true,
                };

                if is_new {
                    let preview = if current_text.chars().count() > 50 {
                        let truncated: String = current_text.chars().take(50).collect();
                        format!("{}...", truncated)
                    } else {
                        current_text.clone()
                    };
                    println!("发现新的文本剪贴板内容: {}", preview);

                    *last_content = Some(current_text.clone());
                    drop(last_content);

                    self.add_item_safe(current_text.clone(), "text")?;

                    // 同步保存到数据库
                    if let Some(db) = app.try_state::<Database>() {
                        let timestamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs() as i64;
                        let db_item = ClipboardItem {
                            id: 0,
                            content: current_text.clone(),
                            content_type: "text".to_string(),
                            timestamp,
                        };
                        let _ = db.add_clipboard_item(&db_item);
                    }

                    return Ok(true);
                }
                return Ok(false);
            }
        }

        // 2. 尝试读取图片
        #[cfg(target_os = "windows")]
        fn read_clipboard_image(app: &AppHandle) -> Option<String> {
            use tauri_plugin_clipboard_manager::ClipboardExt;
            // 尝试通过 clipboard API 读取图片
            match app.clipboard().read_image() {
                Ok(img) => {
                    let width = tauri::image::Image::width(&img);
                    let height = tauri::image::Image::height(&img);
                    let rgba = img.rgba().to_vec();

                    // 将 RGBA 原始数据编码为 PNG
                    if let Some(img_buffer) = image::RgbaImage::from_raw(width, height, rgba) {
                        let mut png_bytes = std::io::Cursor::new(Vec::new());
                        if image::DynamicImage::from(img_buffer)
                            .write_to(&mut png_bytes, image::ImageFormat::Png)
                            .is_ok()
                        {
                            use base64::Engine;
                            let b64 = base64::engine::general_purpose::STANDARD
                                .encode(png_bytes.into_inner());
                            return Some(format!("data:image/png;base64,{}", b64));
                        }
                    }
                    None
                }
                _ => None,
            }
        }

        #[cfg(not(target_os = "windows"))]
        fn read_clipboard_image(_app: &AppHandle) -> Option<String> {
            None
        }

        if let Some(image_data_url) = read_clipboard_image(app) {
            // 计算简单的哈希来判断是否新图片
            use std::hash::{Hash, Hasher};
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            image_data_url.len().hash(&mut hasher);
            if image_data_url.len() > 100 {
                // 用内容中间部分哈希作为简单指纹
                let mid = image_data_url.len() / 2;
                let sample = &image_data_url[mid..(mid + 100).min(image_data_url.len())];
                sample.hash(&mut hasher);
            }
            let hash = hasher.finish();

            let mut last_hash = self.last_image_hash.lock()
                .map_err(|e| format!("获取last_image_hash锁失败: {}", e))?;

            if Some(hash) != *last_hash {
                *last_hash = Some(hash);
                drop(last_hash);
                println!("发现新的图片剪贴板内容");
                self.add_item_safe(image_data_url.clone(), "image")?;

                // 同步保存到数据库
                if let Some(db) = app.try_state::<Database>() {
                    let timestamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64;
                    let db_item = ClipboardItem {
                        id: 0,
                        content: image_data_url,
                        content_type: "image".to_string(),
                        timestamp,
                    };
                    let _ = db.add_clipboard_item(&db_item);
                }

                return Ok(true);
            }
        }

        Ok(false)
    }
}


#[tauri::command]
pub fn get_clipboard_history(
    app: AppHandle,
) -> Result<Vec<ClipboardItem>, String> {
    let db = app.state::<Database>();
    db.get_clipboard_history()
}

#[tauri::command]
pub fn get_clipboard_history_paginated(
    app: AppHandle,
    page: usize,
    page_size: usize,
) -> Result<Vec<ClipboardItem>, String> {
    let db = app.state::<Database>();
    db.get_clipboard_history_paginated(page, page_size)
}

#[tauri::command]
pub fn add_to_clipboard_history(
    content: String,
    app: AppHandle,
    history: State<std::sync::Arc<ClipboardHistory>>
) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("内容不能为空".to_string());
    }

    if content.len() > 5_000_000 {
        return Err("内容过长，超出5MB限制".to_string());
    }

    // 添加到DB
    let db = app.state::<Database>();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let item = ClipboardItem {
        id: 0,
        content: content.clone(),
        content_type: "text".to_string(),
        timestamp,
    };
    db.add_clipboard_item(&item)?;

    let preview = if content.len() > 100 {
        format!("{}...", &content[..100])
    } else {
        content.clone()
    };
    println!("手动添加剪贴板项目: {}", preview);

    history.add_item_safe(content, "text")?;
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

    if content.len() > 5_000_000 {
        return Err("内容过长，超出5MB限制".to_string());
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
    app: AppHandle,
    history: State<std::sync::Arc<ClipboardHistory>>
) -> Result<(), String> {
    // 清空DB
    let db = app.state::<Database>();
    db.clear_clipboard_history()?;

    if let Ok(mut items) = history.items.lock() {
        items.clear();
    }

    if let Ok(mut next_id) = history.next_id.lock() {
        *next_id = 0;
    }

    if let Ok(mut last_content) = history.last_content.lock() {
        *last_content = None;
    }

    if let Ok(mut last_hash) = history.last_image_hash.lock() {
        *last_hash = None;
    }

    println!("剪贴板历史已完全清空");
    Ok(())
}

#[tauri::command]
pub fn delete_clipboard_item(
    app: AppHandle,
    id: usize,
) -> Result<(), String> {
    let db = app.state::<Database>();
    db.delete_clipboard_item(id)
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
        match history.add_item_safe(content, "text") {
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
