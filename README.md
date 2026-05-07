# XSUN DESKTOP PET (桌宠)
作品仅供使用学习RUST 与 tauri2,不用于商业用途
当前版本：
<p align="center">
 <img src="https://img.shields.io/badge/RUST-1.87.0-green" alt="Coverage Status">
 <img src="https://img.shields.io/badge/cargo-1.87.0-yellow" alt="Downloads">
 <img src="https://img.shields.io/badge/tauri-2.8.0-pink" alt="Downloads">
 <img src="https://img.shields.io/badge/npm-11.5.2-blue" alt="Downloads">
 <img src="https://img.shields.io/badge/node-22.18.0-da282a" alt="Downloads">
</p>

## 项目概述

XSUN Desktop Pet（桌宠）是一个基于 Rust 和 Tauri 2 开发的桌面应用程序，旨在提供多种实用工具和娱乐功能。

### 技术栈

- 前端：React + TypeScript
- 后端：Rust (Tauri 2)


### 版本信息

- RUST: 1.87.0
- cargo: 1.87.0
- tauri: 2.8.0
- npm: 11.5.2
- node: 22.18.0

## 功能模块介绍

### 1. 桌宠主界面 (PetComponent)

桌宠主界面是应用程序的核心部分，以一个可拖动的动画形象展示在桌面上。

主要特性：
- 可拖动的桌宠形象
- 点击桌宠可打开功能菜单
- 托盘图标支持（右键菜单）

### 2. 功能菜单 (MenuPanel)
**双击tab可以唤醒**

点击桌宠会弹出一个九宫格菜单，提供对各种功能的快速访问：

1. 剪贴板
2. 系统信息
3. AI 对话
4. 有道翻译
5. 日历 TODO
6. JSON 对比
7. JIRA 工作流助手
8. 地图绘制
9. 记事本(Obsidian)
10. 文件搜索
11. 番茄钟
12. 关闭桌宠
13. 最小化到托盘

### 3. 剪贴板管理器 (ClipboardComponent)

剪贴板管理器记录用户的复制内容，支持查看和管理剪贴板。

主要特性：
- 自动监控剪贴板变更并记录
- 分页加载历史记录
- 支持文本和图片格式
- 可以展开查看/编辑长内容
- 一键复制回剪贴板
- 清空剪贴板功能
- 复制JSON自动展开格式化

### 4. 系统信息监控 (SystemInfoComponent)

实时显示系统资源使用情况。

主要特性：
- CPU 使用率监控
- 内存使用情况显示
- 实时更新系统状态

### 5. AI 对话助手 (AIChatComponent)

集成 AI 对话功能，目前支持 DeepSeek API。

主要特性：
- 与 AI 进行自然语言对话
- 支持自定义 API 密钥和基础 URL
- 本地配置保存
- 流式响应显示

### 6. 有道翻译 (TranslatorComponent)

集成了有道翻译服务，支持多语言互译。

主要特性：
- 文本翻译功能
- 多语言单次同时翻译
- 国际化代码支持（国际化‘=’后半部分翻译，前面保留）
- 自定义 API 密钥
- 本地配置保存

### 7. 智能日历 (CalendarComponent)

带有待办事项功能的日历应用。

主要特性：
- 日历视图展示
- 每日待办事项管理
- 每日已办事项处理
- 自定义背景图片轮播
- 数据持久化存储

### 8. JSON 对比工具 (JsonCompareComponent)

用于比较两个 JSON 数据的差异。

主要特性：
- 语法高亮显示
- 差异对比标记
- 支持复杂 JSON 结构
- 待对比项对比内容格式化（key顺序自动调整一致）
- 友好的可视化界面

### 9. JIRA 工作流助手 (JiraComponent)

集成 JIRA 与 Git，辅助日常工时记录与工作日志管理。

