use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow,WebviewWindowBuilder,
            menu::{Menu, MenuItemBuilder, PredefinedMenuItem},
            tray::{TrayIcon, TrayIconBuilder, TrayIconEvent, MouseButton}};
use tokio::time::Duration;
use urlencoding::encode as urlencode;

mod calendar;
mod clipboard;
mod jira_tools;
mod window_utils;

use clipboard::{
    add_to_clipboard_history, clear_clipboard_history, copy_to_clipboard, get_clipboard_history,
    get_current_clipboard, manual_clipboard_check, ClipboardHistory,
};

use jira_tools::{
    GitCommit, JiraIssue, WorklogEntry, JiraConfig, GitConfig, GitRepository, test_jira_connection
};

use uuid::Uuid;

#[derive(Serialize, Clone)]
struct SystemInfo {
    cpu_usage: f32,
    total_memory: u64,
    used_memory: u64,
}

#[tauri::command]
fn get_system_info(state: tauri::State<Arc<Mutex<System>>>) -> SystemInfo {
    let mut sys = state.lock().unwrap();
    collect_system_info(&mut *sys)
}

#[tauri::command]
async fn set_click_through(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window_utils::set_click_through(&window, enabled)
}

#[tauri::command]
async fn wake_up_pet(app: AppHandle) -> Result<(), String> {
    if let Some(pet_window) = app.get_webview_window("pet") {
        window_utils::set_click_through(&pet_window, false)?;
        app.emit("pet://wake-up", ()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn collect_system_info(sys: &mut System) -> SystemInfo {
    sys.refresh_all();
    let cpu_usage = sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / sys.cpus().len() as f32;
    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();

    SystemInfo {
        cpu_usage,
        total_memory,
        used_memory,
    }
}
// 在现有命令函数后添加
#[tauri::command]
async fn open_expand_window(content: String, app: AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    // 生成唯一的窗口标签
    let window_label = format!(
        "expand_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    // 创建窗口
    let webview_window =
        WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App("index.html".into()))
            .title("剪贴板内容编辑")
            .inner_size(600.0, 500.0)
            .visible(true)
            .transparent(true)
            .decorations(false)
            .resizable(true)
            .initialization_script(&format!(
                "window.__EXPAND_CONTENT__ = {};",
                serde_json::to_string(&content).map_err(|e| e.to_string())?
            ))
            .build()
            .map_err(|e| format!("创建窗口失败: {}", e))?;

    // 显示并聚焦窗口
    webview_window
        .show()
        .map_err(|e| format!("显示窗口失败: {}", e))?;
    webview_window
        .set_focus()
        .map_err(|e| format!("聚焦窗口失败: {}", e))?;

    Ok(())
}

// 添加新的结构体
// DeepSeek 配置结构体
#[derive(Serialize, Deserialize, Clone)]
struct DeepSeekConfig {
    #[serde(rename = "apiKey")]
    api_key: String,
    #[serde(rename = "baseUrl")]
    base_url: String,
    model: String,
}

#[derive(Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}
#[derive(Serialize, Deserialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Serialize, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

// 读取配置文件

// 发送聊天消息
#[tauri::command]
async fn send_chat_message(
    app: tauri::AppHandle,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let config = load_deepseek_config(app).await?;

    let client = reqwest::Client::new();
    let chat_request = ChatRequest {
        model: config.model,
        messages,
        stream: false,
    };

    let response = client
        .post(&format!("{}/chat/completions", config.base_url))
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&chat_request)
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API请求失败 ({}): {}", status, error_text));
    }

    let chat_response: ChatResponse = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    chat_response
        .choices
        .first()
        .map(|choice| choice.message.content.clone())
        .ok_or_else(|| "AI响应为空".to_string())
}
// 获取配置存储路径
async fn get_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    // 先await异步操作，再处理错误
    tokio::fs::create_dir_all(&app_data_dir)
        .await
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    Ok(app_data_dir.join("deepseek_config.json"))
}

