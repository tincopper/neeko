# Multi-Agent 编排：共享任务板 + 队长/成员（MCP 工具面）

## Goal

> **范围裁决（2026-10-30，用户明确）：首期只做 CLI 成员，Chat 成员延后。**
> 队长与成员**都**是 PTY 里的 CLI agent（`terminal/manager.rs` 的 PTY 路径 + `agent/hooks` 上报）。
> Agent Chat 的四条结构化传输**不进入本期范围** —— 理由见 §「为什么 CLI 先做」。

让 Neeko 支持 **Agent Team**：一个 CLI 会话被提升为**队长**，把活拆成任务写进**共享任务板**；多个 CLI **成员**认领并执行，产物与状态回流到板；队长通过 **MCP 工具面**操作团队（Neeko 不做 LLM，只做协调基质与可观测的 UI）。

一句话判据：**用户能在 Neeko 里看着一队 agent 干活，并且知道谁在干什么、干到哪一步、有没有卡住。**

## Background（事实与证据）

### 已有地基（本仓库实测）

| 能力 | 位置 | 结论 |
| --- | --- | --- |
| 四条结构化传输 | `agent/chat/adapter/registry.rs:PROTOCOL_BUILDS` | Acp / Serve / Jsonl / PiRpc 统一由 `dyn AgentAdapter` + `dyn AgentSession` 抽象 |
| 跨端归一化事件 | `agent/chat/events.rs:StreamEvent` | 含 `TurnStart` / `TurnEnd{reason}` / `RequestApproval` / `SessionDone` |
| CLI 状态回传 | `agent/hooks/targets/entries.rs`、`hooks/templates/` | 8 个 CLI 已接入，语义键 `turn_completed` / `approval_requested` / `input_requested` / `session_failed` |
| 跨 agent 归一化会话模型 | `conversation/types.rs:ConversationMessage` | 10 个 adapter，已按字节预算分页（红线 4 纪律现成） |
| 可扩展 HTTP 服务端 | `server/{engine,gate,group}.rs` | `RouteGroup` + `FailurePolicy::FailClosed`（注释明写留给"未来的交互式客户端"）+ `AuthGate` 恒定时间 token 比较 |
| MCP 配置下发 | `DeploySpec.mcp_config` + `agent/resource_deployer.rs:deploy_mcp` | 可把 MCP server 写进各 CLI 的配置 |
| 身份 env 注入 | `hooks/ingest/attribution.rs:EnvHints` | PTY spawn 已注入 `NEEKO_SESSION_ID` / `NEEKO_PROJECT_ID` |
| worktree 可编程创建 | `common/git/operations/worktree.rs` + `WorkspaceRef` | 服务层是普通 async fn，`CheckoutPath` 双渲染已做身份唯一化（红线 12） |

⇒ **协调基质之外的东西基本都在。缺的是一层"团队"域 + 一个工具面 + 一块可观测的板。**

### 阻塞项（CLI-only 之后重新评估）

原方案按「Chat 成员」列过 8 条阻塞项。**改成 CLI-only 后，其中 5 条直接作废** —— 这是本期选择 CLI 先做的主要收益：