主要特性：
- 左右分栏布局：左侧日期选择器（前后各15天），右侧内容区
- 连接 JIRA 查看未完成任务、按日期拉取已填写工单
- 连接 Git 仓库拉取当日提交记录
- AI 智能生成工时建议（基于选定 Issue 与 Git 提交）
- 多日工单汇总（选中多个日期，聚合查看工作日志）
- 底部 Tab 导航：仪表板 / 历史总结 / 配置 / 手动填写
- Jira / Git / AI 三合一配置面板，配置持久化到 SQLite

### 10. 地图绘制 (MapDrawingComponent)

基于 Canvas 的地图标注与绘制工具。

主要特性：
- 支持绘制点、线、多边形等图形
- 图层管理与数据导入导出
- 拖拽缩放交互

### 11. 记事本 (NotepadComponent)

类 Obsidian 的本地 Markdown 笔记管理。

主要特性：
- Markdown 编辑与实时预览
- 文件树目录管理
- 数据持久化存储

### 12. 文件搜索 (QuickFileSearch / FileSearchComponent)
**双击control可以唤醒**

基于 FTS5 全文索引的快速文件搜索。

主要特性：
- 全盘文件索引与快速检索
- 支持文件名和内容搜索
- 结果实时过滤

### 13. 番茄钟 (PomodoroTimerComponent)

番茄工作法计时器，支持工作/休息周期切换与通知提醒。

## 项目架构

### 前端架构

前端采用 React + TypeScript 技术栈，每个功能模块对应一个独立的组件：

### 14：快进方式
1. control+tab唤醒菜单
2. control+space 唤醒搜索
3. 双击·（tab上面那个键）唤醒记事本
4. 选择目标，点击鼠标滚轮，唤醒小窗（翻译/json序列化/唤醒默认游览器打开URL）

```
src/
├── components/           # 各功能组件
│   ├── PetComponent.tsx      # 桌宠主界面
│   ├── MenuPanel.tsx         # 功能菜单
│   ├── ClipboardComponent.tsx # 剪贴板管理
│   ├── SystemInfoComponent.tsx # 系统信息
│   ├── AIChatComponent.tsx   # AI 对话
│   ├── TranslatorComponent.tsx # 翻译器
│   ├── CalendarComponent.tsx # 日历
│   ├── JiraComponent.tsx    # JIRA 工作流助手
│   ├── MapDrawingComponent.tsx # 地图绘制
│   ├── NotepadComponent.tsx   # 记事本
│   ├── QuickFileSearch.tsx    # 文件快速搜索
│   ├── FileSearchComponent.tsx # 文件搜索详情
│   ├── PomodoroTimerComponent.tsx # 番茄钟
│   ├── PomodoroNotification.tsx # 番茄钟通知
│   ├── SelectionMenu.tsx      # 选中文本快捷菜单
│   ├── TodoWindow.tsx         # 待办事项窗口
│   └── ExpandWindow.tsx       # 内容展开窗口
├── utils/               # 工具函数
│   └── lunarUtils.ts         # 农历工具
└── App.tsx              # 应用入口
```

### 后端架构

后端使用 Rust 编写，通过 Tauri 提供系统级功能和业务逻辑：

```
src-tauri/
├── src/
│   ├── lib.rs          # 主要业务逻辑
│   ├── main.rs         # 应用入口
│   ├── clipboard.rs     # 剪贴板相关功能
│   ├── calendar.rs      # 日历相关功能
│   ├── json_compare.rs
│   ├── jira_tools.rs     # JIRA 集成与Git操作
│   ├── task_scheduler.rs  # 定时任务调度
│   ├── file_index.rs      # 文件索引
│   ├── file_search.rs     # 文件搜索
│   ├── global_mouse.rs    # 全局鼠标钩子
│   └── global_keyboard.rs # 全局键盘钩子
├── config/             # 配置文件
│   └── deepseek.json   # AI 配置示例
└── capabilities/       # 权限配置
```

### 数据流

