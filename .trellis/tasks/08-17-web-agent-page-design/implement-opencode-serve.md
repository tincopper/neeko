# opencode 模型切换迁移 — ServeAdapter（opencode serve + HTTP + SSE）

> 挂靠任务：08-17-web-agent-page-design（用户确认迁移，优先高内聚/低耦合/可扩展）。
> 设计文档：`.trellis/tasks/08-17-web-agent-page-design/design/opencode-serve-migration.md`
> P0-P3（Conversation 查看器）已全部完成并回归通过，本轮为其后续扩展。

## 背景

Neeko 通过 `opencode acp`（ACP，JSON-RPC stdio）通信，模型固定为
`~/.config/opencode/opencode.json` 的 `coding-plan/kimi-k2.7-code`，无法切换。
上游 ACP 不支持 per-session 模型（anomalyco/opencode#31750）；`opencode serve` REST API 支持。

## 验收标准

- [x] M1 模型传递链路贯通：`StreamChatRequest.model` → `StreamRequest.model` → `AgentContext.model`
- [x] M2 新增 `ServeAdapter`（`adapter/serve.rs`）：启动 `opencode serve` + `POST /session`(带 model) + `prompt_async` + SSE → `TextDelta`/`ReasoningDelta`/`Tool*`
- [x] M2 `adapter_for` 新增 `serve` transport 分支；opencode `chat_transport` 切 `"serve"`（`agent/manager.rs`）
- [x] M3 `AgentContext.model` → 会话创建生效；未选模型回落 config 默认
- [x] M3 `permission.asked` → `RequestApproval`；approve 回复走 serve
- [x] M3 续写会话复用既有 serve session（`resume_id` = serve session UUID）
- [x] `AcpAdapter` 能力保留：mockAgent、其他 `chat_transport:"acp"` agent 路径不变
- [x] 全程 TDD：先写失败测试 → 最小实现 → 重构；`cargo test` / `pnpm test:run` / `pnpm lint` 回归（2026-08-21 复测全绿：cargo test 825+99 / test:run 2108 / lint；trellis-check 审查通过，含续写轮次丢 model 缺陷修复）

## 实施顺序

1. M1 模型字段贯通（前端 API + 后端 `StreamRequest`/`AgentContext` + 测试）
2. M2 ServeAdapter 核心（serve 启动 + 建会话 + prompt_async + SSE 事件转换纯函数 + 单测）
3. M3 模型生效 + 审批 + resume（连接真实 serve 的集成测试标 `#[ignore]`）

## 关键约束

- 执行 `opencode serve` 必须走 `crate::core::exec::spawn`（AGENTS.md 红线 1）
- HTTP 用 `reqwest`（Cargo.toml 已内置 blocking/json/stream）；SSE 读取独立 task
- 事件转换用 `match`，if-let 嵌套 ≤ 3；`mod.rs` 保持极薄
- 不删除 `AcpAdapter`；不修改 bridge/commands 核心逻辑（除加字段）
- Event 名常量化（`AGENT_CHAT_EVENT` 复用）