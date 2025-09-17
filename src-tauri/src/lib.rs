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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init()) // 添加剪贴板插件
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
            manual_clipboard_check // 用于调试
        ])
        .setup(|app| {
            // 启动时隐藏窗口
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

            // 设置 pet 窗口
            if let Some(pet_window) = app.get_webview_window("pet") {
                if let Err(e) = window_utils::set_click_through(&pet_window, false) {
                    eprintln!("Failed to set click through for pet window: {}", e);
                }
            }

            // 系统信息定时任务
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

            // 剪贴板监控任务
            let app_handle_clipboard = app.app_handle().clone();
            let clipboard_history = app.state::<Arc<ClipboardHistory>>().inner().clone();

            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(3)); // 增加到3秒间隔
                let mut error_count = 0;
                const MAX_ERRORS: usize = 10;

                loop {
                    interval.tick().await;

                    // 添加错误计数和退出机制
                    match clipboard_history.check_and_update(&app_handle_clipboard) {
                        Ok(true) => {
                            println!("✓ 检测到新的剪贴板内容");
                            error_count = 0; // 重置错误计数
                        },
                        Ok(false) => {
                            error_count = 0; // 重置错误计数
                        },
                        Err(e) => {
                            error_count += 1;
                            eprintln!("剪贴板检查失败 ({}/{}): {}", error_count, MAX_ERRORS, e);

                            if error_count >= MAX_ERRORS {
                                eprintln!("剪贴板监控因连续错误过多而停止");
                                break;
                            }

                            // 错误时增加延迟
                            tokio::time::sleep(Duration::from_secs(5)).await;
                        }
                    }
                }

                println!("剪贴板监控任务已退出");
            });

            println!("剪贴板监控已启动");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
