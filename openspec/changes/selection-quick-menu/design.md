## Context

- 项目为 Tauri v2 桌面应用，使用 Rust 后端 + React 前端
- 桌宠窗口已实现点击穿透、拖拽、菜单面板等功能
- 已集成翻译(有道)、JSON格式化、剪贴板管理、系统监控、番茄钟、JIRA 等功能模块
- 每个功能模块独立为一个窗口，通过 `App.tsx` 路由根据 window label 加载对应组件
- 当前缺少全局快捷操作入口，用户需要先打开功能窗口再进行操作
- 后端已依赖 `windows = "0.58"` crate 且包含 `Win32_UI_WindowsAndMessaging` feature

## Goals / Non-Goals

**Goals:**
- 实现 Windows 全局鼠标中键监听，任何应用下均可触发
- 读取选中文本后弹出浮动操作菜单
- 三个快捷操作：翻译、打开URL、JSON格式化
- 操作完成后恢复用户原始剪贴板内容

**Non-Goals:**
- 不修改现有功能窗口的核心逻辑（只增加外部输入接口）
- 不新增外部 NPM/Rust 依赖
- 不支持 macOS/Linux 平台（仅 Windows）
- 不处理图片/文件选择的场景

## Decisions

### 决策 1：使用 Windows API (WH_MOUSE_LL) 而非 rdev
- **选择**：Windows 低层级鼠标钩子 `SetWindowsHookEx(WH_MOUSE_LL)`
- **理由**：项目已依赖 `windows = "0.58"` crate，包含 `Win32_UI_WindowsAndMessaging`，仅需添加 `Win32_UI_Input_KeyboardAndMouse` feature 即可获得 `SendInput` 功能。无需引入第三方依赖，且 Windows API 更稳定可靠
- **备选**：`rdev` crate — 跨平台但需要额外依赖，不如直接使用 Windows API

### 决策 2：钩子线程通过 Tauri AppHandle 发射事件
- **选择**：全局钩子跑在独立线程中，持有 `AppHandle` 的引用，通过 `app_handle.emit("selection://popup", payload)` 发送事件到前端
- **理由**：前端已有类似的 `listen` 模式（如 `tray://open-clipboard`），完全复用现有架构
- **备选**：Rust 端直接调用 `tauri::command` — 但命令需要主线程上下文，钩子回调用事件模式更合适

### 决策 3：浮动菜单使用独立透明的 Tauri 小窗口
- **选择**：创建一个 140×160 像素的透明无边框窗口（label: `selection-menu`），定位到鼠标坐标附近
- **理由**：与现有菜单面板 (MenuPanel) 模式一致；React 组件可获得完整的事件处理和样式控制能力
- **备选**：原生 popup 菜单 — 定制性差，无法实现好看的 UI

### 决策 4：通过 `window.__SELECTION_TEXT__` 注入填充文本
- **选择**：打开目标窗口时，通过 `initialization_script` 注入 `window.__SELECTION_TEXT__` 变量，窗口组件在 `useEffect` 中读取并填充
- **理由**：与现有的 `open_expand_window` 函数模式一致；也适用于窗口已存在时通过事件 (`translator://fill-text`) 更新内容
- **备选**：Tauri event 传递数据 — 同样可行，但初始化脚本方式更直接，适合新窗口创建的场景

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| 模拟 Ctrl+C 可能被安全软件拦截 | 使用 Windows API `SendInput` 模拟键盘事件，与真实键盘输入等效，极少被拦截 |
| 钩子线程 panic 导致应用崩溃 | 使用 `std::panic::catch_unwind` 包裹钩子回调；钩子函数内使用 `match` 安全处理所有 Result |
| 多个应用中键冲突（如IDE中键已有功能） | 暂不处理，用户选择特定场景触发；后续可添加白名单/黑名单配置 |
| 钩子未正确卸载导致资源泄露 | 在 `Drop` 实现中调用 `UnhookWindowsHookEx`；应用退出时自动清理 |
| 快速多次点击中键导致多个菜单 | 菜单窗口添加单例限制，点击中键时检查 `selection-menu` 窗口是否已存在，先关闭旧菜单再打开新菜单 |
| 剪贴板恢复时序问题 | 读取完文本后延迟 50ms 再恢复，确保原内容已完全被系统处理 |
