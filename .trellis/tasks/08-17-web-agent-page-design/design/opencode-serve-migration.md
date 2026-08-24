# opencode 适配层迁移：ACP → Serve（opencode serve + HTTP + SSE）

## 背景

Neeko 目前通过 `opencode acp`（Agent Client Protocol，JSON-RPC over stdio）与 opencode 通信，
因此模型固定为 `~/.config/opencode/opencode.json` 中的 `coding-plan/kimi-k2.7-code`，无法切换。

上游限制（GitHub anomalyco/opencode#31750）：opencode 1.18.x 的 ACP 协议**不支持 per-session
模型选择**。而 opencode 原生 HTTP server（`opencode serve`）的 REST API 在**会话创建**和
**每次 prompt** 时都支持显式指定 model。

## 方案

**新增 `ServeAdapter`（opencode serve + HTTP + SSE），保留 `AcpAdapter` 能力不动，
opencode 的 `chat_transport` 从 `"acp"` 切到 `"serve"`。**

这是「高内聚、低耦合、可扩展」下的最小侵入方案：

- **高内聚**：新 adapter 独立成文件 `adapter/serve.rs`，只负责「启动 serve + HTTP 客户端 + SSE 事件转换」。
- **低耦合**：适配器仍实现既有 `AgentAdapter` / `AgentSession` trait，bridge 与命令层零改动。
- **可扩展**：`adapter_for` 新增 transport 分支（OCP），新增 agent 只需声明 `chat_transport: "serve"`。
- **能力保留**：`AcpAdapter` 文件与代码原样保留，仅 opencode 不再走该分支；若未来 ACP 支持模型选择可低成本切回。

## 关键设计决策

### 1. 协议形态（对齐 synara 已验证路线）

参照 synara `apps/server/src/provider/opencodeRuntime.ts` + `Layers/OpenCodeAdapter.ts`：

| 能力 | opencode serve HTTP | Neeko 用途 |
|------|--------------------|-----------|
| 启动 | `opencode serve --hostname 127.0.0.1 --port N` | 进程级复用（首个会话 lazy 启动，共享一个 server） |
| 就绪 | stdout 输出 `opencode server listening on http://127.0.0.1:PORT` | 解析 URL |
| 鉴权 | `OPENCODE_SERVER_PASSWORD` 未设时 unsecured（本机 localhost） | 不设置 password，无鉴权 |
| 建会话 | `POST /session` body: `{ model: { providerID, id }, agent, permission, title }` | 每会话带 `model` |
| 发消息 | `POST /session/{id}/prompt_async` body: `{ model: { providerID, modelID }, parts: [{ type:"text", text }] }` | 每轮显式 model + text part |
| 事件流 | `GET /event` SSE | 订阅 `session.updated` / `message.updated` / `message.part.updated` / `session.idle` / `session.error` / `permission.asked` |
| 取消 | `POST /session/{id}/stop` | cancel |

### 2. 模型传递链路

```
前端 ModelPicker (selectedModel: ModelInfo)
  → StreamChatRequest.model?: ModelInfo (agentChatApi.ts)
    → StreamRequest.model?: ModelInfo (commands.rs)
      → AgentContext.model: Option<ModelInfo> (adapter.rs)
        → ServeAdapter::create(ctx)
          → POST /session { model: { providerID, modelID } }
```

- `ModelInfo.id` 是完整 slug（`anthropic/claude-sonnet-4-...`），拆分为 `providerID`（`/` 前）+ `modelID`（`/` 后）传给 serve。
- 未选模型（`model=None`）→ 不传 `model` 字段 → serve 回落到 config 默认。

### 3. 事件转换（serve SSE → StreamEvent）

| serve SSE event | StreamEvent |
|----------------|-------------|
| `session.updated` (首次) | `SessionStart { session_id, agent:"opencode", model }` |
| `message.part.updated` type=`text` | `TextDelta { delta }` |
| `message.part.updated` type=`reasoning` | `ReasoningDelta { delta }` |
| `message.part.updated` type=`tool` | `ToolStart` / `ToolOutput` / `ToolEnd` |
| `message.updated` role=assistant 含 tool 结果 | `ToolEnd`（补充输出） |
| `permission.asked` | `RequestApproval { call_id, tool, title, prompt }` |
| `session.idle` | `TurnEnd { reason: Completed }` |
| `session.error` | `Error { kind: Agent }` |
| stream 结束 | `SessionDone { reason }` |

> **简化（YAGNI）**：首版只映射 text/reasoning/tool/approval/idle/error 六类。
> diff / command 回显等高级能力留待后续（serve 的 `permission.asked` 已含 cmd 信息，可渐进补）。

### 4. Server 生命周期（低耦合复用）

- **进程复用**：进程级 `OnceCell<Arc<ServeConnection>>`，首个 opencode 会话 lazy 启动 serve；
  后续会话复用同一 HTTP 连接。会话数归零时不主动杀进程（进程随 app 退出），避免竞态。
- **resume_id**：serve 会话的 provider 侧 session id（serve 返回的 UUID）→ `SessionHandle` 复用。
  续写会话复用既有 serve session（`prompt_async` 到既有 session id）。

### 5. 约束（AGENTS.md 红线）

- **统一执行门面**：`opencode serve` 启动必须走 `crate::core::exec::spawn`，禁止直接 `std::process::Command`。
- **阻塞 I/O 隔离**：HTTP 请求走 `reqwest`（已内置 blocking/json/stream），SSE 读取放独立任务；异步代码用 async 变体。
- **if-let 嵌套 ≤ 3**：事件转换用 `match`。
- **mod.rs 极薄**：`serve.rs` 独立文件，`adapter.rs` 只 `pub mod serve; pub use serve::ServeAdapter;`。
- **IPC 大文本边界**：text delta 是增量小文本，天然合规。

## 里程碑（Red-Green-Refactor）

### M1 模型传递链路（纯数据传输）
- 前端 `StreamChatRequest.model`、后端 `StreamRequest.model`、`AgentContext.model` 字段贯通。
- 测试：`useAgentChatStore` / API 层字段存在性 + Rust 端 `StreamRequest` 反序列化测试。
- 效果：数据链路通了，但 serve 未接入 → 模型仍未生效（行为无回归）。

### M2 ServeAdapter 核心（TextDelta 流）
- 新增 `adapter/serve.rs`：启动 serve + 建会话 + prompt_async + SSE → TextDelta。
- `adapter_for` 新增 `serve` transport 分支；opencode `chat_transport` 切 `"serve"`。
- 测试：事件转换纯函数单测（serve SSE JSON → StreamEvent 映射全覆盖）。

### M3 模型生效 + 审批 + 生命周期
- `AgentContext.model` → `session.create` 传递；未选模型回落默认。
- `permission.asked` → `RequestApproval`；`approve` → `permission.reply`。
- resume（续写既有 serve session）。
- 测试：集成测（真实 opencode serve，标记 `#[ignore]` 慢测）+ 单测。

## 保留能力清单（不删除）

- `AcpAdapter`（`adapter/acp.rs`）原样保留：mockAgent 模拟、其他 agent 的 `chat_transport:"acp"` 路径不变。
- opencode 仅 `chat_transport` 字段从 `"acp"` → `"serve"`，其余 agent 不受影响。