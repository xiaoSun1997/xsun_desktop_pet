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

点击桌宠会弹出一个九宫格菜单，提供对各种功能的快速访问：

1. 剪贴板历史
2. 系统信息
3. AI 对话
4. 有道翻译
5. 日历 TODO
6. JSON 对比
7. 关闭桌宠
8. 最小化到托盘

### 3. 剪贴板管理器 (ClipboardComponent)

剪贴板管理器记录用户的复制历史，支持查看和管理剪贴板内容。

主要特性：
- 自动记录剪贴板最近5条内容
- 支持文本和富文本格式
- 可以展开查看长内容
- 支持手动检查剪贴板
- 清空剪贴板历史功能
- 复制json,展开格式化

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

## 项目架构

### 前端架构

前端采用 React + TypeScript 技术栈，每个功能模块对应一个独立的组件：

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
│   ├── TodoWindow.tsx        # 待办事项窗口
│   ├── JsonCompareComponent.tsx # JSON 对比
│   └── ExpandWindow.tsx      # 内容展开窗口
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
│   └── window_utils.rs  # 窗口工具函数
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

应用使用以下方式实现数据持久化：

1. 剪贴板历史 - 存储在内存中，应用重启后丢失
2. AI 配置 - 保存在用户应用数据目录的 [deepseek_config.json]( xsun_desktop_pet/src-tauri/src/lib.rs#L252-L252)
3. 翻译配置 - 保存在用户应用数据目录的 youdao_config.json
4. 日历待办事项 - 保存在用户应用数据目录的 todos.json
5. 日历设置 - 保存在用户应用数据目录的 calendar_settings.json

### 托盘功能

应用在系统托盘中提供快捷访问：

- 左键点击：显示/隐藏桌宠
- 右键点击：打开功能菜单
    - 显示桌宠
    - 剪贴板
    - 系统信息
    - AI 对话
    - 有道翻译
    - 日历 TODO
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

## 效果预览
![image](https://gitee.com/sunlinglei/xsun_desktop_pet/blob/dev/public/pet/rich_cat.gif)

