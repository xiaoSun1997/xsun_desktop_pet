use serde::Serialize;
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::time::Duration;

mod window_utils;
mod clipboard;

use clipboard::{
    ClipboardHistory,
    get_clipboard_history,
    add_to_clipboard_history,
    copy_to_clipboard,
    get_current_clipboard,
    clear_clipboard_history,
    manual_clipboard_check
};

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
    let window_label = format!("expand_{}",
                               std::time::SystemTime::now()
                                   .duration_since(std::time::UNIX_EPOCH)
                                   .unwrap()
                                   .as_millis()
    );

    // 创建窗口
    let webview_window = WebviewWindowBuilder::new(
        &app,
        &window_label,
        WebviewUrl::App("index.html".into())
    )
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
    webview_window.show().map_err(|e| format!("显示窗口失败: {}", e))?;
    webview_window.set_focus().map_err(|e| format!("聚焦窗口失败: {}", e))?;

    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
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
            open_expand_window
        ])
        .setup(|app| {
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
                        },
                        Ok(false) => {
                            consecutive_errors = 0;
                        },
                        Err(e) => {
                            consecutive_errors += 1;
                            eprintln!("剪贴板检查失败 ({}/{}): {}", consecutive_errors, MAX_CONSECUTIVE_ERRORS, e);

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