// 保存配置到本地
#[tauri::command]
async fn save_deepseek_config(app: tauri::AppHandle, config: DeepSeekConfig) -> Result<(), String> {
    let config_path = get_config_path(&app).await?;

    let config_json =
        serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败: {}", e))?;

    tokio::fs::write(&config_path, config_json)
        .await
        .map_err(|e| format!("保存配置文件失败: {}", e))?;

    Ok(())
}

// 从本地加载配置
#[tauri::command]
async fn load_local_deepseek_config(
    app: tauri::AppHandle,
) -> Result<Option<DeepSeekConfig>, String> {
    let config_path = get_config_path(&app).await?;

    // 使用tokio的异步方法检查文件是否存在
    if !tokio::fs::try_exists(&config_path)
        .await
        .map_err(|e| format!("检查配置文件是否存在失败: {}", e))?
    {
        return Ok(None);
    }

    let config_content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("读取本地配置文件失败: {}", e))?;

    let config: DeepSeekConfig = serde_json::from_str(&config_content)
        .map_err(|e| format!("解析本地配置文件失败: {}", e))?;

    Ok(Some(config))
}

// 修改原有的加载配置函数，优先使用本地配置
#[tauri::command]
async fn load_deepseek_config(app: tauri::AppHandle) -> Result<DeepSeekConfig, String> {
    // 先尝试加载本地配置
    if let Ok(Some(local_config)) = load_local_deepseek_config(app.clone()).await {
        if !local_config.api_key.is_empty() && local_config.api_key != "your_deepseek_api_key_here"
        {
            return Ok(local_config);
        }
    }

    // 如果本地配置不存在或无效，尝试加载资源文件配置
    let resource_path = app
        .path()
        .resolve("config/deepseek.json", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("无法解析资源路径: {}", e))?;

    let config_content = tokio::fs::read_to_string(&resource_path)
        .await
        .map_err(|e| format!("读取配置文件失败: {}。文件路径: {:?}", e, resource_path))?;

    let config: DeepSeekConfig =
        serde_json::from_str(&config_content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    if config.api_key.is_empty() || config.api_key == "your_deepseek_api_key_here" {
        return Err("请配置有效的API Key".to_string());
    }

    Ok(config)
}
// 有道翻译
#[derive(Serialize, Deserialize, Clone)]
struct YoudaoConfig {
    #[serde(rename = "appKey")]
    app_key: String,
    #[serde(rename = "appSecret")]
    app_secret: String,
    #[serde(rename = "baseUrl")]
    base_url: String,
}

#[derive(Serialize, Deserialize)]
struct YoudaoTranslateRequest {
    q: String,
    from: String,
    to: String,
    appKey: String,
    salt: String,
    sign: String,
}

#[derive(Serialize, Deserialize)]
struct YoudaoTranslateResponse {
    translation: Option<Vec<String>>,
    errorCode: Option<String>,
}

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::menu::MenuItem;
use crate::jira_tools::{get_current_date, get_my_today_worklogs, get_my_unfinished_issues, get_required_work_hours, get_today_commits_by_user, load_ai_config, load_git_config, load_jira_config, log_work, process_worklog_with_ai, save_ai_config, save_git_config, save_jira_config};

// 生成有道翻译签名
// 修改签名生成函数
fn generate_youdao_sign(app_key: &str, query: &str, salt: &str, app_secret: &str) -> String {
    let sign_str = format!("{}{}{}{}", app_key, query, salt, app_secret);
    format!("{:x}", md5::compute(sign_str.as_bytes()))
}

// 保存有道翻译配置
#[tauri::command]
async fn save_youdao_config(app: tauri::AppHandle, config: YoudaoConfig) -> Result<(), String> {
    let config_path = get_youdao_config_path(&app).await?;

    let config_json =
        serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败: {}", e))?;

    tokio::fs::write(&config_path, config_json)
        .await
        .map_err(|e| format!("保存配置文件失败: {}", e))?;

    Ok(())
}

// 加载有道翻译配置
#[tauri::command]
async fn load_youdao_config(app: tauri::AppHandle) -> Result<Option<YoudaoConfig>, String> {
    let config_path = get_youdao_config_path(&app).await?;

    if !tokio::fs::try_exists(&config_path)
        .await
        .map_err(|e| format!("检查配置文件是否存在失败: {}", e))?
    {
        return Ok(None);
    }

    let config_content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    let config: YoudaoConfig =
        serde_json::from_str(&config_content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    Ok(Some(config))
}

// 获取有道翻译配置路径
async fn get_youdao_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    tokio::fs::create_dir_all(&app_data_dir)
        .await
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    Ok(app_data_dir.join("youdao_config.json"))
}

// 有道翻译
#[tauri::command]
async fn youdao_translate(
    app: tauri::AppHandle,
    text: String,
    from: String,
    to: String,
) -> Result<String, String> {
    let config = load_youdao_config(app)
        .await?
        .ok_or_else(|| "请先配置有道翻译API密钥".to_string())?;

    if config.app_key.is_empty() || config.app_secret.is_empty() {
        return Err("API密钥配置无效".to_string());
    }

    // 处理等号分割的翻译
    let (prefix, translate_text) = if text.contains('=') {
        let parts: Vec<&str> = text.splitn(2, '=').collect();
        if parts.len() == 2 {
            (format!("{}=", parts[0]), parts[1].to_string())
        } else {
            (String::new(), text)
        }
    } else {
        (String::new(), text)
    };

    let salt = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .to_string();

    let sign = generate_youdao_sign(&config.app_key, &translate_text, &salt, &config.app_secret);

    let client = reqwest::Client::new();
    let mut params = std::collections::HashMap::new();
    params.insert("q", translate_text.as_str());
    params.insert("from", from.as_str());
    params.insert("to", to.as_str());
    params.insert("appKey", config.app_key.as_str());
    params.insert("salt", salt.as_str());
    params.insert("sign", sign.as_str());

    let response = client
        .post(&config.base_url)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API请求失败 ({}): {}", status, error_text));
    }

    let translate_response: YoudaoTranslateResponse = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    if let Some(translations) = translate_response.translation {
        if let Some(translation) = translations.first() {
            Ok(format!("{}{}", prefix, translation))
        } else {
            Err("翻译结果为空".to_string())
        }
    } else if let Some(error_code) = translate_response.errorCode {
        Err(format!("翻译失败，错误代码: {}", error_code))
    } else {
        Err("翻译失败，未知错误".to_string())
    }
}

