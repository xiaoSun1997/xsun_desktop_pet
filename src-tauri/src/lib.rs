use serde::Serialize;
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::time::Duration;

mod window_utils;

#[derive(Serialize, Clone)]
struct SystemInfo {
    cpu_usage: f32,
    total_memory: u64,
    used_memory: u64,
}

/// 普通命令：前端 invoke 调用
#[tauri::command]
fn get_system_info(state: tauri::State<Arc<Mutex<System>>>) -> SystemInfo {
    let mut sys = state.lock().unwrap();
    collect_system_info(&mut *sys)
}

/// 设置点击穿透
#[tauri::command]
async fn set_click_through(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window_utils::set_click_through(&window, enabled)
}

/// 新增：设置全局鼠标钩子用于双击唤醒
#[tauri::command]
async fn setup_global_mouse_hook(app_handle: AppHandle) -> Result<(), String> {
    window_utils::setup_global_mouse_hook(app_handle).await
}

/// 新增：移除全局鼠标钩子
#[tauri::command]
async fn remove_global_mouse_hook() -> Result<(), String> {
    window_utils::remove_global_mouse_hook().await
}

// 提取公共逻辑为函数
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
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(Mutex::new(System::new_all())))
        .invoke_handler(tauri::generate_handler![
            get_system_info, 
            set_click_through,
            setup_global_mouse_hook,
            remove_global_mouse_hook
        ])
        .setup(|app| {
            // 启动时隐藏main窗口
            if let Some(main_window) = app.get_webview_window("main") {
                if let Err(e) = main_window.hide() {
                    eprintln!("Failed to hide main window: {}", e);
                }
            }

            // 启动时设置 pet 窗口为点击穿透
            if let Some(pet_window) = app.get_webview_window("pet") {
                if let Err(e) = window_utils::set_click_through(&pet_window, true) {
                    eprintln!("Failed to set click through for pet window: {}", e);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 获取需要的引用
    let app_handle = app.app_handle().clone();
    let sys_state = app.state::<Arc<Mutex<System>>>().inner().clone();

    // 启动后台任务
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

    // 运行应用
    app.run(|_app, _event| {});
}
