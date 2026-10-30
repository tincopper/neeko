# Design — Multi-Agent 编排

> 前置：`prd.md`。本文件只写**技术裁决**：边界、契约、数据流、取舍、以及被否决的方案。
> 凡涉及既有代码的断言都带路径；未直接核实的标 `(待确认)`。

---

## 1. 分层裁决

### 1.1 新域位置

```
src-tauri/src/agent/team/          ← 新域（协调基质）
├── mod.rs           只允许 mod + pub use（红线 9）
├── types.rs         Team / TeamMember / TeamTask / TeamTaskState / Workspace / WorkerChannel
├── manager.rs       TeamManager（内存态 + 状态机迁移；唯一写入口）
├── store.rs         SQLite 持久化（team / team_member / team_task / team_event）
├── lease.rs         租约计算与回收（纯函数优先，便于 100% 覆盖）
├── completion.rs    完成判定（五层判据 → 状态迁移，纯函数）
├── identity.rs      token ↔ (team_id, member_id, role) 解析与签发
├── mcp/             MCP 工具面（工具签名 + 入参校验 + 调度 manager）
│   ├── mod.rs
│   ├── schema.rs    工具清单与 JSON Schema（单一源）
│   └── dispatch.rs  工具调用 → manager 方法
└── commands.rs      极薄 Tauri 命令（红线 6）
```

依赖方向（单向，禁止反向）：

```
agent::team::commands ──▶ agent::team::manager ──▶ agent::team::store
                                   │
                                   ├──▶ agent::hooks::ingest              （状态来源：唯一观察点）
                                   ├──▶ agent::terminal (via 命令层)       （成员 = PTY 会话）
                                   ├──▶ conversation::{manager, types}     （L1b 结果取证）
                                   └──▶ common::git::operations::worktree  （workspace = 成员的 cwd）
server::group::RouteGroup ◀── 组合根注入 team 路由组（server 域禁止 import 业务域）

**本期不 import `agent::chat`** —— CLI-only 不走 StreamEvent，也不碰 `SessionHandle`。
```

**关键裁决**：`server/` 不 import `agent::team`（该模块文档明确禁止），团队路由组由组合根（`app/`）构造后 `mount` 进去。违反此条会让 `server` 能跑纯 tokio 测试的前提失效。

### 1.2 为什么协调基质在 Rust 后端，而不是文件

Claude Code 用文件邮箱是**因为它没有中间人**：N 个独立进程 + 一个 CLI，只能约定磁盘协议（`~/.claude/teams/{team}/inboxes/*.json` + lockfile 读-改-写）。

Neeko **有中间人**（Rust 后端 + `server/` + SQLite）。所以：

| 维度 | 文件邮箱 | 后端持有（本方案） |
| --- | --- | --- |
| 崩溃恢复 | 天然（消息不会丢） | SQLite 事务，等价 |
| 并发安全 | lockfile 读-改-写 + 重试退避 | 单写者 + 事务 |
| 可查询 | 要自己扫盘 | SQL |
| 真相源数量 | **2**（文件 + UI 内存） | **1** |
| 调试 | 可直接读 JSON ✅ | 需 sqlite3 或调试命令 |

最后两行是决定性的：文件方案会让"板上状态"和"UI 状态"成为两个真相源，而这正是本项目反复吃过亏的模式（见 `10-30-pi-chat-resume`：能力声明与实现脱节）。

**唯一的例外**：需要给 CLI 成员暴露"可读的产物文件"时（如把 summary 落到 worktree 里的 `.neeko/team/`），那是**产物**不是**状态**，允许写盘。状态只走后端。

---

## 2. 数据模型

