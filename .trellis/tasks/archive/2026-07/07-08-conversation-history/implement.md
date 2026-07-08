# 智能体历史会话管理 — Implementation Plan

## 执行顺序

1. **07-08-conversation-backend** — Adapter trait + Manager + 7 个 Tauri 命令
2. **07-08-conversation-adapters** — 7 个 Agent 解析器实现
3. **07-08-conversation-frontend** — Panel + List + Viewer + Resume
4. **07-08-conversation-integration** — 端到端验证

## Phase 1：后端核心

- [ ] `conversation/adapter.rs` — AgentSessionAdapter trait
- [ ] `conversation/types.rs` — Rust 数据结构
- [ ] `conversation/manager.rs` — HashMap 缓存 + scan_all/list/get_messages
- [ ] `conversation/commands.rs` — 7 个 Tauri 命令
- [ ] `app_state.rs` / `lib.rs` — 注册模块和命令
- [ ] Rust 单元测试

## Phase 2：适配器

- [ ] `codex.rs` — JSONL, parse_meta + parse_messages + resume_command
- [ ] `codebuddy.rs` — JSON + SQLite
- [ ] `claude_code.rs` — JSONL 树形
- [ ] `pi.rs` — JSONL 树形 + session header
- [ ] `gemini.rs` — 纯 JSON
- [ ] `qoder.rs` — JSONL
- [ ] `opencode.rs` — SQLite
- [ ] 每个适配器 fixture 测试

## Phase 3：前端

- [ ] Types + API + Hooks
- [ ] ConversationPanel + List + Item
- [ ] ConversationViewer + Message（编辑器 Tab）
- [ ] DockPanel + Wrapper 注册
- [ ] Resume 流程
- [ ] 组件单元测试

## Phase 4：集成

- [ ] `pnpm tauri dev` 端到端
- [ ] 多场景测试
- [ ] 导出验证
