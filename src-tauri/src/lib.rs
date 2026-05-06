use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow,WebviewWindowBuilder,
            menu::{Menu, MenuItemBuilder, PredefinedMenuItem},
            tray::{TrayIcon, TrayIconBuilder, TrayIconEvent, MouseButton}};
use tokio::time::Duration;
use urlencoding::encode as urlencode;
use std::collections::HashMap;

mod calendar;
mod clipboard;
mod global_mouse;
mod jira_tools;
mod task_scheduler;
mod window_utils;
mod database;
use database::{Database, NoteRecord};

use clipboard::{
    add_to_clipboard_history, clear_clipboard_history, copy_to_clipboard, get_clipboard_history,
    get_clipboard_history_paginated, delete_clipboard_item,
    get_current_clipboard, manual_clipboard_check, ClipboardHistory,
};

use global_mouse::init_global_mouse_hook;

use jira_tools::{
    GitCommit, JiraIssue, WorklogEntry, JiraConfig, GitConfig, GitRepository, test_jira_connection
};

use task_scheduler::init_scheduler;

use uuid::Uuid;

#[derive(Serialize, Clone)]
struct SystemInfo {
    cpu_usage: f32,
    total_memory: u64,
    used_memory: u64,
    total_swap: u64,
    used_swap: u64,
    uptime: u64,
    os_name: String,
    os_version: String,
    host_name: String,
    total_processes: usize,
    cpu_cores: usize,
    cpu_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_usage: f32,
    pub memory: u64,
    pub exe_path: String,
    pub ports: Vec<u16>,
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
    sys.refresh_cpu_specifics(sysinfo::CpuRefreshKind::everything());

    let cpu_usage = sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / sys.cpus().len() as f32;
    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();
    let total_swap = sys.total_swap();
    let used_swap = sys.used_swap();
    let uptime = System::uptime();
    let os_name = System::name().unwrap_or_default();
    let os_version = System::os_version().unwrap_or_default();
    let host_name = System::host_name().unwrap_or_default();
    let total_processes = sys.processes().len();
    let cpu_cores = sys.cpus().len();
    let cpu_name = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_default();

    SystemInfo {
        cpu_usage,
        total_memory,
        used_memory,
        total_swap,
        used_swap,
        uptime,
        os_name,
        os_version,
        host_name,
        total_processes,
        cpu_cores,
        cpu_name,
    }
}