```rust
// types.rs —— 只放数据，不放行为
pub struct Team {
    pub id: String,                    // tm_{nanos_hex}
    pub name: String,                  // 用户可读，缺失时派生
    pub lead_session_id: String,
    pub lead_agent_id: String,
    pub project_path: PathBuf,         // 归一化根（不复用 project_id 字段，见 §7.1）
    pub created_at: i64,
    pub closed_at: Option<i64>,
    pub state: TeamState,              // Active | Closing | Closed
}

pub struct TeamMember {
    pub id: String,                    // {name}@{team} —— 与团队内唯一，落库前 sanitize
    pub team_id: String,
    pub name: String,
    pub role: MemberRole,              // Lead | Worker
    pub agent_id: String,              // 复用 AgentConfig.id
    pub model: Option<String>,
    pub session_id: Option<String>,    // 预留：接 Chat 成员时才用（design §7.4）
    pub terminal_id: Option<String>,   // 本期唯一：关联的 PTY session（CLI 成员）
    pub workspace: Workspace,
    pub channel: WorkerChannel,        // 怎么给它**发**消息：Mcp | Pty | None
    pub result_channel: ResultChannel, // 它怎么**报**结果：Mcp | Sentinel | None（§5.7）
    pub tier: AdmissionTier,           // A | B | C —— 由 team_spawn 计算，调用方不可声明（§4.4）
    pub approval_policy: ApprovalPolicy, // Interactive | Queue | Bypass（R0b）
    pub mcp_injection: McpInjection,     // Argv | ConfigFile | None —— P0 实测得出（§5.5）
    pub last_seq: u64,                 // 上报单调性水位线（§7.2 seq 去重）
    pub state: MemberState,            // Spawned | Running | Awaiting | Idle | Done | Failed | Dead | Stalled
    pub token_hash: String,            // 只存 hash，不存明文
    pub joined_at: i64,
}

pub struct TeamTask {
    pub id: String,                    // t{seq}
    pub team_id: String,
    pub title: String,
    pub body: String,                  // 派活正文（可为较长 prompt）
    pub state: TeamTaskState,          // pending | claimed | in_progress | awaiting_approval | done | failed | blocked | proposed
    pub owner: Option<String>,         // member id
    pub workspace: Workspace,          // create 时确定，不可改（R1.5）
    pub depends_on: Vec<String>,       // 任务 id；依赖未 done 时不可 claim
    pub claimed_at: Option<i64>,
    pub lease_ttl: i64,                // 秒；默认 1800，可按任务覆盖
    pub summary: Option<String>,       // ≤4KB 硬上限（红线 4）
    pub artifacts: Vec<Artifact>,      // 路径 / commit / PR 引用，不是内容
    pub reclaim_count: u32,            // 被回收次数，用于 UI 标"反复失败"
}

pub enum Workspace {
    Shared,                                  // 团队根工作区
    Worktree { path: PathBuf },              // 独立 worktree + 分支
    ReadOnly,
}

/// 怎么给它发消息（能力声明，红线 14：声明即实现）
pub enum WorkerChannel { Mcp, Pty, None }

/// 它怎么回报结果 —— 与 channel 分开，因为二者可以不同
/// （典型：MCP 收消息，但结果仍靠 sentinel 打印）
pub enum ResultChannel { Mcp, Sentinel, None }

/// 准入档位 —— 由三项实测条件组合推出，不允许调用方自行声明
pub enum AdmissionTier {
    A,  // hook + MCP：完成/结果/卡住 全可见
    B,  // hook only：结果靠 sentinel 补
    C,  // sentinel only：结果可用，**卡住不可检测**
}

pub enum ApprovalPolicy { Interactive, Queue, Bypass }

/// MCP 配置怎么塞给这个 CLI —— 实测得出，落插件数据（红线 15）
pub enum McpInjection { Argv, ConfigFile, None }
```

### 2.1 状态机

**成员**
```
Spawned ──TurnStart──▶ Running
Running ──TurnEnd{Completed} / turn_completed──▶ Idle
Running ──RequestApproval / approval_requested──▶ Awaiting
Awaiting ──用户批准──▶ Running
Idle   ──task_update(done)──▶ Done            （verified）
Idle   ──下一轮 TurnEnd 仍无 done──▶ Idle + unverified 标记
Running ──TurnEnd{Error} / session_failed──▶ Failed
任意 ──进程退出 / SessionDone──▶ Dead
任意 ──lease 到期 / 静默超阈值──▶ Stalled
```

**任务**
```
pending ──claim──▶ claimed ──首轮 TurnStart──▶ in_progress
in_progress ──需要人──▶ awaiting_approval ──批准──▶ in_progress
in_progress ──task_update(done)──▶ done
in_progress ──task_update(failed)──▶ failed
in_progress ──owner 转 Dead/Stalled──▶ pending（lease 回收，reclaim_count += 1）
proposed ──队长 accept──▶ pending
```

**不变量（必须写成测试）**
1. `claimed` / `in_progress` 的任务**有且只有一个** owner
2. `done` 只能由 `owner` 触达，或由队长 `force_done`（记审计）
3. `depends_on` 全部 `done` 才允许 `claim`
4. `reclaim_count > 3` 的任务进 `blocked`，不再自动回收（防无限重试）
5. `Workspace` 在 `state != pending` 后不可变

### 2.2 完成取证（`DoneVerification`）的三条细则

> 这三条是实现 P1 时被测试逼出来的：`design` 原稿只写了「无 L2 时落 `Unverified`」，
> 没写「已有的 `Verified` 会不会被后来的信号抹掉」。含糊的地方就是 bug 的地方。

**① 取证按任务重置。** `claim_task` 把认领者的取证置回 `Unverified`。
否则「成员完成过 t1」会让 t2 在还没声明前就显示「已验证」——**「完成的唯一权威是任务板」被绕过**。

**② 取证只由「在飞任务」驱动。** `observe_signal` 在该成员**没有在飞任务**时（典型：任务已 `done`，
来的是迟到/重复的 `turn_completed`）**只推进成员态，不改写取证**。
否则 L1（回合结束）会撤回 L2（显式声明）的裁决 —— 方向恰好反了。

**③ `(成员态, 任务态, 取证)` 是一致三元组。** 任务仍在 `in_progress` 却带 `Verified` 属自相矛盾的
输入，`completion::advance` 把它降级为 `Unverified` 是**修复**而非丢失。所以 `advance` 保持纯：
它只看传入的三元组，不承担「已 done 的任务」的语义 —— 那是 ② 的职责。