| # | 原阻塞项 | CLI-only 下 | 依据 |
| --- | --- | --- | --- |
| 1 | 没有"等这一轮、拿返回值"的 API | ❌ **作废** | 队长的 `team_wait` 发生在一个 MCP 工具调用内 —— 工具不返回，队长本回合就不会结束，天然阻塞 |
| 2 | 单事件频道 + 前端按 session_id 过滤，N 个成员 streaming 撞红线 4 | ❌ **作废** | CLI 成员不产 `StreamEvent`；队长/成员各自在自己的 PTY 里由 xterm 渲染，走既有终端通道 |
| 3 | opencode serve 进程单例导致成员拿不到身份 env | ❌ **作废** | 只影响 chat 传输；CLI-only 下 opencode 作为 PTY 成员不走 serve |
| 4 | `SessionStatus::AwaitingApproval` 是死代码 | ❌ **作废** | 那是 chat 域枚举；CLI 侧"待批准"落在团队域 `MemberState::Awaiting` |
| 5 | `AgentContext.project_id` 装路径 / `SessionHandle.project_id` 装 id 的撞车 | ❌ **作废** | 不碰 chat 的 `AgentContext`；PTY 侧 `create_session(cwd, …)` 直接收工作目录 |
| 6 | 没有父子会话概念（注册表扁平） | ✅ **存活** | 但只加在团队域（`TeamMember.session_id` / `terminal_id`），不改 chat 的 `SessionHandle` |
| 7 | 会话扫描故意跳过子代理 transcript | ⚠️ **降级** | 团队成员在 Histor 里不可见；本期只要求"团队面板是它自己的入口"，Histor 打标留二期 |
| 8 | TS 事件常量手工镜像、无护栏 | ✅ **存活** | 团队事件同样受红线 5 约束，顺带补护栏 |

**剩下真正的难点只有三条**（都写进 R0/R3）：

1. **MCP 传输形态** —— Neeko 的服务端是 axum HTTP，而 CLI 的 MCP 客户端多数只吃 stdio；需要一层 stdio bridge
2. **准入必须实测** —— 9 个 shell agent 的 `mcp_config` 都是同一个默认模板 `{{home}}/.<id>/config.json`，但各家真实格式/路径不同（claude 是 `settings.json`、codex 是 TOML）；"声明了"不等于"能用"
3. **同 cwd 归因串台** —— 共享工作区下多个成员 cwd 相同，只能靠 env 区分

### 业界已踩过的坑（调研结论，见 `research/`）

| 坑 | 证据 | 本方案的应对 |
| --- | --- | --- |
| **等待是提示词级行为** | Claude Code 官方承认 lead 会自己动手不等队友，"修法"是改 prompt | `team_wait` **后端阻塞**，不依赖队长自觉 |
| **idle ≠ done ≠ task-complete** | 官方文档：task status 会滞后，阻塞依赖任务 | 三态分离 + 任务板为唯一 done 真相 |
| **批准 spawn 即批准其后一切** | Cline subagents 的 footgun | 审批按成员、按工具收窄，且落板可查 |
| **无租约的 claim 会死锁** | 同上"status lags" | `claimed_at + lease_ttl`，超时自动退回 `pending` |

## 为什么 CLI 先做（范围裁决的依据）

不是为了"先做简单的"，而是因为 **CLI 路径恰好让 5 个阻塞项消失**（见上表），并且有一条结构性的优势：

> 当**队长本身也是 CLI** 时，`team_wait` 的阻塞发生在**一个 MCP 工具调用内部**。
> 工具不返回 → 队长这一回合就不会结束 → 队长**在物理上**没有"边等边自己干活"的机会。
>
> 这正是 Claude Code 那个官方缺陷（lead 自己动手不等队友，修法是改 prompt）的克星：
> 它做不到强制等待是因为它把等待做成了提示词行为；我们把它做成了**工具调用语义**。

Chat 路径反而需要额外造 `await_turn` / 在 `spawn_session_pipeline` 上挂观察者 / 处理单频道载荷 —— 一条都不省。

## MCP 传输形态（必须先定的技术选型）

Neeko 的服务端是 axum HTTP（`server/`），但 MCP 客户端的现实是**多数 CLI 只吃 stdio**。

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| **A** 只提供 MCP over HTTP（streamable HTTP） | 无新增产物 | 只有支持 HTTP 的 CLI 能当成员，面可能很窄 |
| **B**（建议）HTTP 为主 + 一个 stdio bridge | 覆盖 stdio-only 的 CLI | 多一个产物 |
| C 只提供 stdio | —— | Neeko 后端要变成 MCP server 的宿主进程，破坏现有 `server/` 分层 |