// 获取端口与PID映射
fn get_port_pid_mapping() -> std::collections::HashMap<u32, Vec<u16>> {
    let mut map: std::collections::HashMap<u32, Vec<u16>> = std::collections::HashMap::new();

    if cfg!(target_os = "windows") {
        if let Ok(output) = std::process::Command::new("netstat")
            .args(&["-ano", "-p", "tcp"])
            .output()
        {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 5 {
                        if let Some(local_addr) = parts.get(1) {
                            if let Some(port_str) = local_addr.split(':').last() {
                                if let Ok(port) = port_str.parse::<u16>() {
                                    if let Some(pid_str) = parts.last() {
                                        if let Ok(pid) = pid_str.parse::<u32>() {
                                            map.entry(pid).or_default().push(port);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    map
}

// 获取进程列表
#[tauri::command]
fn get_processes(state: tauri::State<Arc<Mutex<System>>>, sort_by: String) -> Vec<ProcessInfo> {
    let mut sys = state.lock().unwrap();
    sys.refresh_all();
    sys.refresh_cpu_specifics(sysinfo::CpuRefreshKind::everything());

    // 获取端口映射
    let port_map = get_port_pid_mapping();

    let mut processes: Vec<ProcessInfo> = sys.processes().iter().map(|(pid, process)| {
        let p: u32 = pid.as_u32();
        ProcessInfo {
            pid: p,
            name: process.name().to_string(),
            cpu_usage: process.cpu_usage(),
            memory: process.memory(),
            exe_path: process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
            ports: port_map.get(&p).cloned().unwrap_or_default(),
        }
    }).collect();

    match sort_by.as_str() {
        "memory" => processes.sort_by(|a, b| b.memory.cmp(&a.memory)),
        _ => processes.sort_by(|a, b| b.cpu_usage.partial_cmp(&a.cpu_usage).unwrap_or(std::cmp::Ordering::Equal)),
    }

    processes.truncate(20);
    processes
}

// 杀进程
#[tauri::command]
fn kill_process(pid: u32) -> Result<(), String> {
    let output = std::process::Command::new("taskkill")
        .args(&["/PID", &pid.to_string(), "/F"])
        .output()
        .map_err(|e| format!("执行taskkill失败: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("杀进程失败(PID:{}): {}", pid, stderr))
    }
}

// ===== 进程图标提取（前端映射为主，后端提供 exe_path） =====
#[derive(Default)]
pub struct ProcessIconCache(Mutex<HashMap<String, String>>);

#[cfg(target_os = "windows")]
fn extract_icon_from_exe(exe_path: &str) -> Option<String> {
    // 简单尝试：读取 exe 所在目录的 .exe 图标资源（暂未实现完整图标提取）
    let _ = exe_path;
    None
}

#[cfg(not(target_os = "windows"))]
fn extract_icon_from_exe(_exe_path: &str) -> Option<String> {
    None
}

#[tauri::command]
fn get_process_icon(
    exe_path: String,
    cache: tauri::State<'_, ProcessIconCache>,
) -> Option<String> {
    if exe_path.is_empty() {
        return None;
    }
    let mut guard = cache.0.lock().ok()?;
    if let Some(cached) = guard.get(&exe_path) {
        return Some(cached.clone());
    }
    if let Some(icon) = extract_icon_from_exe(&exe_path) {
        guard.insert(exe_path, icon.clone());
        Some(icon)
    } else {
        None
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

// 打开翻译窗口并填充选中文本
#[tauri::command]
async fn open_translator_with_text(text: String, app: AppHandle) -> Result<(), String> {
    // 检查窗口是否已存在
    if let Some(existing_window) = app.get_webview_window("translator") {
        // 窗口已存在，发送填充事件
        existing_window
            .emit("translator://fill-text", &text)
            .map_err(|e| format!("发送填充事件失败: {}", e))?;
        existing_window
            .show()
            .map_err(|e| format!("显示窗口失败: {}", e))?;
        existing_window
            .set_focus()
            .map_err(|e| format!("聚焦窗口失败: {}", e))?;
        return Ok(());
    }

    // 创建新窗口并注入文本
    let webview_window = WebviewWindowBuilder::new(
        &app,
        "translator",
        WebviewUrl::App("index.html".into()),
    )
    .title("有道翻译")
    .inner_size(1000.0, 700.0)
    .visible(true)
    .transparent(true)
    .decorations(false)
    .resizable(true)
    .center()
    .initialization_script(&format!(
        "window.__TRANSLATE_TEXT__ = {};",
        serde_json::to_string(&text).map_err(|e| e.to_string())?
    ))
    .build()
    .map_err(|e| format!("创建翻译窗口失败: {}", e))?;

    webview_window
        .show()
        .map_err(|e| format!("显示窗口失败: {}", e))?;
    webview_window
        .set_focus()
        .map_err(|e| format!("聚焦窗口失败: {}", e))?;

    Ok(())
}

// 打开JSON格式化窗口并填充选中文本
#[tauri::command]
async fn open_json_compare_with_text(text: String, app: AppHandle) -> Result<(), String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let window_label = format!("json-format-{}", timestamp);

    let webview_window = WebviewWindowBuilder::new(
        &app,
        &window_label,
        WebviewUrl::App("index.html".into()),
    )
    .title("JSON格式化工具")
    .inner_size(900.0, 600.0)
    .visible(true)
    .transparent(true)
    .decorations(false)
    .resizable(true)
    .center()
    .skip_taskbar(true)
    .initialization_script(&format!(
        "window.__JSON_TEXT__ = {};",
        serde_json::to_string(&text).map_err(|e| e.to_string())?
    ))
    .build()
    .map_err(|e| format!("创建JSON格式化窗口失败: {}", e))?;

    webview_window
        .show()
        .map_err(|e| format!("显示窗口失败: {}", e))?;
    webview_window
        .set_focus()
        .map_err(|e| format!("聚焦窗口失败: {}", e))?;

    Ok(())
}

// 在默认浏览器中打开URL
#[tauri::command]
async fn open_url_in_browser(url: String) -> Result<(), String> {
    // 如果URL未包含协议前缀，自动添加 https://
    let url = url.trim();
    let url = if !url.starts_with("http://") && !url.starts_with("https://") {
        format!("https://{}", url)
    } else {
        url.to_string()
    };
    tauri_plugin_opener::open_path(&url, Option::<&str>::None)
        .map_err(|e| format!("打开URL失败: {}", e))?;
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

// SSE流式响应结构
#[derive(Deserialize, Debug)]
struct StreamChoice {
    delta: StreamDelta,
    #[allow(dead_code)]
    finish_reason: Option<String>,
}

#[derive(Deserialize, Debug)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    role: Option<String>,
}

#[derive(Deserialize, Debug)]
struct StreamResponse {
    choices: Vec<StreamChoice>,
}

// 流式AI对话
#[tauri::command]
async fn stream_chat_message(
    app: tauri::AppHandle,
    messages: Vec<ChatMessage>,
    session_id: Option<String>,
) -> Result<(), String> {
    let config = load_deepseek_config(app.clone()).await?;

    // 如果提供了session_id，保存用户最新消息到数据库
    if let Some(ref sid) = session_id {
        if let Some(last_msg) = messages.last() {
            if let Some(db) = app.try_state::<Database>() {
                let _ = db.add_chat_message(sid, &last_msg.role, &last_msg.content);
                // 如果是第一条消息，用内容生成标题
                let msgs = db.get_chat_messages(sid).unwrap_or_default();
                if msgs.len() <= 1 {
                    let title = if last_msg.content.len() > 30 {
                        format!("{}...", &last_msg.content[..30])
                    } else {
                        last_msg.content.clone()
                    };
                    let _ = db.update_chat_session_title(sid, &title);
                }
            }
        }
    }

    let client = reqwest::Client::new();
    let chat_request = ChatRequest {
        model: config.model,
        messages,
        stream: true,
    };

    let response = client
        .post(&format!("{}/chat/completions", config.base_url))
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .json(&chat_request)
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        let err_msg = format!("API请求失败 ({}): {}", status, error_text);
        let _ = app.emit("chat://stream-error", serde_json::json!({"error": &err_msg}));
        return Err(err_msg);
    }

    // 流式读取SSE响应
    use tokio_stream::StreamExt;
    let mut stream = response.bytes_stream();
    let mut full_content = String::new();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                let err_msg = format!("读取响应流失败: {}", e);
                let _ = app.emit("chat://stream-error", serde_json::json!({"error": &err_msg}));
                return Err(err_msg);
            }
        };

        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // 解析SSE事件 (按行处理)
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            if line == "data: [DONE]" {
                break;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(sse) = serde_json::from_str::<StreamResponse>(data) {
                    if let Some(choice) = sse.choices.first() {
                        if let Some(ref delta_content) = choice.delta.content {
                            full_content.push_str(delta_content);
                            let _ = app.emit("chat://stream-token", serde_json::json!({
                                "token": delta_content
                            }));
                        }
                    }
                }
            }
        }
    }

    // 流式完成, 发送完成事件
    let _ = app.emit("chat://stream-done", serde_json::json!({
        "content": full_content
    }));

    // 保存AI响应到数据库
    if let Some(ref sid) = session_id {
        if !full_content.is_empty() {
            if let Some(db) = app.try_state::<Database>() {
                let _ = db.add_chat_message(sid, "assistant", &full_content);
            }
        }
    }

    Ok(())
}

// 保留非流式命令作为备用
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
// 保存配置到数据库
#[tauri::command]
async fn save_deepseek_config(app: tauri::AppHandle, config: DeepSeekConfig) -> Result<(), String> {
    let db = app.state::<Database>();
    let config_json =
        serde_json::to_string(&config).map_err(|e| format!("序列化配置失败: {}", e))?;
    db.set_config("ai_config", &config_json)
}

// 从数据库加载配置
#[tauri::command]
async fn load_local_deepseek_config(
    app: tauri::AppHandle,
) -> Result<Option<DeepSeekConfig>, String> {
    let db = app.state::<Database>();
    match db.get_config("ai_config")? {
        Some(json) => {
            let config: DeepSeekConfig = serde_json::from_str(&json)
                .map_err(|e| format!("解析配置失败: {}", e))?;
            Ok(Some(config))
        }
        None => Ok(None),
    }
}

// 修改原有的加载配置函数，优先使用数据库，再回退到资源文件
#[tauri::command]
async fn load_deepseek_config(app: tauri::AppHandle) -> Result<DeepSeekConfig, String> {
    // 先尝试从数据库加载
    let db = app.state::<Database>();
    if let Ok(Some(json)) = db.get_config("ai_config") {
        if let Ok(config) = serde_json::from_str::<DeepSeekConfig>(&json) {
            if !config.api_key.is_empty() && config.api_key != "your_deepseek_api_key_here" {
                return Ok(config);
            }
        }
    }

    // 如果数据库配置不存在或无效，尝试加载资源文件配置
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

// ==================== 对话历史命令 ====================

#[tauri::command]
async fn create_chat_session(
    app: tauri::AppHandle,
) -> Result<database::ChatSession, String> {
    let db = app.state::<Database>();
    let id = db.create_chat_session("新对话")?;
    let session = db.get_chat_session(&id)?.ok_or("创建会话失败")?;
    Ok(session)
}

#[tauri::command]
async fn get_chat_sessions(
    app: tauri::AppHandle,
) -> Result<Vec<database::ChatSession>, String> {
    let db = app.state::<Database>();
    db.get_chat_sessions()
}

#[tauri::command]
async fn get_chat_session_messages(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<Vec<database::ChatMessageRecord>, String> {
    let db = app.state::<Database>();
    db.get_chat_messages(&session_id)
}

#[tauri::command]
async fn delete_chat_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let db = app.state::<Database>();
    db.delete_chat_session(&session_id)
}

#[tauri::command]
async fn update_chat_session_title(
    app: tauri::AppHandle,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let db = app.state::<Database>();
    db.update_chat_session_title(&session_id, &title)
}

#[tauri::command]
async fn save_chat_message(
    app: tauri::AppHandle,
    session_id: String,
    role: String,
    content: String,
) -> Result<i64, String> {
    let db = app.state::<Database>();
    db.add_chat_message(&session_id, &role, &content)
}

#[tauri::command]
async fn toggle_chat_session_pin(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<bool, String> {
    let db = app.state::<Database>();
    db.toggle_chat_session_pin(&session_id)
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
use tauri::WebviewUrl;
use tauri::menu::MenuItem;
use crate::jira_tools::{get_commits_by_date, get_current_date, get_my_today_worklogs, get_my_unfinished_issues, get_required_work_hours, load_ai_config, load_git_config, load_jira_config, log_work, process_worklog_with_ai, save_ai_config, save_git_config, save_jira_config};

// 生成有道翻译签名
// 修改签名生成函数
fn generate_youdao_sign(app_key: &str, query: &str, salt: &str, app_secret: &str) -> String {
    let sign_str = format!("{}{}{}{}", app_key, query, salt, app_secret);
    format!("{:x}", md5::compute(sign_str.as_bytes()))
}

// 保存有道翻译配置
#[tauri::command]
async fn save_youdao_config(app: tauri::AppHandle, config: YoudaoConfig) -> Result<(), String> {
    let db = app.state::<Database>();
    let config_json =
        serde_json::to_string(&config).map_err(|e| format!("序列化配置失败: {}", e))?;
    db.set_config("youdao_config", &config_json)
}

// 加载有道翻译配置
#[tauri::command]
async fn load_youdao_config(app: tauri::AppHandle) -> Result<Option<YoudaoConfig>, String> {
    let db = app.state::<Database>();
    match db.get_config("youdao_config")? {
        Some(json) => {
            let config: YoudaoConfig = serde_json::from_str(&json)
                .map_err(|e| format!("解析配置失败: {}", e))?;
            Ok(Some(config))
        }
        None => Ok(None),
    }
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
    let db = app.state::<Database>();
    let cal_todos = db.get_todos_by_date(&date)?;
    Ok(cal_todos.into_iter().map(|t| TodoItem {
        id: t.id,
        content: t.content,
        completed: t.completed,
        created_at: t.created_at,
    }).collect())
}

#[tauri::command]
async fn save_todos_for_date(
    app: AppHandle,
    date: String,
    todos: Vec<TodoItem>,
) -> Result<(), String> {
    let db = app.state::<Database>();
    let cal_todos: Vec<crate::calendar::TodoItem> = todos.into_iter().map(|t| {
        crate::calendar::TodoItem {
            id: t.id,
            content: t.content,
            completed: t.completed,
            created_at: t.created_at,
            priority: None,
            category: None,
        }
    }).collect();
    db.save_todos_for_date(&date, &cal_todos)
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
    let db = app.state::<Database>();
    let json = serde_json::to_string(&settings).map_err(|e| format!("序列化配置失败: {}", e))?;
    db.set_config("calendar_settings", &json)
}

#[tauri::command]
async fn load_calendar_settings(app: AppHandle) -> Result<CalendarSettings, String> {
    let db = app.state::<Database>();
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    let mut settings = match db.get_config("calendar_settings")? {
        Some(json) => serde_json::from_str(&json).map_err(|e| format!("解析配置失败: {}", e))?,
        None => CalendarSettings {
            background_images: vec!["../data/img0.jpeg".to_string()],
            rotation_interval: 30,
        },
    };

    // 将旧的相对路径 background_images/xxx 转换为绝对路径
    for path in &mut settings.background_images {
        if !path.is_empty() && !path.starts_with("..") && !path.starts_with("./") && !path.starts_with("/") && !path.starts_with("data/") && !path.starts_with("http") && !path.starts_with("file") {
            // 如果是相对路径（如 background_images/bg_xxx.jpg），转换为绝对路径
            if !std::path::Path::new(path).is_absolute() {
                *path = app_data_dir.join(&*path).to_string_lossy().to_string();
            }
        }
    }

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

    // 返回绝对路径，方便前端通过 convertFileSrc 访问
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn delete_background_image(_app: AppHandle, image_path: String) -> Result<(), String> {
    let file_path = std::path::Path::new(&image_path);

    if file_path.is_absolute() {
        if tokio::fs::try_exists(&file_path).await.unwrap_or(false) {
            tokio::fs::remove_file(&file_path)
                .await
                .map_err(|e| format!("删除图片失败: {}", e))?;
        }
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
// 番茄钟设置结构体
#[derive(Serialize, Deserialize, Clone)]
struct PomodoroSettings {
    workStartTime: String,
    workEndTime: String,
    workDuration: u32,
    breakDuration: u32,
    enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct PomodoroTimerState {
    isWorkTime: bool,
    isRunning: bool,
    cycleStartTime: Option<i64>,
}

#[tauri::command]
async fn save_pomodoro_settings(app: AppHandle, settings: PomodoroSettings) -> Result<(), String> {
    let db = app.state::<Database>();
    let json = serde_json::to_string(&settings).map_err(|e| format!("序列化配置失败: {}", e))?;
    db.set_config("pomodoro_settings", &json)
}

#[tauri::command]
async fn load_pomodoro_settings(app: AppHandle) -> Result<Option<PomodoroSettings>, String> {
    let db = app.state::<Database>();
    match db.get_config("pomodoro_settings")? {
        Some(json) => {
            let settings: PomodoroSettings = serde_json::from_str(&json)
                .map_err(|e| format!("解析配置失败: {}", e))?;
            Ok(Some(settings))
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn save_pomodoro_timer(app: AppHandle, timer_state: Option<PomodoroTimerState>) -> Result<(), String> {
    let db = app.state::<Database>();
    match timer_state {
        Some(state) => {
            let json = serde_json::to_string(&state).map_err(|e| format!("序列化失败: {}", e))?;
            db.set_config("pomodoro_timer", &json)
        }
        None => db.delete_config("pomodoro_timer"),
    }
}

#[tauri::command]
async fn load_pomodoro_timer(app: AppHandle) -> Result<Option<PomodoroTimerState>, String> {
    let db = app.state::<Database>();
    match db.get_config("pomodoro_timer")? {
        Some(json) => {
            let state: PomodoroTimerState = serde_json::from_str(&json)
                .map_err(|e| format!("解析失败: {}", e))?;
            Ok(Some(state))
        }
        None => Ok(None),
    }
}

// ===== 地图绘制数据持久化 =====

#[tauri::command]
async fn save_map_data(app: AppHandle, name: String, data: String) -> Result<(), String> {
    let db = app.state::<Database>();
    db.save_map(&name, &data)
}

#[tauri::command]
async fn load_map_data(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let db = app.state::<Database>();
    db.get_map(&name)
}

#[tauri::command]
async fn list_map_names(app: AppHandle) -> Result<Vec<String>, String> {
    let db = app.state::<Database>();
    db.list_map_names()
}

#[tauri::command]
async fn delete_map_data(app: AppHandle, name: String) -> Result<(), String> {
    let db = app.state::<Database>();
    db.delete_map(&name)
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileEntry>>,
}

fn list_dir_recursive(dir: &std::path::Path, base: &std::path::Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir.display(), e))?;
    
    let mut dirs: Vec<_> = Vec::new();
    let mut files: Vec<_> = Vec::new();
    
    for entry in read_dir {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let relative = path.strip_prefix(base).unwrap_or(&path).to_string_lossy().to_string();
        
        if path.is_dir() {
            dirs.push((name, path, relative));
        } else {
            files.push((name, path, relative));
        }
    }
    
    // 目录排在前面
    dirs.sort_by(|a, b| a.0.cmp(&b.0));
    files.sort_by(|a, b| a.0.cmp(&b.0));
    
    for (name, path, relative) in dirs {
        let children = list_dir_recursive(&path, base)?;
        entries.push(FileEntry {
            name,
            path: relative,
            is_dir: true,
            children: Some(children),
        });
    }
    
    for (name, _path, relative) in files {
        entries.push(FileEntry {
            name,
            path: relative,
            is_dir: false,
            children: None,
        });
    }
    
    Ok(entries)
}

#[tauri::command]
async fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("写入文件失败: {}", e))
}

#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))
}

#[tauri::command]
async fn get_skills_dir(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    let skills_dir = app_data_dir.join("skills");
    std::fs::create_dir_all(&skills_dir).map_err(|e| format!("创建skills目录失败: {}", e))?;
    Ok(skills_dir.to_string_lossy().to_string())
}

fn flatten_file_tree(entries: &[FileEntry]) -> Vec<database::SkillFileRecord> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let mut records = Vec::new();
    for entry in entries {
        let parent_path = std::path::Path::new(&entry.path)
            .parent()
            .and_then(|p| {
                let s = p.to_string_lossy().to_string();
                if s.is_empty() || s == "." { None } else { Some(s) }
            })
            .unwrap_or_default();
        records.push(database::SkillFileRecord {
            path: entry.path.clone(),
            name: entry.name.clone(),
            is_dir: entry.is_dir,
            parent_path,
            created_at: now,
            updated_at: now,
        });
        if let Some(children) = &entry.children {
            records.extend(flatten_file_tree(children));
        }
    }
    records
}

#[tauri::command]
async fn list_skills_directory(app: AppHandle) -> Result<Vec<FileEntry>, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    let skills_dir = app_data_dir.join("skills");
    if !skills_dir.exists() {
        std::fs::create_dir_all(&skills_dir).map_err(|e| format!("创建skills目录失败: {}", e))?;
        return Ok(Vec::new());
    }
    let tree = list_dir_recursive(&skills_dir, &skills_dir)?;
    // 同步到数据库
    if let Some(db) = app.try_state::<Database>() {
        let records = flatten_file_tree(&tree);
        let _ = db.sync_skill_files(&records);
    }
    Ok(tree)
}

#[tauri::command]
async fn copy_to_skills(app: AppHandle, source_path: String) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    let skills_dir = app_data_dir.join("skills");
    std::fs::create_dir_all(&skills_dir).map_err(|e| format!("创建skills目录失败: {}", e))?;
    
    let source = std::path::Path::new(&source_path);
    if !source.exists() {
        return Err(format!("源文件不存在: {}", source_path));
    }
    
    let filename = source.file_name()
        .ok_or_else(|| "无效文件名".to_string())?
        .to_string_lossy()
        .to_string();
    let dest = skills_dir.join(&filename);
    
    if source.is_dir() {
        copy_dir_recursive(source, &dest)?;
    } else {
        std::fs::copy(source, &dest).map_err(|e| format!("复制文件失败: {}", e))?;
    }
    
    Ok(filename)
}

#[tauri::command]
async fn delete_skill_item(app: AppHandle, file_path: String, is_dir: bool) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    let full_path = app_data_dir.join("skills").join(&file_path);
    
    if !full_path.exists() {
        return Err(format!("文件不存在: {}", full_path.display()));
    }
    
    if is_dir {
        std::fs::remove_dir_all(&full_path).map_err(|e| format!("删除文件夹失败: {}", e))?;
    } else {
        std::fs::remove_file(&full_path).map_err(|e| format!("删除文件失败: {}", e))?;
    }
    
    // 从数据库删除记录
    if let Some(db) = app.try_state::<Database>() {
        let _ = db.remove_skill_file_record(&file_path);
    }
    
    Ok(())
}

#[tauri::command]
async fn create_skill_folder(app: AppHandle, name: String, parent_path: String) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("文件夹名称不能为空".to_string());
    }
    // 检查非法字符
    let invalid_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    if name.contains(&invalid_chars) {
        return Err("文件夹名称包含非法字符 (/ \\ : * ? \" < > |)".to_string());
    }
    
    let app_data_dir = app.path().app_data_dir().map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    let skills_dir = app_data_dir.join("skills");
    let folder_path = if parent_path.is_empty() {
        skills_dir.join(&name)
    } else {
        skills_dir.join(&parent_path).join(&name)
    };
    
    if folder_path.exists() {
        return Err(format!("文件夹 '{}' 已存在", name));
    }
    
    std::fs::create_dir_all(&folder_path).map_err(|e| format!("创建文件夹失败: {}", e))?;
    
    let relative_path = if parent_path.is_empty() {
        name.clone()
    } else {
        format!("{}/{}", parent_path, name)
    };
    
    // 添加到数据库
    if let Some(db) = app.try_state::<Database>() {
        let _ = db.add_skill_folder_record(&relative_path, &name, &parent_path);
    }
    
    Ok(())
}

#[tauri::command]
async fn create_skill_file(app: AppHandle, relative_path: String) -> Result<(), String> {
    let relative_path = relative_path.trim().to_string();
    if relative_path.is_empty() {
        return Err("文件路径不能为空".to_string());
    }
    
    let app_data_dir = app.path().app_data_dir().map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    let full_path = app_data_dir.join("skills").join(&relative_path);
    
    if full_path.exists() {
        return Err(format!("文件 '{}' 已存在", relative_path));
    }
    
    // 确保父目录存在
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    
    std::fs::write(&full_path, "").map_err(|e| format!("创建文件失败: {}", e))?;
    
    Ok(())
}

fn copy_dir_recursive(src: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("创建目录失败: {}", e))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();
        let name = entry.file_name();
        let dest_path = dest.join(&name);
        if path.is_dir() {
            copy_dir_recursive(&path, &dest_path)?;
        } else {
            std::fs::copy(&path, &dest_path).map_err(|e| format!("复制文件失败: {}", e))?;
        }
    }
    Ok(())
}

// ==================== 记事本命令 ====================

#[tauri::command]
async fn get_all_notes(app: AppHandle) -> Result<Vec<NoteRecord>, String> {
    let db = app.state::<Database>();
    db.get_all_notes()
}

#[tauri::command]
async fn create_note_document(app: AppHandle, name: String, parent_path: String, is_dir: bool) -> Result<NoteRecord, String> {
    let db = app.state::<Database>();
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("名称不能为空".to_string());
    }
    db.create_note_document(&name, &parent_path, is_dir)
}

#[tauri::command]
async fn get_note_content(app: AppHandle, id: String) -> Result<String, String> {
    let db = app.state::<Database>();
    db.get_note_content(&id)
}

#[tauri::command]
async fn update_note_content(app: AppHandle, id: String, content: String) -> Result<(), String> {
    let db = app.state::<Database>();
    db.update_note_content(&id, &content)
}

#[tauri::command]
async fn rename_note_document(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let db = app.state::<Database>();
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("名称不能为空".to_string());
    }
    db.rename_note_document(&id, &name)
}

