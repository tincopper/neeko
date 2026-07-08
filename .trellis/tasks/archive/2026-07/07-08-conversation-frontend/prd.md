# 前端UI：Panel + List + Viewer + Resume

## Goal

实现会话历史管理的前端 UI：右侧 Dock 面板展示列表、编辑器 Tab 查看详情、Resume 操作。

## Requirements

### 面板注册
- 右侧 DockBar 新增 "History" 按钮（`MessageSquareText` 图标）
- `ConversationPanelWrapper` 读取 activeProject 和 isActive 注入 props
- 无项目时显示 "No project selected"

### 列表展示
- 所有 Agent 会话混排，按 `started_at` 倒序
- 每条显示：Agent icon + 名称、标题、时间、消息数、预览
- 每条操作：▶ Resume、📋 View
- 顶部刷新按钮手动触发 `scan_conversations()`
- 切换项目时自动扫描 + 刷新列表

### 会话查看
- View 以编辑器 Tab 形式打开（`kind: "conversation"`）
- 消息按时间顺序渲染，区分 User / Assistant 角色
- 初始加载 100 条，滚动加载更多
- 工具栏：返回、标题、Resume、Export

### 会话恢复
- 检查 Agent 是否安装
- 有原生 resume → 构造 CLI 命令发送到终端
- 无原生 resume → 构建上下文注入 prompt 发送到终端

## Acceptance Criteria

- [ ] `pnpm test` 所有前端单测通过
- [ ] 右侧 DockBar 出现 History 按钮，点击展开面板
- [ ] 进入项目后自动加载会话列表，按时间倒序
- [ ] 每条显示正确的 Agent icon + 名称
- [ ] 点击 View 打开编辑器 Tab，消息正确渲染
- [ ] 点击 Resume 在终端中执行正确的恢复命令
- [ ] 无项目时面板显示占位提示
- [ ] 空列表时显示提示文案

## Dependencies

依赖 `07-08-conversation-backend` 的 Tauri 命令和 `07-08-conversation-adapters` 的解析能力。
