# 后端核心：Adapter trait + Manager + 命令

## Goal

建立会话管理后端基础设施：定义适配器接口、实现内存缓存管理器、注册 Tauri 命令。

## Requirements

- 定义 `AgentSessionAdapter` trait（parse_meta / parse_messages / extract_session_id / resume_command）
- 实现 `ConversationManager`（HashMap 内存缓存 + scan_all + list + get_messages + search + resume_context + export_markdown）
- 注册 7 个 Tauri 命令（scan_conversations / list_conversations / get_conversation_messages / search_conversations / update_conversation / get_resume_command / export_conversation）
- 集成到 `AppStateWrapper` 和 `lib.rs`

## Acceptance Criteria

- [ ] `cargo test` 所有后端单测通过
- [ ] `ScanReport` 正确报告扫描结果
- [ ] `list_conversations(project_path)` 返回按 project_path 过滤的会话列表
- [ ] `get_conversation_messages(id)` 能通过 adapter 解析并返回消息列表
- [ ] `get_resume_command(id)` 对支持原生恢复的 adapter 返回正确命令

## Dependencies

无（纯后端模块，不依赖前端或其他子任务）

## Notes

设计参考：`/Users/tomgs/.claude/plans/purring-churning-sparkle.md`