#[tauri::command]
async fn delete_note_document(app: AppHandle, id: String) -> Result<(), String> {
    let db = app.state::<Database>();
    db.delete_note_document(&id)
}

#[tauri::command]
async fn save_note_image(app: AppHandle, note_id: String, file_name: String, image_data_base64: String) -> Result<String, String> {
    use std::io::Write;
    let app_data_dir = app.path().app_data_dir().map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    let img_dir = app_data_dir.join("note_images").join(&note_id);
    std::fs::create_dir_all(&img_dir).map_err(|e| format!("创建图片目录失败: {}", e))?;
    
    let img_path = img_dir.join(&file_name);
    use base64::Engine as _;
    let img_data = base64::engine::general_purpose::STANDARD.decode(&image_data_base64)
        .map_err(|e| format!("解码图片数据失败: {}", e))?;
    
    let mut file = std::fs::File::create(&img_path).map_err(|e| format!("创建图片文件失败: {}", e))?;
    file.write_all(&img_data).map_err(|e| format!("写入图片数据失败: {}", e))?;
    
    Ok(img_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn read_clipboard_image(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    use base64::Engine;
    
    // 先尝试读取图片
    match app.clipboard().read_image() {
        Ok(img) => {
            let width = tauri::image::Image::width(&img);
            let height = tauri::image::Image::height(&img);
            let rgba = img.rgba().to_vec();
            
            if let Some(img_buffer) = image::RgbaImage::from_raw(width, height, rgba) {
                let mut png_bytes = std::io::Cursor::new(Vec::new());
                if image::DynamicImage::from(img_buffer)
                    .write_to(&mut png_bytes, image::ImageFormat::Png)
                    .is_ok()
                {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(png_bytes.into_inner());
                    return Ok(Some(format!("data:image/png;base64,{}", b64)));
                }
            }
            Ok(None)
        }
        _ => Ok(None),
    }
}

#[tauri::command]
async fn reveal_in_folder(path: String) -> Result<(), String> {
    let result = std::process::Command::new("explorer")
        .arg("/select,")
        .arg(&path)
        .spawn();
    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("打开文件位置失败: {}", e)),
    }
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
        .manage(ProcessIconCache::default())
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            get_processes,
            kill_process,
            get_process_icon,
            set_click_through,
            wake_up_pet,
            get_clipboard_history,
            get_clipboard_history_paginated,
            delete_clipboard_item,
            add_to_clipboard_history,
            copy_to_clipboard,
            get_current_clipboard,
            clear_clipboard_history,
            manual_clipboard_check,
            open_expand_window,
            load_deepseek_config,
            send_chat_message,
            stream_chat_message,
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
            get_commits_by_date,
            get_current_date,
            get_required_work_hours,
            process_worklog_with_ai,
            save_ai_config,
            load_ai_config,
            open_translator_with_text,
            open_json_compare_with_text,
            open_url_in_browser,
            save_pomodoro_settings,
            load_pomodoro_settings,
            save_pomodoro_timer,
            load_pomodoro_timer,
            save_map_data,
            load_map_data,
            list_map_names,
            delete_map_data,
            write_text_file,
            read_text_file,
            get_skills_dir,
            list_skills_directory,
            copy_to_skills,
            delete_skill_item,
            create_skill_folder,
            create_skill_file,
            reveal_in_folder,
            create_chat_session,
            get_chat_sessions,
            get_chat_session_messages,
            delete_chat_session,
            update_chat_session_title,
            save_chat_message,
            toggle_chat_session_pin,
            get_all_notes,
            create_note_document,
            get_note_content,
            update_note_content,
            rename_note_document,
            delete_note_document,
            save_note_image,
            read_clipboard_image,
        ])
        .setup(|app| {
            // 初始化 SQLite 数据库
            let handle = app.handle();
            match handle.path().app_data_dir() {
                Ok(app_data_dir) => {
                    let db_path = app_data_dir.join("data").join("app.db");
                    match database::Database::new(db_path.clone()) {
                        Ok(database) => {
                            if let Err(e) = database.init_tables() {
                                eprintln!("数据库表初始化失败: {}", e);
                            }
                            if let Err(e) = database.migrate_from_json(handle) {
                                eprintln!("数据迁移失败: {}", e);
                            }
                            app.manage(database);
                            println!("数据库初始化成功: {:?}", db_path);
                        }
                        Err(e) => {
                            eprintln!("数据库初始化失败: {}", e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("无法获取应用数据目录: {}", e);
                }
            }

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

            // 启动全局鼠标中键钩子
            init_global_mouse_hook(app.app_handle().clone());

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
            // 初始化定时任务调度器
            init_scheduler(app.app_handle().clone());

            println!("应用初始化完成，剪贴板监控已启动");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
