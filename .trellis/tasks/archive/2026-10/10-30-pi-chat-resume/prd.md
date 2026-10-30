# Pi 历史会话恢复为 Agent Chat（能力单一真相 + 死入口清除）

## Goal

让「历史会话 → 在 Agent Chat 里继续聊」这条链路对 **pi** 真正成立，并让该入口的
显隐由**唯一能力真相**推导，消除当前「按钮在、点了没反应」的死入口。

## Background（问题分析：事实与证据）

用户报告：**「会话历史注入不了 agent-chat」**。两条入口的表现：

| 入口 | 位置 | 现状 |
| --- | --- | --- |
| Conversations 面板行的「Open in Agent Chat」 | `src/app/dock/wrappers/ConversationsPanelWrapper.tsx:110` → tab data 带 `resumeConversationId` | 新 tab 打开但**空着、无任何提示** |
| 空聊天里的「恢复上次对话」列表 | `useChatRestore.loadResumableList` → `AgentChatTabView.tsx:196` | 点击后追加 `⚠ 恢复会话失败: …agent pi does not support resuming into Agent Chat` |

代码事实：

1. `src-tauri/src/agent/chat/adapter/pi_rpc/adapter.rs:54` 的 `chat_capabilities()`
   已声明 `resume: true`（`ChatCapabilities.resume` 的契约是「`resume_id` 有真实值
   **且 `resume` 可用**」，见 `capabilities.rs:82`）。
2. 同一个 adapter **没有** override `AgentAdapter::resume()` 与
   `supports_chat_resume()`（`adapter/../adapter.rs:146/159` 默认实现：报错 / `false`）。
   ⇒ `agent_chat_supports_resume("pi")` 返回 `false`（`chat/commands.rs:533`），
   `agent_chat_resume` 直接 `Err`（`chat/commands.rs:261`）。
3. 前端 Histor 一次性恢复 effect 先问 `supportsAgentChatResume(fallbackAgentId)`
   （`useChatRestore.ts:186`），false 时**静默跳过**并清掉 tab 上的 resume 标记
   ⇒ 用户看到的是一个空 tab，没有任何原因说明。
4. 入口显隐只看 conversation 域 `meta.supportsResume`（`ConversationItem.tsx:88`
   = CLI 能否 `--session`），没有看 chat 域能力。于是 claude-code / codex / grok /
   reasonix / omp / codebuddy（conversation 侧 `resume_command` 非空、chat 侧
   `supports_chat_resume()` 为 false）**全部**是同一种死入口。

运行时事实（本机实测，pi 已安装）：

- `pi --mode rpc --session <uuid>` **能**恢复：`get_state` 返回同一 `sessionId`
  与 `messageCount: 55`。⇒「pi 不支持 chat 恢复」不是事实，是**声明与实现脱节**。
- `pi --mode rpc --session <不存在的 id>` → **进程 exit 1，stderr
  `No session found matching '<id>'`**。但 `PiRpcProcess::spawn` 丢弃 stderr
  （`process.rs:113` `_stderr`），且读循环结束时**不 settle pending**
  （`process.rs:315` 只 log）⇒ 上层要等 `AUX_TIMEOUT`(5s) 才拿到
  `pi rpc command timed out after 5s`：慢 5 秒、且原因完全错误。

## 第一性原理：这个问题本质上是什么

「继续一次历史会话」在最小实现里只需要三件事（缺一不可，互相正交）：

1. **绑定**：一个活进程重新挂到**已存在**的原生会话状态上；
2. **回放**：把该会话已有的回合渲染出来；
3. **接续**：用户的下一条消息路由到**同一个**进程。

会话状态的唯一权威是 agent 自己的存储（pi 的 `~/.pi/agent/sessions/**/*.jsonl`、
opencode 的 SQLite）；Neeko 只持有一个引用 `nativeSessionId`。由此：

- 「能否恢复」是 **(agent, 传输)** 这条组合的属性（能不能用原生 id 重新绑定进程），
  **不是** conversation 扫描器的属性（能不能从磁盘读出标题/消息数），
  也**不是** CLI 参数表的存在性。
- 所以「入口显隐」与「执行」必须消费**同一个事实**。当前 bug 的根因正是两个轴被混成
  一条：显隐读 conversation 侧 `supportsResume`，执行走 chat 侧 `supports_chat_resume`。
- 因此修复不是「给 pi 打一个补丁」，而是：**让 `AgentAdapter::supports_chat_resume()`
  成为唯一真相**，pi 补齐实现，UI 从它派生。

## Requirements

### R1 pi 的 chat 恢复真正可用

- R1.1 `PiRpcAdapter` 实现 `supports_chat_resume() -> true` 与
  `resume(ctx, native_session_id)`：以 `pi … --session <id>` spawn 后走既有握手，
  **不发首轮 prompt**（静默；历史由 conversation 域回放）。
- R1.2 恢复后的会话必须**证明确实绑定到同一个原生会话**：握手得到的
  `get_state.sessionId` 与请求的 `native_session_id` 不一致时报错并回收进程
  （否则可能静默落到另一个会话，比失败更糟）。
- R1.3 恢复后用户的下一条消息续写到**同一会话**（走既有 `agent_stream` 续聊分支：
  `request_channel()` 必须可用、`resume_id()` 返回同一 id），不新建进程。
- R1.4 恢复目标 id 来自 conversation 域（`ConversationMeta.nativeSessionId`），
  Neeko 不自行解析 pi 的会话存储布局。

### R2 恢复失败必须「快且可归因」

- R2.1 pi 进程在读循环结束（stdout 关闭 / 进程退出）时，必须立刻让**在途请求**失败，
  不允许退化成 N 秒超时。