**重启推导**与 ② 同判据：**有 `done` 任务且手上没有在飞任务** ⇒ `Verified`；否则 `Unverified`。
只看「曾经有 done 任务」会把「完成 t1 后领了 t2 还没声明」误判为已验证。

> 对应护栏：`tools/guards/ledger/invariants.json` 的
> `team-verification-is-per-task` / `team-idle-never-auto-upgrades-to-done` 等 7 条。

---

## 3. 身份与授权

### 3.1 现状与扩展

`server/gate.rs:AuthGate` 目前是**进程唯一 token**，恒定时间比较。

扩展为**多 token → 主体**：

```rust
pub struct TeamPrincipal {
    pub team_id: String,
    pub member_id: String,
    pub role: MemberRole,
    pub channel: WorkerChannel,
    pub tier: AdmissionTier,
}
```

- 队长 token 在 `team_create` 时签发，随 MCP 配置下发
- 成员 token 在 `team_spawn` 时签发，随该成员的 MCP 配置下发
- 落库只存 `token_hash`（`sha256`），明文只出现在下发的配置文件里一次
- **凭据落盘要复用 `hooks/ingest/endpoint.rs` 已有的收敛逻辑**（该文件注释已处理过"每个 `.env` 含一份 token，落在磁盘上的副本数 = N"的问题）——团队成员配置同样会写 N 份，必须收敛到同一个端点 + 同一个 token 校验点

### 3.1b 两套鉴权门（D+E，2026-10-30 拍板）

`server/gate.rs` 的门是**进程唯一 token**，且模块文档钉着一条不变量：
「进程内 `ct_eq` 调用点 = 1」。而 `auth_gate` 是**全局层**，同一 listener 上所有路由组共享它。

⇒ 若团队与 hooks 共用端口/门，成员 token 就能 `POST /hook/{source}`，
伪造成员的 `turn_completed` / `approval_requested` —— 与 §5.4 在防的串台是同一类事故。

**裁决**：

| 流量 | listener | 门 | 身份 |
| --- | --- | --- | --- |
| hooks（8 个 CLI 上报） | 既有 listener | `AuthGate::new(单 process token)`，**一字不改** | 不解析（fail-open，无身份） |
| team MCP（队长/成员） | **独立 loopback listener** | `AuthGate::with_tokens(成员 token 集合)` | handler 内 `sha256(token)` → `HashMap` 查表 → `TeamPrincipal` |

**为什么不需要第二次恒定时间比较**：身份表以 **hash 为 key**，攻击者无法控制 key 侧，
所以查表本身就足够；`gate.rs` 的 `ct_eq` 仍是唯一调用点。这条在
`identity.rs` 有源码级自检测试（`module_contains_no_constant_time_comparison`）钉着。

**代价**：多一个 loopback 端口；成员 env 从 2 个变 4 个
（`NEEKO_TEAM_ID` / `NEEKO_TEAM_MEMBER_ID` / `NEEKO_TEAM_PORT` / `NEEKO_TEAM_TOKEN`），
与既有 `NEEKO_AGENT_HOOK_PORT/TOKEN` 同族；坐标发布复用 `hooks/ingest/endpoint.rs` 那套
（它的注释已处理过"凭据副本数 = N"的收敛问题）。

### 3.2 授权矩阵

| 操作 | Lead | Worker |
| --- | --- | --- |
| `team_spawn` / `team_close` | ✅ | ❌ |
| `task_create` | ✅ | ❌ |
| `task_propose` | — | ✅（进 `proposed`，需队长 accept） |
| `task_claim` / `task_update(自有任务)` | ✅ | ✅ |
| `task_update(他人任务)` | ✅（记审计） | ❌ |
| `team_send(to=任意)` | ✅ | ✅（**仅队内**） |
| `team_wait` | ✅ | ✅（但通常只有队长用） |

**成员不能做的事**（对齐业界已验证的边界）：
- 不能批准权限（审批只到人）
- 不能把自己的拒绝转交同伴绕过（`team_send` 内容不得被解释为授权）
- 不能建新成员（禁止无限扇出）

### 3.3 为什么认证码比业界硬，以及代价

调研原话：「No real identity layer anywhere — names in a config file.」Claude Code 也是靠 `CLAUDE_CODE_AGENT_ID` env 这种**自证**身份。

我们能做到 token 级，是因为**Neeko spawn 了每个进程**，可以在下发的 MCP 配置里注入凭据。

代价：**凭据会在磁盘上出现 N 份**（每个成员配置一份）。缓解：token 短期有效（团队关闭即失效，落库只是 hash）、端点复用同一 port、泄漏面限于本机用户目录 —— 与 `.env` 现状同级，不新增攻击面。

---

## 4. MCP 工具面

### 4.1 为什么是 MCP，而不是别的

Neeko **不拥有 LLM**——无法像 Claude Code 那样把 `TeamCreate`/`SendMessage` 编进自家工具集。要让**任意**被托管的 CLI 获得团队能力，只有一条不改各 CLI 的路：**给 CLI 装工具面**。

