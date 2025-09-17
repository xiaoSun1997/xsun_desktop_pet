use tauri::{Runtime, WebviewWindow};

#[cfg(target_os = "windows")]
use windows::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT},
};

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