1. 用户与前端组件交互
2. 前端通过 Tauri 的 [invoke]( xsun_desktop_pet/src-tauri/src/lib.rs#L365-L365) 调用后端命令
3. 后端处理业务逻辑并返回结果
4. 前端接收结果并更新 UI

### 配置文件

- [bubbles.json]( xsun_desktop_pet/public/config/bubbles.json) - 功能菜单配置
- [deepseek.json]( xsun_desktop_pet/src-tauri/config/deepseek.json) - AI 配置示例

## 核心功能详解

### 桌宠交互机制

桌宠具有两种状态：活跃状态和休眠状态。

- **活跃状态**：可以进行拖动和点击操作
- **休眠状态**：启用点击穿透，不影响用户其他操作，仅显示动画
- **自动切换**：鼠标离开桌宠 3 秒后自动进入休眠状态
- **手动唤醒**：双击休眠状态的桌宠或者点击功能菜单可唤醒

### 窗口管理系统

应用采用多窗口架构，主桌宠窗口始终存在，各功能模块在独立窗口中打开：

1. 主窗口（桌宠）- 始终运行
2. 功能窗口 - 按需创建和销毁
3. 菜单窗口 - 点击桌宠时临时创建

窗口管理策略：
- 若目标窗口已存在，则直接显示并聚焦
- 若目标窗口不存在，则创建新窗口
- 窗口关闭时完全销毁实例

### 数据持久化

应用使用 SQLite 数据库（通过 Tauri 资源目录管理）实现数据持久化：

1. 剪贴板历史 - SQLite 持久化
2. AI 配置 - SQLite 持久化（ai_config 键，AI对话与Jira助手共享）
3. JIRA 配置 - SQLite 持久化
4. Git 配置 - SQLite 持久化
5. 翻译配置 - SQLite 持久化
6. 日历待办事项 - SQLite 持久化
7. 日历设置 - SQLite 持久化
8. AI 对话历史 - SQLite 持久化（支持多会话）
9. 地图绘制数据 - SQLite 持久化
10. 番茄钟设置 - SQLite 持久化

### 托盘功能

应用在系统托盘中提供快捷访问：

- 左键点击：显示/隐藏桌宠
- 右键点击：打开托盘菜单
  - 显示桌宠
  - 剪贴板
  - 系统信息
  - AI 对话
  - 有道翻译
  - 日历 TODO
  - 文件搜索
  - 退出

## 开发说明

### 项目结构

```
.
├── public/              # 静态资源
│   └── config/
│       └── bubbles.json  # 菜单配置
├── src/                 # 前端源码
│   ├── components/      # 组件
│   └── utils/           # 工具函数
├── src-tauri/           # Rust 后端源码
│   ├── config/          # 配置文件
│   ├── src/             # Rust 源码
│   └── capabilities/    # 权限配置
└── index.html           # 主页面模板
```

### 构建和运行

开发环境运行：
```bash
npm run tauri dev
```

构建生产版本：
```bash
cargo tauri build
```

### 添加新功能

1. 在 [bubbles.json]( xsun_desktop_pet/public/config/bubbles.json) 中添加菜单项
2. 创建对应的前端组件
3. 如需后端支持，在 [lib.rs]( xsun_desktop_pet/src-tauri/src/lib.rs) 中添加相应的命令函数
4. 在 [MenuPanel.tsx]( xsun_desktop_pet/src/components/MenuPanel.tsx) 中添加窗口创建逻辑
5. 在 [PetComponent.tsx]( xsun_desktop_pet/src/components/PetComponent.tsx) 中添加托盘菜单事件处理

## 总结

XSUN Desktop Pet 是一个功能丰富的桌面应用程序，集成了多种实用工具。其模块化的设计使得添加新功能变得简单，而 Tauri 的跨平台特性保证了良好的兼容性。该应用展示了如何利用现代 Web 技术和系统编程语言构建高效的桌面应用。