**建议 B**，且 bridge 走仓库已有的模式：`neeko-report.mjs` 就是 `include_str!` 嵌入、写到 CLI 配置目录的 node 脚本 —— `neeko-team-mcp.mjs` 用同一套（node 已是 hook 的既有依赖，不新增运行时）。

## 目标架构（用户确认的形态）

```
                ┌──────────────────────────┐
                │  Main Agent (Team Lead)  │   被提升的普通会话
                └───────────┬──────────────┘
                            │ spawn + assign（只写板，无直连）
                ┌───────────▼──────────────┐
                │    Shared Task List      │   ← 唯一协调中枢（后端持有）
                └──┬────────┬────────┬─────┘
      claim/update │        │        │
            ┌──────▼─┐  ┌───▼────┐  ┌▼───────┐
            │Member 1│◀─▶│Member 2│◀─▶│Member 3│   横向 Communicate（经后端交换）
            └───┬────┘  └───┬────┘  └───┬────┘
              Work        Work        Work
```

**逻辑网状，物理星形**：横向 `Communicate` 在语义上存在，实现上**必须经 Neeko 后端转发**（成员 A 不去连成员 B）。这条要写死，否则实现者会去发明 A2A/ACP 通道 —— 而那两个协议解决的是完全不同的（跨厂商远端 agent）问题。

## Requirements

### R0 CLI 成员准入（三档，实测为 P0 门）

**不再按「支持/不支持」二分。** 三种信号源（hook / sentinel / MCP）能各自独立缺失，
组合出三档，每档能力不同，UI 必须可区分。

| 档 | 条件 | 完成 | 结果 | 卡住 | 实测结论（`research/admission-matrix.md`） |
| --- | --- | --- | --- | --- | --- |
| **A** | hook + MCP | ✅ | ✅ | ✅ | claude · codex · qoder · codebuddy · pi · opencode（装插件后） |
| **B** | 只有 hook | ✅ | sentinel 补 | ✅ | **omp**（无 `mcp` 子命令，`config.yml` 无 mcp 键） |
| **C** | 只有 sentinel | ✅ | ✅ | ❌ **不可知** | gemini / reasonix（未安装/未测）；**grok 是特例：`channel=Mcp` 但无 hook** |

> 实测已于 2026-10-30 完成（9 个 CLI 只读探测）。**grok 是反例也是证据**：它有完整 MCP
> （能收消息）但 Neeko 没有它的 hook 目标 ⇒ `channel=Mcp` + `result_channel=Sentinel`。
> 这正是把两个维度分开的理由（design §2）。

- R0.1 逐个 CLI 实测三件事，结果落 `research/admission-matrix.md`：① `turn_completed` 是否上报 ② MCP 配置的真实文件与格式 ③ MCP 客户端支持的传输（stdio / HTTP）
- R0.2 **A 档**：三项全成立 —— 完整成员（可认领、可声明完成、卡住可见）
- R0.2b **MCP 注入优先走启动参数**：`claude` / `codebuddy` / `qoder` 实测支持 `--mcp-config`（file 或 string），
  优先用它而非写配置文件 —— 不需要知道各家路径格式（而现有 `DeploySpec.mcp_config` 对 claude **写错了文件**）、
  凭据不落盘、每成员独立 token 天然成立、零清理。
  ⇒ `AgentConfig` 增 `mcp_injection: Argv | ConfigFile | None`；`Argv` 优先，`ConfigFile` 兜底
- R0.2c **传输优先 HTTP**：实测 `claude` `-H header` / `codex` `--bearer-token-env-var` / `opencode` `--header`
  / `pi --url` / `grok -H` 均支持 streamable HTTP ⇒ Neeko 的 axum 服务端可直接当 MCP endpoint；
  stdio bridge 降级为**兜底**，不再是主路径
