# 集成验证与端到端测试

## Goal

端到端验证会话历史管理功能的完整流程，确保前后端集成正确。

## Requirements

- `pnpm tauri dev` 启动后功能可用
- 无项目 / 空列表 / 有数据 三种状态验证
- 多 Agent 混排显示验证
- Resume 两种路径验证（原生 / 注入）
- 导出 Markdown 验证

## Acceptance Criteria

- [ ] 无项目时面板显示 "No project selected"
- [ ] 进入有 Agent 使用历史项目的项目，面板列出所有会话
- [ ] 列表按时间倒序，Agent 归属正确
- [ ] View 打开查看器，消息内容完整
- [ ] Codex Resume 在终端正确执行 `codex resume`
- [ ] Claude Code Resume 在终端正确注入上下文 prompt
- [ ] 导出 Markdown 文件内容正确
- [ ] 无 crash、无 console error
