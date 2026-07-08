# 智能体历史会话管理 — PRD

## 概述

为 Neeko 添加 Agent 会话历史管理功能。Neeko 不再是被动的终端"录音机"，而是 Agent 原生会话数据的聚合浏览器。

## 核心需求

### N1：自动发现 Agent 会话
- 进入项目时，自动扫描所有已安装 Agent 的会话目录
- 支持 7 个内置 Agent：Claude Code、OpenCode、Gemini CLI、Codex CLI、Qoder CLI、CodeBuddy、Pi CLI
- 从每个 Agent 的原生会话文件中提取元数据（标题、时间、消息数、预览）
- 元数据仅保留在内存中，不持久化到磁盘

### N2：会话列表展示
- 在右侧 DockBar 新增 "History" 面板按钮
- 当前项目所有 Agent 的会话混排展示，按时间倒序
- 每条显示：Agent icon + 名称、标题、时间、消息数、内容预览
- 无项目时显示占位提示

### N3：会话查看
- 点击 View 以编辑器 Tab 形式打开会话查看器
- 按消息时间顺序渲染 User / Assistant 消息
- 支持滚动加载（初始 100 条，下拉加载更多）

### N4：会话恢复
- Resume 操作：优先使用 Agent 原生恢复机制
- Codex CLI / CodeBuddy：通过 CLI flag 原生恢复
- 其他 Agent：通过上下文注入（读取历史消息构建 prompt）
- 恢复前检查 Agent 是否已安装

### N5：会话导出
- 支持导出为 Markdown 格式

## 验收标准

1. 打开一个包含多个 Agent 使用的项目，History 面板正确列出所有会话
2. 列表按时间倒序排列，每条显示正确的 Agent icon 和名称
3. 点击 View 打开会话查看器 Tab，消息顺序和时间正确
4. [Codex] 点击 Resume 在终端中执行 `codex resume <id>`，Agent 正确恢复
5. [Claude Code] 点击 Resume 在终端中注入上下文 prompt
6. 导出 Markdown 文件内容完整、格式正确
7. 无项目时面板显示 "No project selected"

## 子任务

| 子任务 | 目录 | 说明 |
|--------|------|------|
| 后端核心 | `07-08-conversation-backend` | Adapter trait + Manager + Tauri 命令 |
| 适配器实现 | `07-08-conversation-adapters` | 7 个 Agent 解析器 |
| 前端 UI | `07-08-conversation-frontend` | Panel + List + Viewer + Resume |
| 集成验证 | `07-08-conversation-integration` | 端到端测试 |

## 不在范围

- 对话内容编辑（只读查看）
- Agent 原生文件的写入/修改
- 实时文件监听（手动刷新即可）
- 云端会话同步
- 跨设备会话迁移
