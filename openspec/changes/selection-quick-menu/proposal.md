## Why

桌宠启动后，用户在使用其他应用时，经常需要在不同场景下快速处理选中的文本内容（翻译、打开链接、格式化 JSON 等）。目前需要手动打开桌宠功能窗口再粘贴，操作路径长。本功能让用户在任何应用中选中文本后，点击鼠标中键即可唤出快捷操作菜单，一键完成翻译/打开URL/JSON格式化，大幅提升效率。

## What Changes

- 新增 Rust 全局鼠标钩子，监听 Windows 全局鼠标中键点击事件
- 选中文本检测：鼠标中键点击时模拟 Ctrl+C 读取选中内容到剪贴板（完成后恢复原剪贴板）
- 新增浮动菜单窗口（SelectionMenu 组件）：鼠标中键点击后在鼠标位置弹出，包含三个操作项
- 新增 Tauri 事件通道 `selection://popup`，用于后端向前端传递选中文本和鼠标位置
- 三个快捷操作：
  - **翻译**：打开/聚焦 Translater 窗口，将选中文本填充到待翻译区域
  - **打开URL**：调用 `opener` 插件在默认浏览器中打开选中内容
  - **JSON格式化**：打开/聚焦 JsonCompare 窗口，将选中文本填充到左侧 JSON 输入框
- 新增三个 Rust Command：用于接收选中文本并执行对应操作

## Capabilities

### New Capabilities
- `selection-quick-menu`: 全局鼠标中键唤起快捷操作菜单，支持翻译、打开URL、JSON格式化

### Modified Capabilities

无现有 spec 需要修改。

## Impact

- **后端**: `src-tauri/Cargo.toml` — 添加 Windows API feature（`Win32_UI_Input_KeyboardAndMouse` 用于 `SendInput`）
- **后端**: `src-tauri/src/lib.rs` — 新增全局钩子初始化、事件发送、三个新 Command
- **后端**: `src-tauri/src/global_mouse.rs` — (新文件) 鼠标钩子核心逻辑
- **前端**: `src/components/SelectionMenu.tsx` — (新文件) 浮动操作菜单组件
- **前端**: `src/components/SelectionMenu.css` — (新文件) 菜单样式
- **前端**: `src/App.tsx` — 添加 `selection-menu` 窗口路由
- **前端**: 现有组件 `TranslatorComponent` / `JsonCompareComponent` — 需要支持接收外部传入的填充文本
- **配置**: `src-tauri/capabilities/main.json` — 可能需要补充窗口管理相关权限
- **依赖**: 无新增 NPM/Rust 外部依赖，全部使用已有的 `windows` crate