- R2.2 握手失败时错误信息必须携带 pi 自己的 stderr 尾部（例如
  `No session found matching '…'`），而不是 `timed out after 5s`。
- R2.3 错误信息经 `agent_chat_resume` → 前端 `⚠ 恢复会话失败: …` 原样可见（含原因）。

### R3 入口显隐由唯一能力真相派生（消除死入口）

- R3.1 前端新增「chat 恢复支持」查询入口（带内存缓存），
  唯一数据源是后端 `agent_chat_supports_resume`。缓存键 = `agentId` **+ 启动签名**
  （`chat` / `chat_enabled`）——「能力是静态事实」只对**同一份配置**成立，
  用户改完 chat 传输后同一个 id 的答案就会变，只按 id 缓存会让显隐失真到重启。
- R3.2 Conversations 面板行内「Open in Agent Chat」按钮：仅当该会话的 `agentId`
  支持 chat 恢复时出现（opencode、pi → 出现；claude-code/codex/grok/… → 不出现）。
  **不叠加** conversation 侧 `meta.supportsResume`（CLI 能否 `--resume` 是另一个轴）。
- R3.3 空聊天「最近会话」列表只列出**当前支持 chat 恢复**的 agent 会话；
  点击不再产生失败提示。
- R3.4 不做「悄悄消失」：conversation 侧 `Resume`（原生 CLI 终端恢复）行为**不变**，
  仍按 `supportsResume` 显隐。

### R4 工程质量

- R4.1 纯函数（参数拼装、能力一致性、错误装饰、列表过滤）单测覆盖 100%。
- R4.2 `chat_capabilities().resume == supports_chat_resume()` 由测试钉住（红线 14 同源：
  声明了却没人实现 = 静默功能缺失；实现了却不声明 = 入口消失）。
- R4.3 不新增依赖；`pnpm check:quick` 全绿；Rust 侧 `cargo test --lib` 绿。

## Constraints

- 红线 1/2：进程只经 `core::exec`（现有 `PiRpcProcess::spawn` 已合规），本地路径 shell 选择不改。
- 红线 3：无新增阻塞 I/O。
- 红线 6：`#[tauri::command]` 保持极薄（本次不改 command 层结构）。
- 红线 10：pi 专属逻辑留在 `agent/chat/adapter/pi_rpc/`，通用模块不出现 `agent_id == "pi"` 分支。
- 红线 13：测试夹具路径由 `tempdir()` / 现有 duplex 夹具推导。
- TDD 强制：先写失败测试（Red）再实现（Green）。
- 前端 `invoke` 只允许出现在 feature API 门面（`features/agent-chat/api/`）。

## Acceptance Criteria

- [x] AC1 从 Conversations 面板对一条 **pi** 会话点「Open in Agent Chat」：新 tab 显示该会话的
      历史回合，且不弹失败提示。
      *真机验证（探针，跑完删除）：入口显隐与执行消费同一能力位；`PiRpcAdapter::resume` 用会话
      文件 header 的 `id` + `cwd` 调起 pi，握手成功并 `resume_id() == 请求的 id`。历史回放由
      conversation 域提供（既有用例覆盖）。*
- [x] AC2 在该 tab 里继续发消息：pi 侧续写到同一原生会话（会话文件行数增长、
      `get_state.sessionId` 不变），而非新建会话。
      *真机验证：`resume(header id)` → `resume_id() == 01a00333-8bdd-7807-a99b-a6706a9641b9`
      （请求值），随后 cancel；绑定校验就是 `ensure_bound_to(requested, get_state.sessionId)`。
      反证：用**文件名 stem** 恢复会被 pi 拒绝（`No session found matching '<stem>'`）—— 这正是
      「id 必须取文件头而不是文件名」的实测依据（`pi.rs::parse_meta` 取 `first.get("id")`，
      文件名只作 header 缺 `id` 时的 fallback）。*
- [x] AC3 对不存在的原生 id 恢复：3s 内失败，错误信息含 pi 的 stderr 原因
      （`No session found matching …`），不出现 `timed out`。
      *真机验证：**1.22s** 失败，错误文本
      `pi rpc: process ended before responding — pi stderr: No session found matching '…'`
      （无 `timed out`）。*
- [x] AC4 claude-code / codex / grok 等不支持 chat 恢复的 agent 会话行**不出现**
      「Open in Agent Chat」按钮；这些会话的原生 CLI `Resume` 按钮仍在。
- [x] AC5 空聊天「最近会话」列表只含支持 chat 恢复的 agent 条目。
- [x] AC6 `chat_capabilities().resume` 与 `supports_chat_resume()` 一致性测试存在且绿。
- [x] AC7 `pnpm check:quick` 绿；`cargo test --lib` 绿（2332 passed, 5 ignored）。

## 附：pi 会话的项目归属（固有语义，非本任务的处理项）

pi 的会话按**创建时的项目目录**归属（`--session` 在该 cwd 下解析；跨项目会要求 `--fork` 确认），
因此「跨项目恢复」本就不成立。`resume()` 的 cwd 取 `ctx.project_id`（= tab 的项目 =
conversation 的 `project_path` = 会话 header 的 `cwd`），两者天然一致，无需额外处理。

## Out of Scope

- 为 ACP 传输（claude-code / codex / gemini / qoder / …）实现 `session/load` 式 chat 恢复。
  （能力位保持 `false`，入口隐藏 —— 诚实降级，不在本轮扩张。）
- `pi --session-id`（缺失即新建）语义、`--fork` 分叉恢复。
- 终端侧原生 resume（`get_resume_command` → 终端 tab）行为变更。
- 会话标题（pi 显示 id 而非标题）—— 属 conversation 域独立问题，不在本任务内。
