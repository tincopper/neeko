# Agent 会话运行状态实时跟踪 —— 业界方案调研

> 调研日期：2026-08-13
> 背景：Neeko 需要展示各 Agent 会话的实时语义状态（思考中 / 执行工具 / 等待输入 / 会话完成），而非进程存活状态。
> 结论先行：业界标准做法是 **「宿主进程通过 Agent 的一手 SDK / 事件流运行 Agent 并自行渲染状态」**；从 PTY 字节流或进程存活推断语义状态是业界明确弃用的路径。

---

## 1. 业界统一模式：宿主跑 Agent，不包装 TUI

所有第一方产品（Claude Code、Codex、OpenCode）都是同一种架构：

```
宿主进程（应用 / IDE / SDK）
   │  以库或 headless 模式运行 Agent，订阅结构化事件流
   ▼
事件流：thinking / tool_use(input_json_delta) / text / done
   │
   ▼
UI 自行渲染"思考中 / 执行工具 X / 等待输入 / 完成"
```

- Cursor / Windsurf / VS Code Copilot：模型在自己进程内跑，直接消费原生事件渲染状态（无对外订阅协议）。
- 反例澄清：`claude-code-router` 看似"包装 CLI"，实际是 HTTP 代理，站在 **Messages API 事件流中间**获取结构化状态 —— 从不碰 TUI。
- TerminalAI、Wezterm、tmux control mode：只暴露 PTY 字节流与进程存活，**没有** Agent 语义 —— 即"包装 TUI"无法获得语义状态。

## 2. 有官方事件接口的 Agent（可以拿到真实语义状态）

### 2.1 Claude Code — Agent SDK / `stream-json` ✅

- `claude -p "<prompt>" --output-format stream-json` 输出 JSON Lines；SDK（TypeScript/Python）的 `agent.query()` 返回 `AsyncGenerator<AgentEvent>` / `onEvent`。
- 事件：`MessageStreamEvent`（contentBlockStart/Delta/Stop，delta 含 `thinking_delta` / `text_delta` / `input_json_delta`）、`SubagentEvent`、`HookEvent`、`ResultEvent`。
- 另有 hooks（PreToolUse / PostToolUse / Notification / UserPromptSubmit / Stop）作为 TUI 模式下的侧信道。
- 来源：
  - https://docs.claude.com/en/api/agent-sdk/typescript/overview
  - https://docs.claude.com/en/api/agent-sdk/typescript/events
  - https://docs.claude.com/en/docs/claude-code/cli-reference（`-p` / `--output-format text|json|stream-json`）
  - https://docs.claude.com/en/docs/claude-code/hooks

### 2.2 OpenAI Codex — `codex exec --json` ✅