- R0.3 **B 档**：有 hook、缺 MCP —— 结果靠 sentinel 补，其余同 A
- R0.4 **C 档**：无 hook —— **允许当成员**，但结果只靠 sentinel，且**卡住不可检测**。UI 必须标「推断」而非「正在工作」
- R0.5 `dsh` 仍拒绝：它是 hook-only、无 `AgentConfig`，无法被 `team_spawn` 选中
- R0.6 准入档位由 `team_spawn` 计算并写入 `TeamMember.tier`，**不允许调用方自行声明**

### R0b 审批策略（每成员）

- R0b.1 `approval_policy: Interactive | Queue | Bypass`，在 `team_spawn` 时确定
- R0b.2 `Bypass` 需要的命令行开关**落插件数据**（`AgentConfig.approval_bypass_args`），禁止在团队代码里按 CLI 名分支（红线 15 精神）
  - 实测到的四家写法：`codex --dangerously-bypass-approvals-and-sandbox` · `gemini --skip-trust --approval-mode yolo` · `grok --always-approve` · `claude --dangerously-skip-permissions --permission-mode bypassPermissions`
- R0b.3 默认 `Queue`（进待批队列）。`Bypass` 必须在 UI 上有非隐蔽的警示

### R1 团队与任务板（协调基质）

- R1.1 新域 `agent/team/`：`Team` / `TeamMember` / `TeamTask`，SQLite 持久化，团队随会话结束归档
- R1.2 任务状态：`pending | claimed | in_progress | awaiting_approval | done | failed | blocked | proposed`
- R1.3 **认领式**：队长 `create`，成员 `claim`；claim 必须原子（同任务不能被两人claim）
- R1.4 **租约**：`claimed_at + lease_ttl`，超时自动退回 `pending` 并记一次 `reclaimed` 事件（防死锁）
- R1.5 任务携带 `workspace`（`shared` / `worktree{path}` / `read_only`），**claim 前确定**，事后不可改
- R1.6 任务携带产物：`summary`（短文本上板）+ `artifacts`（路径/PR/commit 引用）；**全文永不进板**（红线 4）
- R1.7 **权限收敛**：只有队长能 `create`；成员只能 `claim` / `update` / `propose`（`proposed` 需队长 accept）
- R1.8 **上报单调性**：hook 上报携带 `seq`，`TeamManager` 丢弃序号不大于已接受值的上报 —— 迟到/乱序的 `turn_completed` 不得覆盖更新的 `approval_requested`

### R2 工具面（MCP）

- R2.1 Neeko 暴露 MCP server，工具面至少在：`team_spawn` / `team_send` / `team_wait` / `team_status` / `task_create` / `task_claim` / `task_update` / `task_list` / `team_close`
- R2.2 队长会话启动时**自动注入**该 MCP 配置（复用 `deploy_mcp`），用户无需手工配置
- R2.3 `team_wait` 在**后端阻塞**，条件可选 `until: declared | idle | any` + `timeout`，返回结果摘要（不是全文）
- R2.4 每个成员拿到**独立 token**，`AuthGate` 解析出 `(team_id, member_id, role)`；成员不能冒充队长
- R2.5 通道三元声明：`WorkerChannel = Mcp | Pty | None`，与 `result_channel = Mcp | Sentinel | None` **分开声明**（一个成员可以有 MCP 收消息、但结果仍走 sentinel）
- R2.6 `team_send` 支持**原子 send+wait**：`team_send(to, message, wait?: {until, timeout_ms})` —— 一次往返提交并等待，避免两次调用之间的竞态
- R2.7 `team_send` 在目标 `Awaiting` 时**拒绝投递**并返回 `target_blocked`，**不写任何字节**（防止把字打进审批框）
- R2.8 `team_wait` 必须**按 `member_id` 钉住**等待对象：任务被租约回收后由新成员接手，**不得**满足旧 waiter
- R2.9 `Pty` 通道的写入协议：`write_literal(text)` → 间隔约 150ms → `write(CR)`。**不能**一次写 `"text\n"` —— 部分 AI TUI 会丢弃或误解释同一批里的回车