MCP 是唯一同时满足「各 CLI 普遍支持」+「Neeko 已有下发设施（`DeploySpec.mcp_config` + `deploy_mcp`）」的插槽。

### 4.2 工具清单（单一源：`mcp/schema.rs`）

| 工具 | 主体 | 入参要点 | 语义 |
| --- | --- | --- | --- |
| `team_status` | 全员 | `verbose?` | 成员状态 + 板摘要（恒定小载荷） |
| `team_spawn` | Lead | `agent_id, name, prompt, workspace, model?, channel?` | 建成员；返回 member_id |
| `team_send` | 全员 | `to, message, summary?, wait?: {until, timeout_ms}` | 队内消息；`to` 只接受队内 id。带 `wait` 时**原子提交并等待**；目标 `Awaiting` 时返回 `target_blocked` 且**不写字节** |
| `team_wait` | 全员 | `on: [member_id] \| task_ids, until: declared\|idle\|any, timeout_s` | **后端阻塞**，**按 `member_id` 钉住**（新成员不满足旧 waiter），返回摘要 |
| `task_create` | Lead | `title, body, workspace, depends_on?, lease_ttl?` | 派活 |
| `task_claim` | Worker | `task_id` | 原子认领 + 起租约 |
| `task_update` | Owner | `task_id, state, summary?, artifacts?` | 进度/完成/失败 |
| `task_list` | 全员 | `state?` | 板视图 |
| `team_close` | Lead | `member_id?, graceful?` | 协商式关机（`graceful=false` 才 kill） |

### 4.3 `team_wait` 的实现要求（本设计的核心）

```rust
// 语义：注册等待 → 阻塞在 Notify/oneshot 上 → 条件满足或超时返回
pub async fn wait(
    &self, team_id: &str, targets: WaitTargets, until: WaitUntil, timeout: Duration,
) -> Result<WaitOutcome, AppError>;
```

- 条件满足的判定**在 manager 内做**（它持有所有状态迁移），不是调用方轮询
- 超时**不报错**，返回 `WaitOutcome::Timeout { snapshot }` —— 队长需要知道现状才能决策
- 返回值是**摘要**（每成员一行 + 任务状态），不是 transcript
- **钉住被等对象**：等待绑定 `(team_id, member_id)` 而非"当前占用该 pane 的谁"。任务被租约回收并由新成员接手后，**旧 waiter 不得被满足**（否则队长会收到别人的结果并以为原成员完成了）
- **wait 可与 send 合并**：`team_send(..., wait)` 一次往返完成"提交 + 等"，避免两次调用之间的竞态；目标 `Awaiting` 时直接 `target_blocked`，不写字节

**为什么必须后端阻塞**：Claude Code 的官方已知缺陷是「队长自己动手干活而不是等队友」，而它的修法是改提示词。提示词级等待必然退化成"边干边看"。把等待做成服务端阻塞原语，队长就没有退化的空间。

### 4.4 准入三档（不再二分）

三种信号源可以独立缺失，组合出三档。档位由 `team_spawn` 依据 P0 实测矩阵计算，**调用方不可自行声明**。

| 档 | 条件 | 完成 | 结果 | 卡住 | 后果 |
| --- | --- | --- | --- | --- | --- |
| **A** | hook + MCP | ✅ | ✅ | ✅ | 完整成员 |
| **B** | hook only | ✅ | sentinel 补 | ✅ | 结果多一跳，但可信度不降 |
| **C** | sentinel only | ✅ | ✅ | ❌ | **卡住永远不可知** ⇒ UI 必须写"可能等待输入"，禁止写"正在工作" |

**通道三分（两个维度，别合并）**：

- `channel`（怎么**发**）：`Mcp` 结构化可靠 / `Pty` 只能写 stdin（best effort）/ `None` 只能一次性派活
- `result_channel`（怎么**报**）：`Mcp` 工具调用 / `Sentinel` 打印到 stdout / `None`

典型组合：A 档 `channel=Mcp, result_channel=Mcp`；B 档 `channel=Mcp, result_channel=Sentinel`；C 档 `channel=None, result_channel=Sentinel`。

**声明即实现（红线 14）**：`team_spawn` 时若声明与实际能力不符必须拒绝 —— 不允许"声明了但发不进去 / 报不上来"。

`Pty` 通道的写入协议（实测要求，见 `research/04`）：`write_literal(text)` → **间隔约 150ms** → `write(CR)`。
一次写 `"text\n"` 在部分 AI TUI 上会被丢弃或误解释回车。

## 5. 执行：CLI 成员（本期唯一路径）

### 5.1 成员 = 一个 PTY 会话 + 两样注入

```
terminal::manager::create_session(cwd = workspace 路径)
   ├─ env:  NEEKO_TEAM_ID / NEEKO_TEAM_MEMBER_ID（身份）
   │        NEEKO_SESSION_ID / NEEKO_PROJECT_ID（既有归因，保留）
   └─ MCP:  把 neeko-team 条目写进该 CLI 的 MCP 配置（resource_deployer::deploy_mcp）
```