// 日历相关结构体
#[derive(Serialize, Deserialize, Clone)]
struct TodoItem {
    id: String,
    content: String,
    completed: bool,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
struct DayTodos {
    date: String,
    todos: Vec<TodoItem>,
}

#[derive(Serialize, Deserialize, Clone)]
struct CalendarSettings {
    #[serde(rename = "backgroundImages")]
    background_images: Vec<String>,
    #[serde(rename = "rotationInterval")]
    rotation_interval: u32, // 分钟
}

// 日历相关命令
#[tauri::command]
async fn get_todos_for_date(app: AppHandle, date: String) -> Result<Vec<TodoItem>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    let todos_file = app_data_dir.join("todos.json");

    if !tokio::fs::try_exists(&todos_file).await.unwrap_or(false) {
        return Ok(vec![]);
    }

    let content = tokio::fs::read_to_string(&todos_file)
        .await
        .map_err(|e| format!("读取todolist失败: {}", e))?;

    let all_todos: HashMap<String, Vec<TodoItem>> =
        serde_json::from_str(&content).unwrap_or_default();

    Ok(all_todos.get(&date).cloned().unwrap_or_default())
}

#[tauri::command]
async fn save_todos_for_date(
    app: AppHandle,
    date: String,
    todos: Vec<TodoItem>,
) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    tokio::fs::create_dir_all(&app_data_dir)
        .await
        .map_err(|e| format!("创建数据目录失败: {}", e))?;

    let todos_file = app_data_dir.join("todos.json");

    let mut all_todos: HashMap<String, Vec<TodoItem>> =
        if tokio::fs::try_exists(&todos_file).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&todos_file)
                .await
                .unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        };

    all_todos.insert(date, todos);

    let content = serde_json::to_string_pretty(&all_todos)
        .map_err(|e| format!("序列化todolist失败: {}", e))?;

    tokio::fs::write(&todos_file, content)
        .await
        .map_err(|e| format!("保存todolist失败: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn open_todo_window(date: String, app: AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let window_label = format!("todo_{}", date);

    // 检查窗口是否已存在
    if let Some(existing_window) = app.get_webview_window(&window_label) {
        existing_window.show().map_err(|e| e.to_string())?;
        existing_window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let webview_window =
        WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App("index.html".into()))
            .title(&format!("{} - 待办事项", date))
            .inner_size(500.0, 600.0)
            .visible(true)
            .transparent(true)
            .decorations(false)
            .resizable(true)
            .initialization_script(&format!(
                "window.__TODO_DATE__ = {};",
                serde_json::to_string(&date).map_err(|e| e.to_string())?
            ))
            .build()
            .map_err(|e| format!("创建待办窗口失败: {}", e))?;

    webview_window
        .show()
        .map_err(|e| format!("显示待办窗口失败: {}", e))?;
    webview_window
        .set_focus()
        .map_err(|e| format!("聚焦待办窗口失败: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn save_calendar_settings(app: AppHandle, settings: CalendarSettings) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    tokio::fs::create_dir_all(&app_data_dir)
        .await
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    let settings_file = app_data_dir.join("calendar_settings.json");

    let settings_json =
        serde_json::to_string_pretty(&settings).map_err(|e| format!("序列化配置失败: {}", e))?;

    tokio::fs::write(&settings_file, settings_json)
        .await
        .map_err(|e| format!("保存配置文件失败: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn load_calendar_settings(app: AppHandle) -> Result<CalendarSettings, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    let settings_file = app_data_dir.join("calendar_settings.json");

    if !tokio::fs::try_exists(&settings_file).await.unwrap_or(false) {
        return Ok(CalendarSettings {
            background_images: vec!["data/img0.jpeg".to_string()],
            rotation_interval: 30, // 默认30分钟
        });
    }

    let content = tokio::fs::read_to_string(&settings_file)
        .await
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    let settings: CalendarSettings =
        serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    Ok(settings)
}

#[tauri::command]
async fn upload_background_image(
    app: AppHandle,
    image_data: Vec<u8>,
    filename: String,
) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    let images_dir = app_data_dir.join("background_images");
    tokio::fs::create_dir_all(&images_dir)
        .await
        .map_err(|e| format!("创建图片目录失败: {}", e))?;

    let file_path = images_dir.join(&filename);
    tokio::fs::write(&file_path, &image_data)
        .await
        .map_err(|e| format!("保存图片失败: {}", e))?;

    // 返回相对路径
    Ok(format!("background_images/{}", filename))
}

#[tauri::command]
async fn delete_background_image(app: AppHandle, image_path: String) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    let file_path = app_data_dir.join(&image_path);

    if tokio::fs::try_exists(&file_path).await.unwrap_or(false) {
        tokio::fs::remove_file(&file_path)
            .await
            .map_err(|e| format!("删除图片失败: {}", e))?;
    }

    Ok(())
}
#[tauri::command]
async fn refresh_calendar_data(app: AppHandle) -> Result<(), String> {
    // 向所有日历窗口发送刷新事件
    if let Some(window) = app.get_webview_window("calendar") {
        let _ = window.emit("refresh-calendar", ());
    }
    Ok(())
}

// 添加创建托盘菜单的函数
// 修正后的创建托盘菜单函数
fn create_tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let show_pet = MenuItemBuilder::with_id("show_pet", "显示桌宠").build(app)?;
    let separator1 = PredefinedMenuItem::separator(app)?;
    let open_clipboard = MenuItemBuilder::with_id("open_clipboard", "剪贴板").build(app)?;
    let open_system = MenuItemBuilder::with_id("open_system", "系统信息").build(app)?;
    let open_ai = MenuItemBuilder::with_id("open_ai", "AI对话").build(app)?;
    let open_translator = MenuItemBuilder::with_id("open_translator", "有道翻译").build(app)?;
    let open_calendar = MenuItemBuilder::with_id("open_calendar", "日历TODO").build(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;

    let menu = Menu::with_items(app, &[
        &show_pet,
        &separator1,
        &open_clipboard,
        &open_system,
        &open_ai,
        &open_translator,
        &open_calendar,
        &separator2,
        &quit,
    ])?;

    Ok(menu)
}


// 添加处理托盘事件的函数
// 修正后的处理托盘事件的函数
fn handle_tray_event(app: &AppHandle, event: TrayIconEvent) {
    match event {
        TrayIconEvent::Click { button, .. } => {
            match button {
                MouseButton::Left => {
                    // 左键点击显示/隐藏桌宠
                    if let Some(pet_window) = app.get_webview_window("pet") {
                        match pet_window.is_visible() {
                            Ok(true) => {
                                let _ = pet_window.hide();
                            }
                            Ok(false) => {
                                let _ = pet_window.show();
                                let _ = pet_window.set_focus();
                            }
                            Err(_) => {}
                        }
                    }
                }
                MouseButton::Right => {
                    // 右键点击会自动显示菜单（这个事件可能不会触发，因为右键通常由系统处理菜单显示）
                    println!("右键点击托盘图标");
                }
                _ => {}
            }
        }
        TrayIconEvent::DoubleClick { .. } => {
            // 双击显示桌宠
            if let Some(pet_window) = app.get_webview_window("pet") {
                let _ = pet_window.show();
                let _ = pet_window.set_focus();
            }
        }
        _ => {}
    }
}

// 添加处理托盘菜单事件的函数
fn handle_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "show_pet" => {
            if let Some(pet_window) = app.get_webview_window("pet") {
                let _ = pet_window.show();
                let _ = pet_window.set_focus();
            }
        }
        "open_clipboard" => {
            // 发送事件到前端创建剪贴板窗口
            let _ = app.emit("tray://open-clipboard", ());
        }
        "open_system" => {
            let _ = app.emit("tray://open-system", ());
        }
        "open_ai" => {
            let _ = app.emit("tray://open-ai", ());
        }
        "open_translator" => {
            let _ = app.emit("tray://open-translator", ());
        }
        "open_calendar" => {
            let _ = app.emit("tray://open-calendar", ());
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

// 添加托盘相关的 invoke 函数
#[tauri::command]
async fn show_from_tray(app_handle: AppHandle) -> Result<(), String> {
    if let Some(pet_window) = app_handle.get_webview_window("pet") {
        pet_window.show().map_err(|e| e.to_string())?;
        pet_window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn hide_to_tray(app_handle: AppHandle) -> Result<(), String> {
    if let Some(pet_window) = app_handle.get_webview_window("pet") {
        pet_window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// 番茄钟通知命令
#[tauri::command]
async fn show_pomodoro_notification(
    app: AppHandle,
    message: String,
    is_work_time: bool,
) -> Result<(), String> {
    // 检查通知窗口是否已存在
    if let Some(notification_window) = app.get_webview_window("pomodoro-notification") {
        // 窗口存在，更新内容并显示
        notification_window
            .emit("pomodoro-update", serde_json::json!({
                "message": message,
                "isWorkTime": is_work_time
            }))
            .map_err(|e| e.to_string())?;

        notification_window.show().map_err(|e| e.to_string())?;
        notification_window.set_focus().map_err(|e| e.to_string())?;
    } else {
        // 窗口不存在，创建新窗口
        let notification_url = format!(
            "/#/pomodoro-notification?message={}&isWorkTime={}",
            urlencode(&message),
            is_work_time
        );

        WebviewWindowBuilder::new(&app, "pomodoro-notification", tauri::WebviewUrl::App(notification_url.into()))
            .title("番茄钟提醒")
            .inner_size(400.0, 250.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .center()
            .skip_taskbar(true)
            .build()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn close_pomodoro_notification(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("pomodoro-notification") {
        window.hide().map_err(|e| e.to_string())?;
        // 发送继续事件到主番茄钟窗口
        app.emit("pomodoro-continue", ()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(Mutex::new(System::new_all())))
        .manage(Arc::new(ClipboardHistory::new()))
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            set_click_through,
            wake_up_pet,
            get_clipboard_history,
            add_to_clipboard_history,
            copy_to_clipboard,
            get_current_clipboard,
            clear_clipboard_history,
            manual_clipboard_check,
            open_expand_window,
            load_deepseek_config,
            send_chat_message,
            save_deepseek_config,
            load_local_deepseek_config,
            save_youdao_config,
            load_youdao_config,
            youdao_translate,
            get_todos_for_date,
            save_todos_for_date,
            open_todo_window,
            save_calendar_settings,
            load_calendar_settings,
            upload_background_image,
            delete_background_image,
            refresh_calendar_data,
            show_from_tray,
            hide_to_tray,
            show_pomodoro_notification,
            close_pomodoro_notification,
            save_jira_config,
            load_jira_config,
            save_git_config,
            load_git_config,
            get_my_unfinished_issues,
            get_my_today_worklogs,
            log_work,
            test_jira_connection,
            get_today_commits_by_user,
            get_current_date,
            get_required_work_hours,
            process_worklog_with_ai, // 添加新的AI命令
            save_ai_config,
            load_ai_config,
        ])
        .setup(|app| {
            // 创建托盘菜单
            let tray_menu = create_tray_menu(app.handle())?;

            // 创建托盘图标
            let _tray = TrayIconBuilder::with_id("main_tray")
                .menu(&tray_menu)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("XSun桌宠")
                .on_tray_icon_event(|tray, event| {
                    handle_tray_event(tray.app_handle(), event);
                })
                .on_menu_event(|tray, event| {
                    handle_tray_menu_event(tray.app_handle(), event);
                })
                .build(app)?;
            // 窗口初始化
            if let Some(main_window) = app.get_webview_window("main") {
                if let Err(e) = main_window.hide() {
                    eprintln!("Failed to hide main window: {}", e);
                }
            }

            if let Some(clipboard_window) = app.get_webview_window("clipboard") {
                if let Err(e) = clipboard_window.hide() {
                    eprintln!("Failed to hide clipboard window: {}", e);
                }
            }

            if let Some(pet_window) = app.get_webview_window("pet") {
                if let Err(e) = window_utils::set_click_through(&pet_window, false) {
                    eprintln!("Failed to set click through for pet window: {}", e);
                }
            }

            // 系统信息监控任务
            let app_handle = app.app_handle().clone();
            let sys_state = app.state::<Arc<Mutex<System>>>().inner().clone();

            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(1));

                loop {
                    interval.tick().await;

                    let payload = {
                        let mut sys = match sys_state.lock() {
                            Ok(sys) => sys,
                            Err(e) => {
                                eprintln!("Failed to lock system state: {}", e);
                                break;
                            }
                        };
                        collect_system_info(&mut *sys)
                    };

                    if let Err(e) = app_handle.emit("system://stats", &payload) {
                        eprintln!("Failed to emit system stats: {}", e);
                        break;
                    }
                }
            });

            // 修复：使用正确的方法名
            let app_handle_clipboard = app.app_handle().clone();
            let clipboard_history = app.state::<Arc<ClipboardHistory>>().inner().clone();

            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(5)); // 增加到5秒，减少频率
                let mut consecutive_errors = 0;
                const MAX_CONSECUTIVE_ERRORS: usize = 5;

                println!("剪贴板监控任务启动");

                loop {
                    interval.tick().await;

                    // 使用正确的方法名
                    match clipboard_history.check_and_update_safe(&app_handle_clipboard) {
                        Ok(true) => {
                            println!("✓ 检测到新的剪贴板内容");
                            consecutive_errors = 0;
                        }
                        Ok(false) => {
                            consecutive_errors = 0;
                        }
                        Err(e) => {
                            consecutive_errors += 1;
                            eprintln!(
                                "剪贴板检查失败 ({}/{}): {}",
                                consecutive_errors, MAX_CONSECUTIVE_ERRORS, e
                            );

                            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                                eprintln!("剪贴板监控因连续错误过多而暂停60秒");
                                tokio::time::sleep(Duration::from_secs(60)).await;
                                consecutive_errors = 0;
                            } else {
                                tokio::time::sleep(Duration::from_secs(2)).await;
                            }
                        }
                    }
                }
            });

            println!("应用初始化完成，剪贴板监控已启动");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
