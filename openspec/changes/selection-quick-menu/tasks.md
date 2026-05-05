## 1. Rust 后端：全局鼠标钩子核心

- [x] 1.1 在 `Cargo.toml` 的 windows feature 中添加 `Win32_UI_Input_KeyboardAndMouse`（用于 `SendInput`）
- [x] 1.2 创建 `src-tauri/src/global_mouse.rs`，实现 Windows 低层级鼠标钩子 (WH_MOUSE_LL)：
  - 钩子回调函数：检测 `WM_MBUTTONDOWN`（鼠标中键按下）
  - 保存当前剪贴板内容 → 模拟 Ctrl+C (SendInput) → 等待 100ms → 读取剪贴板 → 恢复原剪贴板
  - 获取鼠标屏幕坐标 (`GetCursorPos`)
  - 通过 `AppHandle` 发射 `selection://popup` 事件，传递 `{text, x, y}`
  - 安全卸载钩子（`UnhookWindowsHookEx`）

## 2. Rust 后端：注册钩子与 Command

- [x] 2.1 在 `src-tauri/src/lib.rs` 中，应用启动时初始化全局鼠标钩子（`setup` 阶段启动后台线程注册钩子）
- [x] 2.2 新增三个 Tauri Command：
  - `open_translator_with_text(text: String)` — 创建/聚焦 translator 窗口，通过初始化脚本注入文本
  - `open_json_compare_with_text(text: String)` — 创建/聚焦 json-compare 窗口，通过初始化脚本注入文本
  - `open_url_in_browser(url: String)` — 调用 `opener` 插件在默认浏览器中打开 URL

## 3. 前端：SelectionMenu 浮动菜单组件

- [x] 3.1 创建 `src/components/SelectionMenu.tsx`：
  - 监听 `selection://popup` 事件接收 `{text, x, y}`
  - 三个按钮：翻译、打开URL、JSON格式化
  - 点击菜单外部区域时自动关闭
  - 调用对应 `invoke` 命令执行操作
- [x] 3.2 创建 `src/components/SelectionMenu.css`，设计简洁的菜单样式（半透明背景、悬浮效果）
- [x] 3.3 在 `src/App.tsx` 中添加 `selection-menu` 窗口路由

## 4. 前端：现有组件适配

- [x] 4.1 `TranslatorComponent.tsx` — 添加对 `translator://fill-text` 事件的监听，接收到文本后自动填充到待翻译输入框
- [x] 4.2 `JsonCompareComponent.tsx` — 添加对 `json://fill-text` 事件的监听，接收到文本后自动填充到左侧 JSON 输入框并格式化

## 5. 验证与集成

- [ ] 5.1 验证全局鼠标中键监听在所有 Windows 应用中正常触发
- [ ] 5.2 验证选中文本读取准确，且剪贴板被正确恢复
- [ ] 5.3 验证三个快捷操作分别正确打开对应窗口并填充文本
- [ ] 5.4 验证快速多次点击中键不会产生多个菜单窗口
- [ ] 5.5 验证应用退出后钩子被正确卸载，无资源泄露