**不需要新抽象**：`create_session(cwd, cols, rows, shell_override, command, app_handle)` 已经直接收 `cwd`，
所以 `Workspace::Worktree{path}` 就是"传这个路径"，`Workspace::Shared` 就是"传团队根"。
这消掉了原方案里为 chat 侧准备的 `WorkspaceRef` 穿透与 `project_id` 改名 —— **那是 chat 域的债，不是我们的**。

### 5.2 状态来源：`hooks/ingest` 是唯一观察点

```
POST /hook/{source}
   └─ ingest::dispatch → validation → event::HookEvent
        └─ attribution::attribute
             ├─ notify::project → NotificationCenter      （既有第二路）
             └─ team::observe(HookEvent)                 ← 新增第三路
```

与 `notify` 并列加一个消费者即可，**不需要新 trait，也不需要碰 chat 的 emit 闭包**。

`team::observe` 只做三件事：把 `event_key` 映射成成员状态迁移 → 触发租约/唤醒 waiter → 记一条 `team_event` 审计。

### 5.3 结果取证（L1b）：回读会话文件，不解析屏幕

`turn_completed` 到达后：
1. 用 `HookEvent.agent_session_id` + agent id 定位 `conversation` 域的会话
2. 取最后一轮 assistant 消息（`ConversationMessage`，已归一化 + 已分页）
3. 落成员详情（**不入板**）

**为什么回读而不是 scrape PTY**：`conversation/adapters/` 已有 10 个 adapter，输出 `ConversationMessage{role, content, blocks}`，字节预算分页现成。屏幕解析既脆弱又不可控载荷。

### 5.4 同 cwd 归因保护（本期最容易出错的一处）

`attribution.rs` 三级归因：`NEEKO_SESSION_ID` → cwd 最长前缀 → basename。

共享工作区下**多个成员 cwd 完全相同**。若某 CLI 的 hook 未带 env（旧版本、配置被覆盖），第 2/3 级会把 A 的 `turn_completed` 判给 B —— 这不是"偶尔不准"，而是**串台**：队长拿到别人的结果并认为它完成了。

**裁决**：团队上下文中 `NEEKO_TEAM_MEMBER_ID` 未命中 → **拒绝归因**（丢弃 + 记 `unattributed` 审计），**不回退 cwd 前缀**。

理由：丢一条通知是可见的小损失；记错账是不可见的大损失。

### 5.5 MCP 接入：启动参数注入 + HTTP 传输（bridge 为兜底）

**P0 实测推翻了原先"必须写配置文件 + 需要 stdio bridge"的假设**（详见 `research/admission-matrix.md`）。

实测结论：

| CLI | MCP 注入方式 | 传输 |
| --- | --- | --- |
| claude | **`--mcp-config <file\|string>`** | HTTP（`-H header`）+ stdio |
| codebuddy | **`--mcp-config <fileOrString>`** | 由 JSON 决定 |
| qoder | **`--mcp-config`** + `--strict-mcp-config` | 由 JSON 决定 |
| codex | `codex mcp add` → `config.toml [mcp_servers]`；或 `-c key=value` | streamable HTTP + **`--bearer-token-env-var`** |
| opencode | `opencode mcp add --url/--header` | HTTP + header |
| pi | `pi mcp add --url` → `~/.pi/agent/mcp.json` | URL + stdio |
| grok | `grok mcp add --transport http\|stdio\|sse` | http / sse / stdio |
| **omp** | **无 MCP 表面** | — |

实现要点：

1. **注入优先传参**：`mcp_injection = Argv` 时，把 MCP 配置作为**启动参数**传给成员（每家一个模板，落插件数据，红线 15）。
   `ConfigFile` 只在 `Argv` 不支持时使用。**禁止**继续只依赖 `DeploySpec.mcp_config`
   —— 实测它对 claude 指向 `~/.claude/settings.json`（那里只有 hooks），MCP 实际在
   `~/.claude.json → projects[].mcpServers`，**这条路从来没生效过**。
2. **传输优先 HTTP**：Necko 的 axum 服务端直接当 MCP endpoint；token 走 header
   （codex 走 `--bearer-token-env-var`，正好匹配"spawn 时注入 env"）。
3. **stdio bridge 降级为兜底**：`neeko-team-mcp.mjs` 仍要（照 `neeko-report.mjs` 的 `include_str!` 模式），
   但只在某 CLI 既不支持 HTTP 也不支持参数注入时才启用 —— 不再是主路径。
4. 路由组仍用 `FailurePolicy::FailClosed`（交互式客户端，必须收到真实错误）。

> ⚠️ **顺带发现的既有缺陷（应单独立 issue）**：`DeploySpec.mcp_config` 对 claude 的路径是错的，
> 影响的不只是团队功能，还有现有 MCP 市场（`features/library` 的安装链路）。

### 5.6 延期：Chat 成员（不在本期）

