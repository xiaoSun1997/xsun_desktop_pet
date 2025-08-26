use tauri::{Runtime, Window};

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT},
};

pub fn set_click_through<R: Runtime>(window: &Window<R>, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // 获取窗口句柄
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;

        // 将 hwnd 转换为 usize（内存地址），然后转换为 *mut c_void
        let hwnd_ptr: *mut std::ffi::c_void = hwnd.0 as *mut std::ffi::c_void;

        unsafe {
            // 通过 HWND 获取扩展样式
            let ex_style = GetWindowLongW(HWND(hwnd.0), GWL_EXSTYLE);

            // 修改样式以实现穿透
            let new_style = if enabled {
                ex_style | (WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0) as i32
            } else {
                ex_style & !(WS_EX_TRANSPARENT.0 as i32)
            };

            // 设置新的样式
            SetWindowLongW(HWND(hwnd.0), GWL_EXSTYLE, new_style);
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        // 对其他平台调用 Tauri 的 API 来忽略鼠标事件
        window.set_ignore_cursor_events(enabled).map_err(|e| e.to_string())
    }
}