### R3 CLI 成员执行（本期唯一执行路径）

- R3.1 复用 `terminal/manager.rs` 的 PTY 路径（红线 1：不新开进程执行路径）；成员 = 一个 PTY 会话 + 注入的 env
- R3.2 身份通过 spawn 时注入 `NEEKO_TEAM_ID` / `NEEKO_TEAM_MEMBER_ID`（与既有 `NEEKO_SESSION_ID` / `NEEKO_PROJECT_ID` 同族）
- R3.3 状态来源 = `agent/hooks` 的四个语义键；观察点落在 `hooks/ingest` 的后处理链上（不是 chat 的 emit 闭包）
- R3.4 **同 cwd 归因保护**：团队上下文中 `NEEKO_TEAM_MEMBER_ID` 未命中 → **拒绝归因**并记 `unattributed`，**不回退 cwd 前缀/basename** —— 宁可丢事件，不可串台
- R3.5 结果取证：`turn_completed` 到达后，用 `conversation` 域按 `(agent_id, native_session_id)` 回读会话文件取最后一轮 assistant 文本（**不 scrape PTY**）
- R3.6 工作区 = 成员的 cwd。`Worktree` 的成员在 spawn 时把 worktree 路径作为 cwd 传入（`create_session(cwd, …)` 已支持），不需要为 chat 侧引入 `WorkspaceRef` 穿透
- R3.7 团队关闭时清理 worktree 必须**协商式**：有未提交改动则保留并提示，不静默删除

### R4 完成判定（单一状态机；L1b 为 CLI 专属取证）

- R4.1 五层判据：L1 机器信号（hook `turn_completed`）、L1b 内容取证（回读会话文件）、L2 显式声明（`task_update(done)`）、L3 超时兜底、L4 进程死亡（`process_reaper`）
- R4.2 `Idle` **永不自动升级**为 `Done`
- R4.3 无 L2 声明时落 `Done{unverified}`，UI 必须可区分"它说完了"与"它说做完了"
- R4.4 "待批准"落团队域 `MemberState::Awaiting` + 任务 `awaiting_approval`（**不动** chat 域的 `SessionStatus::AwaitingApproval`）
- R4.5 **sentinel 通道**：成员把结果打印到自己的 stdout，形如
  `NEEKO_RESULT <nonce> {"executionId":"…","task_id":"…","status":"completed|failed|blocked","summary":"…"}`
  - 扫描器接在 PTY 字节流上（`terminal/pump.rs` sink 的第二消费者），**流式 + 有界**（carry ≤ 8KB、单行 ≤ 2KB、超界丢最旧）
  - 接受条件四条全满足：① 前缀 + nonce 精确匹配 ② JSON 可解析且 `status` ∈ 枚举 ③ `task_id` 存在且 `owner == 本 member`、`state ∈ {in_progress, awaiting_approval}` ④ `executionId` 未消费过
  - 不满足 → 记 audit 后**静默丢弃**（in-band 无法回错）；解析失败不得报"结果损坏"
  - 扫描前剥离 ANSI 转义；只在 `\n` 处切行
  - **nonce 的作用是挡意外回显，不是挡恶意**（恶意在任何通道都挡不住，最终仍靠人工审批门）

### R5 可观测 UI

- R5.1 团队面板：成员花名册（状态/颜色/workspace/消息通道）、任务板（按状态列）、队长对话
- R5.2 成员 transcript **默认不 stream 进前端**：只上行摘要；点开成员时按需拉取（复用 conversation 分页）
- R5.3 待批队列：成员的审批请求进**队列**，不冒泡进队长对话
- R5.4 团队事件走新常量源（红线 5），TS 侧同步