原设计里 Chat 成员需要：`AgentChatManager::await_turn`、在 `spawn_session_pipeline` 上挂观察者、单事件频道的载荷策略、4 条传输 × 能力的矩阵、opencode serve 单例处理。

**这五条在本期一条都不需要**（见 `prd.md` 阻塞项表）。延期时唯一要保留的接口是 `team::observe` 的输入形状 —— 它接受一个"信号"而不是 `HookEvent`，以便将来接 `StreamEvent`：

```rust
pub enum MemberSignal { TurnCompleted, ApprovalRequested, InputRequested, Failed, Exited }
```

CLI 侧由 `HookEvent.event` 映射来；将来 Chat 侧由 `StreamEvent` 映射来。**这是本期唯一为 Chat 预留的东西**（以免将来把观察点重写）。

### 5.7 sentinel 通道（第三条信号源）

成员把结果打印到**自己的 stdout**，Neeko 从 PTY 字节流里扫这一行：

```
NEEKO_RESULT <nonce> {"executionId":"…","task_id":"…","status":"completed|failed|blocked","summary":"…"}
```

它同时提供 **L1（完成）+ L2（结果载荷）**，是对**无 hook / 无 MCP** agent 的唯一可行路径（C 档）。

**接入点**：`terminal/pump.rs` 的 sink 加**第二个消费者**（Rust 侧在 emit 之前就有原始字节，不需要任何新依赖）。

**实现约束（前三条来自踩过的坑，第四条是红线）**：

1. **流式有界**：carry buffer ≤ 8KB，只在 `\n` 处切行，超界丢最旧。绝不无界累积 —— 该 pump 的历史事故是 WebContent 8 分钟膨胀到 5.2GB（红线 4 的由来）
2. **剥 ANSI 再匹配**：颜色码会插在 JSON 中间；复用 `conversation/text.rs` 的正则原语
3. **解析失败静默丢弃**：回显的模板会天天出现，不能报"结果损坏"
4. **单行 ≤ 2KB**：载荷要小；`summary` 超出即截断并记 `truncated`

**接受条件（四条全满足，缺一即丢弃 + 记 audit）**：

```
① 前缀 + nonce 精确匹配（nonce 绑定 team/member/task/attempt，注入任务体）
② JSON 可解析，status ∈ {completed, failed, blocked}
③ task_id 存在，且 owner == 本 member，state ∈ {in_progress, awaiting_approval}
④ executionId 未消费过（幂等）
```

**第 ③ 条是核心**：回显出来的模板里 `task_id` 通常是占位符或旧值，会被权威状态校验直接杀掉。
校验放在 `TeamManager`（它本来就持有权威状态），成本几乎为零。

**nonce 的能力边界**：它挡**意外回显**，挡不住模型故意伪造 —— 但后者在任何通道都挡不住
（MCP 同样只是 agent 自述）。真正可信的边界只有一条：**人**（审批门 + 可区分 verified/unverified）。

**协议 preamble 不放任务体**：把 sentinel 格式与 `task_*` 用法部署成一份 `neeko-team` skill
（复用 `resource_deployer` 的 skills 部署），任务体里只留 **nonce + task_id + 具体需求**。
理由：任务体会被打进 pane ⇒ 整段回显进字节流，抬高误匹配风险，也顶大 prompt。

## 6. 完成判定（单一状态机）

> 下表保留 Chat 列是为了**将来接 Chat 成员时不用重推**；本期只实现 CLI 列。
> 判据层次与迁移规则对两条路径完全相同 —— 这正是把 `MemberSignal` 抽成枚举的目的（§5.6）。

| 判据层 | Chat 路径 | CLI 路径 | 可信度 | 落点 |
| --- | --- | --- | --- | --- |
| **L1 机器信号** | `TurnEnd{Completed}` | hook `turn_completed` | 高 | `MemberState::Idle` |
| **L1b 内容取证** | （延期）事件流本身即内容 | `conversation` 回读会话文件 | 中 | 成员详情（**不入板**） |
| **L2 显式声明** | `task_update(state=done)` | `task_update` **或** sentinel `status=completed` | **最高** | `TeamTaskState::done` + `Done{verified}` |
| **L3 超时兜底** | 静默超阈值 | 静默超阈值（无 `input_requested` 可用） | 低 | `Stalled` |
| **L4 进程死亡** | `SessionDone` / 进程退出 | `process_reaper` 回收 | 高 | `Dead` → lease 回收 |

**三条硬规则（写成测试）**

1. `Idle` **永不**自动升级为 `Done` —— 否则"它说完了"会被当成"它做完了"
2. 无 L2 时落 `Done{unverified}`，团队面板必须可区分（徽标 + tooltip）
3. `Done` 的唯一权威是任务板 `state == done`，**不是** `member.state`

### 6.1 「待批准」落在团队域，不动 chat 域

**裁决变更（CLI-only）**：原方案打算复活 `chat/session_store.rs:SessionStatus::AwaitingApproval`，但那是 **chat 域**的枚举，本期不碰 chat。CLI 成员的「待批准」落在团队域 `MemberState::Awaiting` + 任务 `awaiting_approval`，持久化在团队表里。

