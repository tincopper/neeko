# Agent Chat（Agent 对话）页面设计与 Tab 集成（设计 v2/v3 + 原型）

## Goal

新增 **Agent Chat 页面**，并**以 Tab 形式集成进 Neeko**（`TabKind 'agent-chat'`），其余功能（终端 TUI、浏览器、文件、会话）照常不受影响——TUI 与 Agent Chat 是并存的两种使用 agent 的方式。后端提供**多 Agent 适配层**（opencode / claude-code / gemini / codex / qoder / codebuddy / custom + **DeepSeek Harness 首个参考接入示范**），统一 `StreamEvent` 事件协议（含 v3 增量：**双向审批通道 / 话轮模型 / 上下文协议化**），打通项目切换 / 文件浏览 / Skills。

当前进度（2026-08-21 同步）：设计阶段产物（架构文档 v2 + 第一性原理审查 v3 + Tab 集成 mockup 原型）已完成；代码实现已落地 M0-M3 —— `src/features/agent-chat/` feature（视图/store/hooks/api）与后端 `src-tauri/src/agent/chat/`（acp / deepseek / serve 三 adapter，统一 StreamEvent + 双向审批通道 + 上下文协议化）均已实现并通过 trellis-check 审查与全量质量门禁。后续扩展（Conversation 查看器 P0-P3、opencode serve 迁移）见任务内两份 implement 计划，均已完成。

## Requirements

- R1 以 Tab 集成：新增 `TabKind 'agent-chat'`，接入 `src/shared/types/tab.ts` / `PaneContent.tsx` / `TabItemLeading` / `registerTabCleanup` / 打开入口。
- R2 与 TUI 并存：Agent Chat 适配层用独立会话，不抢占 PTY；Dock 终端 TUI 照常可用。
- R3 后端统一事件协议：`StreamEvent`（text.delta / tool.start|output|end / command.run / file.diff / session.done / error），所有 agent 输出统一形态；**[v3] 双向通道**：`RequestApproval` / `UserInput` + `agent_approve` / `agent_input`（逐条确认/澄清可闭环）。
- R4 多 Agent 适配层：统一 `AgentAdapter` trait，新增 agent 只写 adapter、零改页面；复用 `AgentManager` + `crate::core::exec` 统一执行门面；**[v3] 以 DeepSeek Harness 作为首个参考接入示范**（Spawn + stdio JSON-Lines + Gate 闭环），验证契约完备性。
- R5 打通现有功能：项目切换、文件浏览附加、Skills 启停端到端生效（对现有域只读调用 + 状态注入）；**[v3] 上下文协议化**为 `ContextInit` / `agent_context_set`。
- R6 双形态：首期桌面形态 A（原生 React Tab + Tauri IPC）；页面保持纯事件驱动，预留形态 B（独立 Web，HTTP+SSE）低成本迁移。

## Acceptance Criteria

- [x] 设计文档（任务内）完整：Tab 集成模型 + 适配层 + 打通方案 + 里程碑。
- [x] 第一性原理审查（v3）：契约补全（双向通道/话轮/上下文协议化）+ DeepSeek Harness 首个参考接入示范。
- [x] 原型（任务内）：展示 Agent Chat Tab 与 TUI 并存，jsdom 自检通过、无 JS 错误。
- [x] （M1）编辑器可开/关 Agent Chat Tab，与终端 Tab 并存；`pnpm type-check` 通过。
- [x] （M2）opencode / claude-code adapter 输出统一事件；**DeepSeek Harness 参考适配器闭环（审批/澄清/diff 示范场景）**；`cargo test` 覆盖事件映射。
- [x] （M3）React 视图 + store + 项目/文件/skills 打通 + 审批面板；组件测试通过。
- [x] 全程遵循 AGENTS.md 红线（统一执行门面、跨平台 shell、路径校验、事件名常量化、mod.rs 极薄）。

## Notes

- 设计产物（任务目录内统一管理）：
  - 架构文档：`.trellis/tasks/08-17-web-agent-page-design/design/web-agent-architecture.md`
  - 第一性原理审查（v3）：`.trellis/tasks/08-17-web-agent-page-design/design/first-principles-review.md`
  - Tab 集成原型：`.trellis/tasks/08-17-web-agent-page-design/prototypes/web-agent-tab.html`（另有 `agent-chat-v2.html`、`agent-input-box.html`）
- 里程碑 M0-M5 见架构文档第 8 节；每个里程碑遵循 Red-Green-Refactor。
