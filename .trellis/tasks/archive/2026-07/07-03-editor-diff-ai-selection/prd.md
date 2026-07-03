# 代码编辑器和 Diff 支持选择代码与 AI 交互

## Goal

在代码编辑器（CodeMirror）和 Git Diff 视图中选中代码后，通过浮动操作条将代码上下文发送到已打开的 Agent 终端，实现 "选中 → Ask/Explain/Review/Fix" 的 AI 交互流程。

## Requirements

### 编辑器侧 (FileViewer / CodeMirror)

1. 当用户在 CodeMirror 中选中文本时，选区上方显示浮动操作条
2. 浮动操作条包含四个按钮：**Ask** / **Explain** / **Review** / **Fix**
3. **Ask** 按钮点击后弹出 inline 输入框让用户输入自定义问题
4. **Explain** / **Review** / **Fix** 点击后直接发送预设的问题文本
5. 语言为英文

### Diff 侧 (DiffView / DiffTable / SplitDiffTable)

1. Diff 行号可点击 toggle 选中行，选中行高亮
2. 点击 hunk header (@@) 选中整个 hunk
3. 选中区域上方浮动 "Ask AI about N lines" 按钮
4. Diff header 常驻 "Review this change" 按钮（发送全量 diff）
5. 选中 diff 行的 "Ask" 同样弹出输入框

### Agent 终端约束

1. 执行 AI 操作前检查当前项目是否有 `agentId` 不为空的终端 tab
2. 有 → 直接向该终端发送文本（复用 `sendToTerminal`）
3. 无 → 弹出 Toast："Please open an agent terminal first" + "Open {agentName} Terminal" 按钮
4. 点击按钮后创建新终端 tab（复用 `addTab`），agent 自动启动后发送原问题
5. 不引入新的 loader/error/loading 状态
6. `try-catch` 中不需要做 UI 反馈，失败直接忽略

### 消息格式

- 文本通过 `sendToTerminal(<projectId>, "message\r")` 发送
- 消息示例：`"explain the code at src/foo.rs:42-67\r"`
- 代码内容不传递（agent 自行读盘），只传文件路径 + 行号
- 简单的预设提示，不过度尝试优化

## Acceptance Criteria

- [ ] 编辑器选中代码后浮动操作条可见，选区消失时自动隐藏
- [ ] Explain/Review/Fix 直接发送预设问题到 agent 终端
- [ ] Ask 弹出 inline 输入框，用户输入后 + 文件路径一起发送
- [ ] Diff 行号可点击 toggle 选中，选中区域浮动按钮显示
- [ ] Diff header "Review this change" 按钮发送全量 diff
- [ ] 无 agent 终端时弹出 Toast + "Open Terminal" 按钮
- [ ] 点击 Toast 按钮后创建终端并自动发送
- [ ] 所有文本通过 `sendToTerminal` 发送，不走 Rust `-p` 管道
- [ ] 不引入新状态管理、无 loading/error UI 反馈
