use tauri::{Runtime, WebviewWindow, AppHandle, Manager, Emitter};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::{HWND, LPARAM, WPARAM, LRESULT},
    UI::WindowsAndMessaging::{
        GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
        SetWindowsHookExW, UnhookWindowsHookEx, CallNextHookEx,
        HC_ACTION, WH_MOUSE_LL, WM_LBUTTONDOWN, HHOOK,
        GetCursorPos, WindowFromPoint
    },
    System::LibraryLoader::GetModuleHandleW,
};

// 全局状态用于存储钩子句柄和双击检测
static mut MOUSE_HOOK: Option<HHOOK> = None;
static LAST_CLICK_TIME: Mutex<Option<Instant>> = Mutex::new(None);
static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);

pub fn set_click_through<R: Runtime>(window: &WebviewWindow<R>, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;

        unsafe {
            let ex_style = GetWindowLongW(HWND(hwnd.0), GWL_EXSTYLE);
            let new_style = if enabled {
                ex_style | (WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0) as i32
            } else {
                ex_style & !(WS_EX_TRANSPARENT.0 as i32)
            };
            SetWindowLongW(HWND(hwnd.0), GWL_EXSTYLE, new_style);
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        window.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn low_level_mouse_proc(
    n_code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // 修正：HC_ACTION 是常量，直接比较，WM_LBUTTONDOWN 也是常量
    if n_code >= 0 && wparam.0 == WM_LBUTTONDOWN as usize {
        // 检测双击
        let now = Instant::now();
        let mut last_click = LAST_CLICK_TIME.lock().unwrap();

        let is_double_click = if let Some(last_time) = *last_click {
            now.duration_since(last_time) < Duration::from_millis(500)
        } else {
            false
        };

        *last_click = Some(now);

        if is_double_click {
            // 检查点击是否在桌宠窗口区域内
            if let Some(app_handle) = APP_HANDLE.lock().unwrap().as_ref() {
                if let Some(pet_window) = app_handle.get_webview_window("pet") {
                    if is_click_on_pet_window(&pet_window) {
                        // 唤醒桌宠
                        let _ = app_handle.emit("pet://wake-up", ());
                    }
                }
            }
        }
    }

    CallNextHookEx(None, n_code, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn is_click_on_pet_window<R: Runtime>(pet_window: &WebviewWindow<R>) -> bool {
    unsafe {
        let mut point = windows::Win32::Foundation::POINT { x: 0, y: 0 };
        if GetCursorPos(&mut point).is_ok() {
            if let Ok(hwnd) = pet_window.hwnd() {
                let window_at_point = WindowFromPoint(point);
                return window_at_point == HWND(hwnd.0);
            }
        }
    }
    false
}

pub async fn setup_global_mouse_hook(app_handle: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            // 存储app_handle到全局变量
            *APP_HANDLE.lock().unwrap() = Some(app_handle);

            let hook = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(low_level_mouse_proc),
                GetModuleHandleW(None).map_err(|e| e.to_string())?,
                0,
            ).map_err(|e| e.to_string())?;

            MOUSE_HOOK = Some(hook);
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

pub async fn remove_global_mouse_hook() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            if let Some(hook) = MOUSE_HOOK {
                UnhookWindowsHookEx(hook).map_err(|e| e.to_string())?;
                MOUSE_HOOK = None;
            }
            *APP_HANDLE.lock().unwrap() = None;
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}
