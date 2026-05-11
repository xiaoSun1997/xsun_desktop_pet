use std::sync::OnceLock;
use std::thread;
use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM, HINSTANCE, HWND},
    UI::Input::KeyboardAndMouse::GetAsyncKeyState,
    UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, MSG, SetWindowsHookExW,
        UnhookWindowsHookEx, HHOOK, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
        KBDLLHOOKSTRUCT,
    },
};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

const VK_TAB: u32 = 0x09;    // Tab 键
const VK_MENU: i32 = 0x12;   // Alt 键（用于 GetAsyncKeyState）
const VK_CONTROL: i32 = 0x11; // Ctrl 键（用于 GetAsyncKeyState）
const VK_S: u32 = 0x53;      // S 键
const VK_N: u32 = 0x4E;      // N 键

/// 使用 GetAsyncKeyState 实时检测按键是否被按下（返回值为负数表示当前按下）
fn is_key_pressed(vk: i32) -> bool {
    unsafe { GetAsyncKeyState(vk) < 0 }
}

unsafe extern "system" fn keyboard_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if n_code >= 0 {
        let p = l_param.0 as *const KBDLLHOOKSTRUCT;
        if !p.is_null() {
            let kb_struct = &*p;
            let is_keydown = w_param.0 == WM_KEYDOWN as usize || w_param.0 == WM_SYSKEYDOWN as usize;

            if is_keydown {
                let ctrl_pressed = is_key_pressed(VK_CONTROL);
                let alt_pressed = is_key_pressed(VK_MENU);

                // Alt+S → 打开快速文件搜索
                if kb_struct.vkCode == VK_S && alt_pressed && !ctrl_pressed {
                    if let Some(app_handle) = APP_HANDLE.get() {
                        let _ = app_handle.emit("keyboard://alt-s", ());
                    }
                    return LRESULT(1);
                }

                // Ctrl+Alt+N → 打开记事本
                if kb_struct.vkCode == VK_N && ctrl_pressed && alt_pressed {
                    if let Some(app_handle) = APP_HANDLE.get() {
                        let _ = app_handle.emit("keyboard://ctrl-alt-n", ());
                    }
                    return LRESULT(1);
                }

                // Ctrl+Tab → 打开功能菜单
                if kb_struct.vkCode == VK_TAB && ctrl_pressed && !alt_pressed {
                    if let Some(app_handle) = APP_HANDLE.get() {
                        let _ = app_handle.emit("keyboard://ctrl-tab", ());
                    }
                    return LRESULT(1);
                }
            }
        }
    }
    CallNextHookEx(HHOOK(std::ptr::null_mut()), n_code, w_param, l_param)
}

pub fn init_global_keyboard_hook(app_handle: AppHandle) {
    if APP_HANDLE.set(app_handle).is_err() {
        eprintln!("全局键盘钩子已初始化，跳过");
        return;
    }

    thread::spawn(|| {
        unsafe {
            let hook = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(keyboard_proc),
                HINSTANCE::default(),
                0,
            );

            let hook = match hook {
                Ok(h) => h,
                Err(e) => {
                    eprintln!("设置全局键盘钩子失败: {:?}", e);
                    return;
                }
            };

            println!("全局键盘钩子已启动");

            let mut msg = MSG::default();
            let mut last_heartbeat = std::time::Instant::now();
            while GetMessageW(&mut msg, HWND(std::ptr::null_mut()), 0, 0).as_bool() {
                // 每30秒输出一次心跳日志，确认钩子存活
                let now = std::time::Instant::now();
                if now.duration_since(last_heartbeat).as_secs() >= 30 {
                    println!("全局键盘钩子心跳 - 正常运行中");
                    last_heartbeat = now;
                }
            }

            // 消息循环退出，说明钩子已被卸载
            eprintln!("全局键盘钩子消息循环异常退出！钩子将失效");
            let _ = UnhookWindowsHookEx(hook);
            println!("全局键盘钩子已卸载");
        }
    });
}