## Non-goals（本阶段明确不做）

- ❌ **Agent Chat 成员（含 Chat 队长）** —— 延后到独立阶段，理由见 §「为什么 CLI 先做」
- ❌ 队长自动提升 / 团队嵌套（一个会话最多当一次队长，成员不能再建团队）
- ❌ 无 LLM 的声明式 DAG 编排器（保留为将来兜底形态，本期不做）
- ❌ 跨机器 / 跨厂商远端 agent 互操作（A2A 属于 ingress 适配器议题）
- ❌ 引入外部多路复用运行时（见 design §「已否决方案」）
- ❌ 并入 `07-26-unified-task-hub` 的 Tasks（WorkItem）看板

## Constraints

- 红线 1：CLI 成员的命令执行仍走 `core::exec` / `common::executor`，不另开路径
- 红线 3：团队域内涉及 `std::fs` / 阻塞读的路径必须 `spawn_blocking`
- 红线 4：**团队成员 transcript 永不整段过 IPC**。板上只放 summary，全文按需分页
- 红线 5：团队事件名只能来自单一常量源（Rust 常量 + TS 镜像，同一 diff）
- 红线 6：`#[tauri::command]` 保持极薄，逻辑落 `agent/team/` manager
- 红线 8：任务携带的 worktree 路径消费前必须 `canonicalize`（走 `WorkspaceRef`）
- 红线 9：`agent/team/mod.rs` 只允许 `mod` + `pub use`
- 红线 12：工作区身份一律 `WorkspaceRef`/`FileRef`，禁止消费侧字符串拼接
- 红线 14：`worker_message_channel` / 完成判定能力**声明即实现**，同一 diff
- 红线 15：CLI 差异只允许落在 `HookTarget` / 模板数据里，团队域禁止 `language_id`/`cli_name` 分支

## Acceptance Criteria

- [ ] AC1 建队 → 派 3 个任务 → 3 个成员各自认领 → 队长 `team_wait` 阻塞到全部 `done`，全程不轮询
- [ ] AC2 成员 A 在无 `task_update` 的情况下收到 hook `turn_completed` → 成员落「空闲 ⚠ 未声明」、任务**仍在进行中**，团队面板可区分
- [ ] AC3 成员进程被 `kill -9` → 租约到期后任务自动回 `pending`，依赖任务不被永久堵死
- [ ] AC4 队长与成员都是 CLI：成员各自 PTY，`team_wait` 在队长的一个 MCP 工具调用内阻塞至多目标 `done`
- [ ] AC5 成员审批请求进队列而非队长对话；批准后成员继续
- [ ] AC6 两个成员分到不同 worktree，并行编辑互不覆盖；产物落各自分支
- [ ] AC7 同 cwd 的两个成员，在 env 缺失时 hook 事件**不串台**（拒绝归因而非误归因）
- [ ] AC7b `research/admission-matrix.md` 落实测结果；`gemini`/`grok`/`reasonix` 被 `team_spawn` 明确拒绝且原因可读
- [ ] AC8 红线 4：任一成员 transcript 单次 IPC 载荷 ≤ 2MB；板上 summary 载荷恒定小
- [ ] AC9 `pnpm check:quick` 绿；新增能力声明有对应实现（红线 14 护栏测试）
- [ ] AC10 已否决方案的判断依据写入 design，含"什么时候它会变成正确答案"
- [ ] AC12 hook 上报乱序：先到 `approval_requested(seq=5)` 后到 `turn_completed(seq=3)` → 后者被丢弃，成员仍为 `Awaiting`
- [ ] AC13 sentinel：跨帧切分能拼回、回显的模板被 `owner/state` 校验拒绝、重复 `executionId` 只消费一次、超长行被丢弃不涨内存
- [ ] AC14 `team_send` 原子性：目标 `Awaiting` 时返回 `target_blocked` 且**未写入任何字节**；`Pty` 通道的 text 与 CR 分两次写入
- [ ] AC15 `team_wait` 钉住：任务被租约回收并由新成员接手后，旧 waiter **不**被满足
- [ ] AC11 原型对齐：`prototype-agent-team.html` 四视图逐条落地；六态徽标**不得合并**；「未声明」的任务留在进行中列