`Awaiting` 是审批门的家：
- `RequestApproval` / `approval_requested` → `update_status(AwaitingApproval)` + `MemberState::Awaiting` + 任务 `awaiting_approval`
- 用户批准 → 回 `Running`
- **不冒泡进队长对话**（Claude Code 的做法，官方承认是摩擦），进**待批队列**

---

## 7. 与既有模块的改造点

CLI-only 之后本节从 5 条缩到 3 条 —— 原本最重的两条（chat 的 `project_id` 改名、`await_turn` 新通道）**都不需要了**。

### 7.1 团队域与 PTY 会话的关联（唯一的结构性新增）

`TeamMember` 已有 `terminal_id`。**不改 `terminal` 域的任何数据结构** —— 不给 `SessionHandle` 加字段、不改 `TerminalSession` 形状。

关联是单向的：团队域持有 `terminal_id`，terminal 域对此一无所知。关闭顺序由 `TeamManager` 编排：先 close PTY，再归档成员 —— 这样团队域不会因为 terminal 的清理顺序而拿到悬空 id。

### 7.2 hooks 归因增加两个 env 字段

`hooks/ingest/attribution.rs:EnvHints` 增加 `team_id` / `team_member_id`（缺省 `None` = 非团队成员，行为与现在完全一致）。

**向后兼容要求**：`EnvHints` 全部字段 `#[serde(default)]`；`neeko-report.mjs` 的契约不变（argv `<source> <event_key>`、stdin 为 CLI 原始 JSON、**永远 exit 0**）。团队 env 由 shim 从进程环境读出后带入出站请求，**不改 argv 形状**。

### 7.3 载荷与事件

- **红线 4**：`TeamTask.summary` 硬上限 4KB（`store` 层截断 + 记 `truncated`）；成员 transcript **永不进团队事件**；点开成员时走 `conversation` 分页（已有 ≤1.5MB/页）
- **红线 5**：新增 `agent/team/events.rs:TEAM_EVENT`（`"agent-team://event"`），TS 侧同步 `src/shared/events.ts`
- **顺带补护栏**：现有 TS 镜像无任何自动校验（`check_terminal_foreground_arbitration.py` 明确排除后端事件名）。本任务加一个从 Rust 常量扫 `"agent-team://*"` 与 TS 表比对的检查

### 7.4 延期项（随 Chat 成员一起，已记账）

| 项 | 原设计位置 | 为什么可以安全延期 |
| --- | --- | --- |
| `AgentContext.project_id` → `project_path` 改名 | 原前置门 0.1 | 只影响 chat 域；PTY 侧用 `cwd` |
| `AgentChatManager::await_turn` | 原 §7.3 | `team_wait` 在 MCP 工具调用内阻塞，无需新通道 |
| `WorkspaceRef` 贯穿 `AgentContext` | 原 §7.1 | PTY 的 workspace 就是 `cwd` |
| 复活 `SessionStatus::AwaitingApproval` | 原 §6.1 | 改落团队域 |
| opencode serve 多实例 / 每队限 1 个 | 原 §5.4 | 只影响 chat 传输 |

**这五条不是"砍掉"，是"延后且已记账"** —— 做 Chat 成员时它们是同一批工作，不会重复设计。

## 8. 已否决的方案（含判断依据与复活条件）

> 这一节存在的原因是：三个月后一定有人再问一遍。每条都写"什么时候它会变成正确答案"。

### 8.1 ❌ 依赖 `rmux` 做创建与通信

`rmux` 0.10.0（本地 daemon + tmux 兼容 CLI + Rust/Python/TS SDK）。

| 判据 | 结论 |
| --- | --- |
| 通信 | **不合格**。它给字节流 + 屏幕快照，没有消息身份 / 已读 / 结构化协议 / 回合边界。Claude Code 即使把成员画在独立 pane 里，**底下仍另有一套邮箱** —— pane 是显示，不是协议 |
| 创建 | **收益为负**。Neeko 已拥有 PTY（`terminal/manager.rs` 直用 `portable_pty`，`router.rs:SessionOwner` 统一 Local/WSL/SSH）。引入 = 要么换掉整个 terminal 域，要么两套 PTY 所有权 |
| 场景错配 | Claude Code 需要 pane backend 是因为**它是 CLI，必须在终端里画多个 agent**；Neeko 本身就是终端，worker 面板是 React 布局问题 |
| 工程风险 | 0.10.0、5 个月、SDK 1.9 万下载，作为终端域地基不划算 |

**复活条件**（三个都要独立评估，都不属本任务）：① 要做 daemon 化；② 要做跨机器共享终端；③ 要原生 Windows 替代 WSL 路径。

> **daemon 化收益的正确表述（2026-10-30 修正）**：不是"关掉 App 后 agent 继续跑"，而是
> **「一组进程拥有统一的生命周期边界」**。
> `rmux -S <socket> ...` + `kill-server` 的真正价值是：整组建、整组销。
> 对 Neeko 这更实用 —— 团队关闭时要同时收拾 N 个 PTY + N 个 worktree + N 份凭据，
> 今天只能逐个收。`herdr` 的 46.7k★ 说明该能力是招牌级需求，但归属 **terminal 域**。