- `codex exec --json`（及 `codex resume --json`）stdout 每行一个 JSON 事件，与 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` 同源。
- 关键事件类型：`session_meta`、`turn_context`、`response_item`（`message` / `function_call` / `function_call_output` / `reasoning`）、`event_msg`、**`agent_state`（phase: `thinking | working | done`）**、`read`/`write`/`exec_command`、**`prompt_approve_requested` / `approved_prompt`（等待输入/审批）**。
- TUI（ratatui）与外部工具消费同一内部事件流，无独立 TUI 协议。
- 来源：
  - https://github.com/openai/codex（README "JSON output"）
  - https://github.com/openai/codex/blob/main/codex-rs/core/src/session/events.rs
  - https://github.com/openai/codex/blob/main/codex-rs/core/src/agent/state.rs

### 2.3 OpenCode — server + SSE ✅（对 Neeko 价值最高）

- 架构：`opencode` 启动 = TUI 客户端 + 内置 HTTP server（默认端口 4096，`opencode serve` 可独立启动），TUI 本身也是该 server 的客户端。第三方 UI 可附加订阅 —— **这是设计支持的用法**。
- `POST /session/:id/message` 返回 `text/event-stream`；事件名：`session.updated`、**`session.idle`**、`session.error`、`session.paused`、`message.updated`、**`message.part.updated`**（part 类型 `text` / **`reasoning`** / **`tool`** —— 直接给出"思考中/执行工具 X"）。
- SDK：`@opencode-ai/sdk`（由 server 的 OpenAPI 3.1 规范生成）；`opencode run --json` 为 headless 一次性模式。
- 来源：
  - https://opencode.ai/docs/server/（`opencode serve`、SSE、OpenAPI）
  - https://opencode.ai/docs/cli/
  - https://github.com/sst/opencode（`packages/opencode/src/session/eventbus.ts`）
  - https://www.npmjs.com/package/@opencode-ai/sdk

## 3. 无事件接口的 TUI-only Agent（拿不到实时语义状态）

- Gemini CLI（`gemini -p` 仅纯文本输出，无结构化事件流）、CodeBuddy、Qoder、Reasonix、Grok、OMP、Pi —— 只有 TUI + 磁盘会话文件（`~/.gemini/tmp/<hash>/chats/*.json` 等），**无第一方实时状态接口**。
- 对策（业界通行）：① 渲染原始 PTY 流，不伪造语义状态；② 尾部跟踪其原生会话存储做 **准实时 / 事后** 状态；③ 绝不解析 ANSI/TUI 输出。

## 4. 对 Neeko 的落地方案（按优先级）

| 优先级 | Agent | 做法 | 状态精度 |
|---|---|---|---|
| 1 | opencode | `opencode serve` + `@opencode-ai/sdk` SSE（或 `run --json`） | 思考/工具/空闲/完成，实时 |
| 1 | claude-code | `claude -p --output-format stream-json`（或 Agent SDK） | 思考/工具/文本/完成，实时 |
| 1 | codex | `codex exec --json` | thinking/working/done + 审批等待，实时 |
| 2 | gemini / qoder / codebuddy / grok / omp / pi / reasonix | 保留 TUI，尾部跟踪会话存储 | 仅准实时/事后，粗粒度（运行中/完成） |
| 3 | 任何 Agent | ~~ANSI 解析 / 进程存活推断~~ | 弃用 |

关键取舍：**要实时语义状态，就必须放弃交互式 TUI，改用 headless 事件流模式**（Neeko 注册表中部分 Agent 已是 headless：`opencode run`、`gemini -p`、`grok -p`，只需切换其结构化输出）。若必须保留 TUI 交互，则只能得到字节流 + 事后存储，无法获得实时语义状态 —— 这是业界一致的结论。

> ⚠️ 补充修正（2026-08-13）：上述"必须放弃 TUI"的结论只对 headless 事件流成立。**Hooks 方案可以在保留交互式 TUI 的前提下获得实时语义状态**，见 §5。

## 5. Hooks 方案：保留 TUI 也能拿实时状态（业界已验证）

### 5.1 原理与验证

Claude Code 提供 **Hooks 机制**：在会话生命周期的关键节点主动推送事件（stdin JSON / HTTP POST / MCP），命令 hook 每次事件触发启动一个短生命周期进程。官方文档事件表（2026 版，26+ 事件）：

- 每会话：`SessionStart` / `SessionEnd`
- 每轮：`UserPromptSubmit` / `Stop` / `StopFailure`
- 每次工具调用：`PreToolUse` / `PostToolUse` / `PostToolUseFailure` / `PermissionRequest` / `PermissionDenied`
- 其他：`Notification`（含 permission_prompt / idle_prompt，即"等待输入/权限"信号）、`SubagentStart/Stop`、`TaskCreated/Completed`、`MessageDisplay`、`FileChanged` 等

**真实应用案例（已核实）**：
- **Sessionly**（Electron 桌面宠物应用）：用 `PreToolUse`/`PostToolUse`/`Stop`/`Notification` 驱动像素宠物实时反映"读文件/跑命令/完成任务"状态 —— 正是"hooks → 本地接收端 → 状态展示"模式（hook 通过 `curl POST` 转发到 `localhost:19823` 的 hook server）。
- **Claude-Code-Notifier**（GitHub）：PreToolUse/PostToolUse/Stop/Notification → 多渠道实时通知。
- **cc-status 类插件**：用 POSIX FIFO 命名管道做 IPC（hook 短进程 → 常驻 overlay 进程）。
- **OpenCode 插件**：`tool.execute.before` / `tool.execute.after`、session 事件；`opencode-hooks-plugin` 直接把 Claude Code hooks 配置映射到 OpenCode 生命周期事件（部分事件如 PermissionRequest/SubagentStart 无对应，会告警跳过）。

### 5.2 Hooks 覆盖范围（对 Neeko 各 Agent）

| Agent | Hooks 支持 | 关键事件 | 状态精度 |
|---|---|---|---|
| claude-code | ✅ 最全 | PreToolUse/PostToolUse/Stop/Notification/PermissionRequest/SessionStart/End | 思考(推断)/工具/等待输入/权限/完成，实时 |
| opencode | ✅ 插件事件 | tool.execute.before/after、session.*、message.part.updated | 思考/工具/空闲/完成，实时 |
| codex | ❌ 无 hooks | 改用 `exec --json`（agent_state: thinking/working/done） | 实时（headless） |
| gemini / qoder / codebuddy / grok / omp / pi / reasonix | ❌ | 无 | 仅 TUI + 事后存储 |

### 5.3 实现模式（业界统一）

```
Agent CLI (交互式 TUI)
   │  每事件触发 hook（短进程 / HTTP POST）
   ▼
本地接收端：localhost HTTP server（如 :19823）或 FIFO 命名管道
   ▼
事件 → 状态机：UserPromptSubmit→思考中；PreToolUse→执行工具X；
               PostToolUse→思考中；Notification(idle/permission)→等待输入；
               Stop→等待输入；SessionEnd→已完成
   ▼
UI 展示
```

关键工程点：① hook 命令要极轻量（`curl POST` 或写 FIFO，超时短）；② 用 **async/HTTP hook** 避免阻塞 Agent；③ hook JSON 含 `session_id`/`cwd` 用于与会话关联；④ 注册 hooks 需合并进用户 `settings.json`，不可覆盖用户已有 hooks；⑤ `PreToolUse` 返回 exit 2 可阻断 —— 状态上报 hook 必须返回 0，绝不干扰 Agent。
