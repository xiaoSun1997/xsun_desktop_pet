use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tauri_plugin_clipboard_manager::ClipboardExt;
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM, HINSTANCE, HWND, POINT},
    UI::{
        WindowsAndMessaging::{
            CallNextHookEx, GetCursorPos, GetMessageW, MSG, SetWindowsHookExW,
            UnhookWindowsHookEx, HHOOK, WH_MOUSE_LL, WM_MBUTTONDOWN,
        },
        Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
            VK_C, VK_CONTROL,
        },
    },
};
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct SelectionPayload {
    pub text: String,
    pub x: i32,
    pub y: i32,
}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

unsafe extern "system" fn mouse_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if n_code >= 0 && w_param.0 == WM_MBUTTONDOWN as usize {
        if let Some(app_handle) = APP_HANDLE.get() {
            handle_middle_click(app_handle.clone());
        }
    }
    CallNextHookEx(HHOOK(std::ptr::null_mut()), n_code, w_param, l_param)
}

fn handle_middle_click(app_handle: AppHandle) {
    // 1. 保存当前剪贴板内容
    let saved_clipboard = app_handle.clipboard().read_text().ok();

    // 2. 模拟 Ctrl+C
    simulate_ctrl_c();

    // 3. 轮询等待剪贴板更新（事件驱动，最大等待200ms）
    let selected_text = poll_clipboard_until_change(&app_handle, &saved_clipboard, Duration::from_millis(200));

    // 4. 恢复原剪贴板
    if let Some(ref saved) = saved_clipboard {
        let _ = app_handle.clipboard().write_text(saved.clone());
    }

    // 5. 获取鼠标屏幕坐标
    let (x, y) = get_cursor_pos();

    // 7. 如果有选中文本，发射事件
    if !selected_text.trim().is_empty() {
        let payload = SelectionPayload {
            text: selected_text,
            x,
            y,
        };
        let _ = app_handle.emit("selection://popup", payload);
    }
}

fn simulate_ctrl_c() {
    unsafe {
        // Ctrl 键按下
        let mut input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_CONTROL,
                    wScan: 0,
                    dwFlags: Default::default(),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);

        // C 键按下
        input.Anonymous.ki.wVk = VK_C;
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);

        // C 键释放
        input.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);

        // Ctrl 键释放
        input.Anonymous.ki.wVk = VK_CONTROL;
        input.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

/// 轮询剪贴板直到内容变化或超时，返回最终剪贴板内容
fn poll_clipboard_until_change(
    app_handle: &AppHandle,
    saved: &Option<String>,
    timeout: Duration,
) -> String {
    let poll_interval = Duration::from_millis(5);
    let start = std::time::Instant::now();
    
    loop {
        let current = app_handle.clipboard().read_text().ok().unwrap_or_default();
        
        // 剪贴板内容已变化且非空
        if !current.trim().is_empty() && Some(&current) != saved.as_ref() {
            return current;
        }
        
        // 超时
        if start.elapsed() >= timeout {
            return current;
        }
        
        thread::sleep(poll_interval);
    }
}

fn get_cursor_pos() -> (i32, i32) {
    unsafe {
        let mut point = POINT { x: 0, y: 0 };
        let _ = GetCursorPos(&mut point);
        (point.x, point.y)
    }
}

pub fn init_global_mouse_hook(app_handle: AppHandle) {
    // 存储 AppHandle 供回调使用
    if APP_HANDLE.set(app_handle).is_err() {
        eprintln!("全局鼠标钩子已初始化，跳过");
        return;
    }

    thread::spawn(|| {
        unsafe {
            let hook = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(mouse_proc),
                HINSTANCE::default(),
                0,
            );

            let hook = match hook {
                Ok(h) => h,
                Err(e) => {
                    eprintln!("设置全局鼠标钩子失败: {:?}", e);
                    return;
                }
            };

            println!("全局鼠标中键钩子已启动");

            // 消息循环 — WH_MOUSE_LL 需要消息泵才能工作
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0).as_bool() {
                // 处理消息 – 保持钩子活跃
            }

            // 线程退出时卸载钩子
            let _ = UnhookWindowsHookEx(hook);
            println!("全局鼠标钩子已卸载");
        }
    });
}
