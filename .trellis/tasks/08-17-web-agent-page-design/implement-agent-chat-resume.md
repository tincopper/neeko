# Agent Chat 会话恢复 — 方案 C+（复用 conversation 数据源，多 Agent 可扩展）

> 挂靠任务：08-17-web-agent-page-design（用户指定在当前任务内继续）。
> 用户决策（2026-08-21）：① 方案 C 认可，但必须多 Agent 可扩展（claude-code/codex/deepseek-harness 等，
> 高内聚低耦合）；② 恢复交互 = Chat Tab 内列表选择 + Histor 面板「Agent Chat 恢复」入口双通道。

## 能力矩阵（实测）

| Agent | 本地存储 | 原生 resume | Chat 接续 | 批次 |
|---|---|---|---|---|
| opencode(serve) | SQLite `~/.local/share/opencode/*.db` | `--session <id>`；native_id=serve_sid | ✅ trait 就绪 + 首个实现 | M1 |
| claude-code | JSONL `~/.claude/projects/` | `--resume <id>` | 覆写 resume()：spawn headless stream-json 解析 | 二期 |
| codex / codebuddy | 自有存储 | `resume <id>` / `--resume <id>` | 二期评估 | 二期 |
| gemini / qoder | — | 无原生恢复 | 永久只读（supports_chat_resume=false） | — |
| deepseek-harness | Neeko spawn+stdio，无内建存储 | — | 需 Neeko 侧事件日志（方案 B 局部化），trait 不变 | 三期 |

## 架构设计（OCP：新增 agent = 只覆写 adapter 方法，页面/协议/调用方零改动）

### 后端
1. **`AgentAdapter` trait 扩展**（`adapter.rs`）：
   - `async fn resume(&self, ctx, native_session_id)` —— 默认实现返回
     `AppError::Agent("... does not support chat resume")`；
   - `fn supports_chat_resume(&self) -> bool` —— 默认 `false`。
   - 支持者仅覆写这两个方法。
2. **`ServeAdapter::resume`**：跳过 `POST /session`，以 native_session_id 作为 serve_sid
   直接进入既有 prompt_async + SSE pump 流程（抽取 create() 后半段为共用函数）。
3. **新命令** `agent_chat_resume(ctx: SessionRequest, nativeSessionId: string)`
   （`commands.rs` + 注册 `neeko_invoke_handler!`）：走 `adapter.resume()`，
   cursor 照常持久化（cwd/model 同链路）。
4. **历史读取零开发**：复用 conversation 域现有命令
   `list_conversations(agent_id, project_path, limit)` 与 `get_conversation_messages(id)`。
5. **历史转换**：前端将 `ConversationMessage[]` 映射为只读 `ChatMessage[]`
   （text/reasoning block；工具结果降级为文本行——历史无结构化 tool call/审批态）。
   转换放前端 utils（纯函数 + 单测）；后端转换会引入 conversation→agent/chat 反向依赖，破坏域边界。

### 前端
6. **useAgentChat** 增加 `loadHistory(conversationId)`：拉消息 → 转换 → 注入 messages
   （只读标记，后续 prompt 续写在同一流上）。
7. **入口 A**：Chat Tab 无活跃会话时展示「最近会话」列表（list_conversations 数据），
   点击恢复；支持清空新建。
8. **入口 B（Histor 面板）**：`ConversationPanel` 行操作区新增「在 Agent Chat 中恢复」
   —— 仅 `supports_chat_resume=true` 的 agent 显示（能力由后端命令
   `agent_chat_supports_resume(agentId)` 暴露或随列表数据下发）。
9. 续写链路一致性：resume 会话的 prompt_async 与普通流共用（model per-turn、审批 Gate 不变）。

## 验收标准

- [ ] R1 `AgentAdapter::resume/supports_chat_resume` 默认实现 + ServeAdapter 覆写；单测覆盖默认分支与 serve URL/流程分支
- [ ] R2 `agent_chat_resume` 命令注册可用；resume 会话的 cursor 持久化含正确 cwd/model/status
- [ ] R3 前端历史转换纯函数 + 测试（ConversationMessage[] → ChatMessage[]，含 thinking/tool 降级）
- [ ] R4 Chat Tab 内「最近会话」列表：空态展示、点击恢复渲染只读历史、续写正常出流式事件
- [ ] R5 Histor 面板「在 Agent Chat 中恢复」入口（opencode 行显示，gemini/qoder 隐藏）
- [ ] R6 opencode 真实集成测试（#[ignore]）：resume 已有 session 出 TextDelta
- [ ] 回归：`cargo test` / `pnpm type-check` / `pnpm test:run` / `pnpm lint`

## 实施顺序

1. R1 trait 扩展 + ServeAdapter::resume（TDD：先 trait 默认行为测试）
2. R2 命令注册 + manager 接线
3. R3 转换纯函数（TDD 红→绿）
4. R4 Tab 列表入口
5. R5 Histor 入口
6. R6 集成回归

## 关键约束

- 不修改 conversation 域任何代码（单向消费其命令输出，禁止反向依赖）
- resume 与 create 共享 pump/SSE 基础设施，禁止复制粘贴事件循环
- 历史渲染只读：不得触发审批面板/澄清面板等交互态
- Event 名常量沿用 AGENT_CHAT_EVENT