## 原型

`prototype-agent-team.html`（自包含、无外部依赖，直接用浏览器打开）。

它用四个视图锁死本设计的**视觉契约**，不是为了好看：

| 视图 | 钉住了什么 |
| --- | --- |
| ① 团队面板 | 成员花名册 / 共享任务板 / 队长对话怎么落进 Neeko 的 dock；`create` 仅队长、claim 原子、租约 1800s 写在标题栏 |
| ② 完成判定六态 | design §6 的六种徽标**形状 + 语义 + 为什么不能合并**。这是最容易被实现简化错的地方 |
| ③ CLI 准入与能力 | 逐个 CLI 的 hook 事件面 × MCP 面 × 传输；谁能当完整成员、谁只能当一次性工人、谁被拒绝 —— 能力缺口必须在 UI 上可见 |
| ④ 一次完整流程 | spawn → claim → 阻塞等待 → 审批队列 → 未声明 → 声明 → 租约回收，8 步可点「推进演示」走一遍 |

两处交互要特别验证：
- **「推进演示 →」**：驱动成员状态迁移，让六种徽标依次出现（含租约回收进「阻塞」列）
- **「切换到队长视角」**：演示反模式 —— 审批冒泡进队长对话会造成什么，用于说明为什么选队列而不选冒泡

> 注：原型成员已全部改为 CLI（claude-code / codex / pi / omp），与本期 CLI-only 范围一致。

> 原型本身修掉了一个设计错误：初版把「未声明」的任务放进了「已完成」列，违反 R4/不变量 2（完成的唯一权威是任务板）。现在成员显示「空闲 ⚠ 未声明」，任务**仍留在进行中** —— 这个区别必须保住。

## 已拍板的裁决（2026-10-30，用户「按建议值全部默认推进」）

| # | 裁决 | 结论 |
| --- | --- | --- |
| 1 | **命名三撞车** | 代码域 `TeamTask`（`src-tauri/src/agent/team/`）；UI 文案「**团队任务**」；**不并入** `07-26-unified-task-hub` 的 Tasks 看板。三者语义不同：`features/task` = Launch（跑脚本）、`WorkItem` = 人的工作项、`TeamTask` = 派给 agent 的一次执行 |
| 2 | **成员能否建任务** | **只有队长 `create`**；成员只能 `claim` / `update` / `propose`。`proposed` 需队长 accept —— 防无限扇出 |
| 3 | **CLI `Stop` hook 否决权** | **不给**。保持 `neeko-report.mjs`「永远 exit 0」契约，改用 L2 显式声明 + 队长复核 |
| 4 | **MCP 传输** | **B 方案**：HTTP 为主 + `neeko-team-mcp.mjs` stdio bridge（照 `include_str!` 既有模式，node 已是 hook 依赖） |
| 5 | **sentinel 是否一期** | **是**。纯函数扫描器，成本低；且它是 C 档成员的唯一入口 |
| 6 | **成员 token 怎么过鉴权门** | **D+E**：团队流量走**独立 listener** + 独立 `AuthGate`（多 token），**hooks 那道门一字不改**；身份在 handler 内按 **sha256 查表**解析，不新增恒定时间比较。理由：同端口共用会让成员 token 能伪造队友的 `turn_completed`（正是 §5.4 在防的同类事故） |

## Research

- `research/01-research-notes.md` —— 三信源合并笔记（Claude Code 源码剖析 / 业界调研 / Neeko 代码测绘）
- `research/00-claude-code-agent-teams-source-analysis.txt` —— 源码级剖析原文存档