**值得偷而不引入依赖的三点**：daemon 思路 → `team_wait` 后端阻塞；pane 即寻址 → 我们用 `member_id + token`（更强）；`PATH` shim → 我们不需要，直接控 argv/env。

### 8.2 ❌ 文件邮箱（照搬 Claude Code）

我们**有中间人**。文件方案会造出两个真相源，且并发安全要靠 lockfile 读-改-写+重试退避（在 Rust 后端是纯负担）。见 §1.2 对照表。

### 8.3 ❌ A2A 作为协调协议

A2A 解决的是**跨厂商、跨组织、已经在运行的远端 agent**（Agent Card 发现 + HTTP + Task/Message/Artifact）。我们 spawn 的子进程就在本机，身份、发现、认证都是已知的 —— A2A 在这里是纯开销。

**复活条件**：要做"调用别人的远端 agent" → 那时 A2A 是 **ingress 适配器**，一个工具，不是基质。

### 8.4 ❌ ACP 作为协调协议

ACP 解决的是**编辑器↔agent 的集成税**（stdio JSON-RPC、多并发 session、反向请求做 permission/fs/terminal）。它是一个**会话**协议，**不暴露 team 语义**：没有任务板、没有成员、没有认领、没有审批路由。

我们的 Chat 路径**已经在用 ACP** —— 这是正确的用法（拿 session 和 permission），团队语义另建在上层。

### 8.5 ❌ swarm / selector-group-chat 范式

- **swarm（LangGraph swarm）**：控制隐式流动，"谁活着"是内部状态 ⇒ GUI 无法表达
- **selector group chat（AutoGen）**：广播 + LLM 选下一个发言者，无天然审批点，轮次无界

**采用**：supervisor + claim 式任务板。理由：每次控制转移都是**一次工具调用** ⇒ 是事件、可渲染、可 gate、可审计。

### 8.6 ⏸ 声明式 DAG 编排（本期 non-goal，保留）

"用户写 DAG，Neeko 依次 spawn 并传递产物" —— 无需 LLM、确定性最强，是**不支持 MCP 的 agent** 的合理兜底。

**本期不做的理由**：它把"分解"变成人写配置，与 Agent Team 的核心价值（模型自己拆活）相反。但它作为 P4 兜底形态有明确位置，接口预留（`task_create` 已能表达 DAG 的边）。

---

## 9. 分期

| 期 | 内容 | 可独立验收 |
| --- | --- | --- |
| **P0 准入实测** | 逐个 CLI 实测 hooks 事件面 × MCP 配置面 × MCP 传输，产出 `research/admission-matrix.md` | R0 |
| **P1 协调基质** | `agent/team/`（types/store/lease/completion/manager）+ `hooks/ingest` 观察者（含 `seq` 单调）+ env 注入 + 归因保护 + **sentinel 扫描器（纯函数）** | AC2 / AC3 / AC7 / AC12 / AC13 |
| **P2 工具面** | MCP 路由组 + stdio bridge + 身份 token + 全部工具；`team_wait` 后端阻塞（钉住 + 原子 send）；`Pty` 分两次写；sentinel nonce 注入 | AC1 / AC4 / AC7b / AC14 / AC15 |
| **P3 可观测** | 团队面板（CLI 成员花名册 + 任务板 + 队长 PTY）+ 待批队列 + **`neeko-team` skill 部署** + 团队事件常量 + TS 护栏 | AC5 / AC9 / AC11 |
| **P4 隔离与并行** | worktree 作为成员 cwd + 协商式清理 + 并行不覆盖 | AC6 |
| **P5（延期）** | Chat 成员：`await_turn`、chat 观察者、`WorkspaceRef`、`SessionStatus` 复活、opencode 多实例 | —— |

P0 必须**真的跑完**再进 P1：准入矩阵没实测就动手，等于把"哪些 CLI 能用"建立在 `mcp_config` 字段存在这个事实上 —— 而那只是个路径模板。

## 10. 风险与回滚

| 风险 | 缓解 | 回滚点 |
| --- | --- | --- |
| MCP 客户端只支持 stdio | 提供 `neeko-team-mcp.mjs` bridge，与 hook shim 同一模式 | 只发 HTTP 版，收窄准入面 |
| 成员 transcript 进事件通道放大负载 | 板上只放摘要（≤4KB）；全文走 conversation 分页按需 | 关掉成员详情入口即可 |
| 归因串台（同 cwd 多成员） | `team_spawn` 强制注入 member env；env 缺失时拒绝归因 | 关闭归因拒绝即回退到可能串台的旧行为 |
| token 落盘 N 份 | 复用 `endpoint.rs` 收敛逻辑；团队关闭即失效 | 改为"团队域内共享一个 token + member_id 走 header" |
| 长尾：CLI `input_requested` 缺口 | UI 文案不写"正在工作"，写"可能等待输入" | —— |
