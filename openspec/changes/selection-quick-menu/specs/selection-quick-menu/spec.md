## ADDED Requirements

### Requirement: 全局鼠标中键监听
系统 SHALL 创建一个 Windows 低层级鼠标钩子 (WH_MOUSE_LL) 来监听全局鼠标中键点击事件。

#### Scenario: 鼠标中键在其他应用中被点击
- **WHEN** 用户在任何 Windows 应用中点击鼠标中键（滚轮按键）
- **THEN** 系统捕获该事件并触发选中文本获取流程

#### Scenario: 桌宠应用自身窗口聚焦时点击中键
- **WHEN** 桌宠窗口自身获得焦点且用户点击鼠标中键
- **THEN** 系统同样捕获事件，执行后续流程

### Requirement: 获取选中文本
系统 SHALL 在鼠标中键点击后，通过模拟 Ctrl+C 将当前选中文本复制到剪贴板并读取。

#### Scenario: 有其他应用选中文本时点击中键
- **WHEN** 用户在浏览器/编辑器等应用中有文本被选中，且点击鼠标中键
- **THEN** 系统保存当前剪贴板内容，模拟 Ctrl+C，读取剪贴板，然后恢复原剪贴板内容

#### Scenario: 没有选中任何文本时点击中键
- **WHEN** 用户点击鼠标中键但没有任何文本被选中
- **THEN** 系统读取到的剪贴板内容为空，不会弹出菜单

### Requirement: 显示浮动操作菜单
系统 SHALL 在被选中文本的位置（鼠标坐标附近）显示一个浮动操作菜单窗口，包含三个操作项：翻译、打开URL、JSON格式化。

#### Scenario: 成功读取到选中文本并显示菜单
- **WHEN** 系统成功获取到选中文本（非空）
- **THEN** 系统在鼠标光标位置出现一个浮动菜单窗口，显示"翻译"、"打开URL"、"JSON格式化"三个选项

#### Scenario: 点击菜单外部区域
- **WHEN** 浮动菜单处于显示状态，用户点击菜单外的任意位置
- **THEN** 浮动菜单自动关闭

### Requirement: 翻译操作
系统 SHALL 支持将选中文本发送到翻译功能。

#### Scenario: 点击翻译选项
- **WHEN** 用户在浮动菜单中点击"翻译"按钮
- **THEN** 系统打开（或聚焦）translator 窗口，并将选中文本填充到待翻译的文本输入框中

#### Scenario: 翻译窗口已存在时
- **WHEN** translator 窗口已经打开，用户再次触发翻译操作
- **THEN** 系统聚焦已有 translator 窗口，更新待翻译文本内容

### Requirement: 打开URL操作
系统 SHALL 支持将选中文本作为 URL 在默认浏览器中打开。

#### Scenario: 选中内容为有效URL时
- **WHEN** 用户在浮动菜单中点击"打开URL"按钮，且选中文本为一个 URL
- **THEN** 系统调用默认浏览器打开该 URL

#### Scenario: 选中内容不是URL时
- **WHEN** 用户在浮动菜单中点击"打开URL"按钮，且选中文本不是一个有效的 URL
- **THEN** 系统仍然在默认浏览器中尝试打开该内容（浏览器会处理无效URL）

### Requirement: JSON格式化操作
系统 SHALL 支持将选中文本发送到 JSON 格式化窗口。

#### Scenario: 点击JSON格式化选项
- **WHEN** 用户在浮动菜单中点击"JSON格式化"按钮
- **THEN** 系统打开（或聚焦）json-compare 窗口，并将选中文本填充到左侧（源JSON）输入框中

#### Scenario: JSON格式化窗口已存在时
- **WHEN** json-compare 窗口已经打开，用户再次触发JSON格式化操作
- **THEN** 系统聚焦已有 json-compare 窗口，更新左侧输入框内容
