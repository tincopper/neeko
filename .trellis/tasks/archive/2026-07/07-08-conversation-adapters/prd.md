# 适配器实现：7个Agent解析器

## Goal

为每个内置 Agent 实现 AgentSessionAdapter，支持解析原生会话文件和构建恢复命令。

## Requirements

### 按优先级实现

| 优先级 | Agent | 格式 | 特点 |
|--------|-------|------|------|
| P0 | Codex CLI | JSONL | 支持原生 `codex resume --last` |
| P0 | CodeBuddy | JSON + SQLite | 支持原生 `--resume <id>` |
| P1 | Claude Code | JSONL 树形 | 最常用 Agent |
| P1 | Pi CLI | JSONL 树形 | 有 session header |
| P2 | Gemini CLI | 纯 JSON | 单文件 JSON |
| P2 | Qoder CLI | JSONL | 按项目分隔 |
| P3 | OpenCode | SQLite | 最复杂 |

### 每个适配器要求

- `parse_meta()` 只读文件头部，快速提取元数据
- `parse_messages()` 完整解析所有消息
- `extract_session_id()` 从文件路径提取原生 ID
- `resume_command()` 返回恢复命令（None = 不回支持原生恢复）
- 带 fixture 文件的单元测试

## Acceptance Criteria

- [ ] 每个适配器 `parse_meta()` 能正确提取标题、时间、消息数、预览
- [ ] 每个适配器 `parse_messages()` 能正确解析所有消息的 role/content/timestamp
- [ ] Codex 适配器 `resume_command()` 返回 `["resume", "<id>"]`
- [ ] CodeBuddy 适配器 `resume_command()` 返回 `["--resume", "<id>"]`
- [ ] Claude Code 适配器 `resume_command()` 返回 `None`（不支持原生恢复）
- [ ] 所有适配器单测通过

## Dependencies

依赖 `07-08-conversation-backend` 的 `AgentSessionAdapter` trait 定义。
