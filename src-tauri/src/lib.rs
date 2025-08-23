use serde::Serialize;
use std::sync::{Arc, Mutex};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::Duration;

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
        .invoke_handler(tauri::generate_handler![get_system_info])
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
