use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM, HINSTANCE, HWND},
    UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, MSG, SetWindowsHookExW,
        UnhookWindowsHookEx, HHOOK, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP,
        KBDLLHOOKSTRUCT,
    },
};

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static LAST_CLICK: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
static CTRL_DOWN: OnceLock<Mutex<bool>> = OnceLock::new();

const VK_OEM_3: u32 = 0xC0; // 反引号键 `` ` ``
const VK_LCONTROL: u32 = 0xA2; // 左 Ctrl 键（WH_KEYBOARD_LL 中实际报告的 vkCode）
const VK_RCONTROL: u32 = 0xA3; // 右 Ctrl 键
const VK_TAB: u32 = 0x09; // Tab 键
const VK_SPACE: u32 = 0x20; // 空格键

unsafe extern "system" fn keyboard_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if n_code >= 0 {
        let p = l_param.0 as *const KBDLLHOOKSTRUCT;
        if !p.is_null() {
            let kb_struct = &*p;

            // 双击反引号检测 (WM_KEYDOWN)
            if w_param.0 == WM_KEYDOWN as usize && kb_struct.vkCode == VK_OEM_3 {
                let now = Instant::now();
                if let Some(mutex) = LAST_CLICK.get() {
                    let mut last = mutex.lock().unwrap();
                    if let Some(last_time) = *last {
                        if now.duration_since(last_time).as_millis() < 500 {
                            // 双击反引号 → 发射事件
                            if let Some(app_handle) = APP_HANDLE.get() {
                                let _ = app_handle.emit("keyboard://double-backtick", ());
                            }
                            *last = None;
                            return LRESULT(1); // 消耗第二次按键，不让它输入到界面
                        }
                        // 时间窗口已过，重置为当前按键开启新一轮检测
                        *last = Some(now);
                    } else {
                        *last = Some(now);
                    }
                }
            }

            // Ctrl 键状态追踪：按下/抬起
            if kb_struct.vkCode == VK_LCONTROL || kb_struct.vkCode == VK_RCONTROL {
                if w_param.0 == WM_KEYDOWN as usize {
                    if let Some(mutex) = CTRL_DOWN.get() {
                        *mutex.lock().unwrap() = true;
                    }
                    // 单独 Ctrl 键不消耗，正常传递
                } else if w_param.0 == WM_KEYUP as usize {
                    if let Some(mutex) = CTRL_DOWN.get() {
                        *mutex.lock().unwrap() = false;
                    }
                }
            }

            // Ctrl+空格 → 打开快速文件搜索
            if w_param.0 == WM_KEYDOWN as usize && kb_struct.vkCode == VK_SPACE {
                let ctrl_down = CTRL_DOWN.get().map(|m| *m.lock().unwrap()).unwrap_or(false);
                if ctrl_down {
                    if let Some(app_handle) = APP_HANDLE.get() {
                        let _ = app_handle.emit("keyboard://ctrl-space", ());
                    }
                    // 消耗 Space 按键事件，阻止它输入到界面
                    return LRESULT(1);
                }
            }

            // Ctrl+Tab → 打开功能菜单
            if w_param.0 == WM_KEYDOWN as usize && kb_struct.vkCode == VK_TAB {
                let ctrl_down = CTRL_DOWN.get().map(|m| *m.lock().unwrap()).unwrap_or(false);
                if ctrl_down {
                    if let Some(app_handle) = APP_HANDLE.get() {
                        let _ = app_handle.emit("keyboard://ctrl-tab", ());
                    }
                    // 消耗 Tab 按键事件，阻止焦点切换
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
    let _ = LAST_CLICK.set(Mutex::new(None));
    let _ = CTRL_DOWN.set(Mutex::new(false));

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
