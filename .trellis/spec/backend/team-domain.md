# Agent Team 域（多 Agent 编排）

> 域目录：`src-tauri/src/agent/team/` · 任务板/队长的设计全文：`.trellis/tasks/10-30-multi-agent-orchestration/`
> 本文只记录**契约与判据**（改这一域之前必须知道的那些「不然会静默坏掉」的事）。

团队域是 Neeko 的**协调基质**：一个 CLI 会话被提升为队长，多个 CLI 成员认领任务板上的活。
Neeko 不做 LLM，只做「板 + 身份 + 可观测」。

## 文件布局与职责

| 文件 | 职责 | 改它的理由 |
| --- | --- | --- |
| `types.rs` | 数据模型 + serde 口径（camelCase / snake_case 两套） | 加字段 / 改 wire 名 |
| `store.rs` | SQLite 持久化（v14 建表、迁移、分页） | 表结构 / 查询 |
| `manager.rs` | **唯一写入口**（内存镜像 + 库在同一把锁内一起改） | 新状态迁移 |
| `completion.rs` / `lease.rs` | 完成判定 / 租约（纯函数） | 状态机规则 |
| `reaper.rs` | **时间驱动**的租约回收（周期性循环 + `stop`）；将来 L3 的 `Stalled` 也长在这里 | 到期判据 / 节拍 |
| `wait.rs` | `team_wait` 的阻塞等待（只读内存快照） | 等待语义 |
| `identity/` | `env`（注入）/ `token`（签发与解析）/ `verdict`（归因）/ **`preamble`（角色上下文）** | 四者无共同变化理由，故分文件 |
| `options.rs` | **只读可选项面的唯一推导**：池子 / 上限 / 三个缺省值（面板、`team_options`、preamble 三个消费者） | 团队组成的读法变了 |
| `admission.rs` | **红线 15 落点**：per-CLI 准入事实表 + 纯函数推导 | P0 实测结果变了 |
| `mcp/schema.rs` | 工具清单（`TOOLS`）与入参 Schema | 新增工具 |
| `mcp/dispatch.rs` | 工具调用：翻译 → 授权 → 入参校验 → 委派 | 工具语义 |
| `mcp/protocol.rs` | 线协议常量（`TOKEN_HEADER` / `ENDPOINT_PATH`）：端点读的与客户端写的同一份 | wire 契约 |
| `mcp/server.rs` | MCP over HTTP（JSON-RPC + header token → 主体） | 协议层 |
| `mcp/principals.rs` | 身份表：`token hash → TeamPrincipal`（从**库**组装） | 凭证模型 |
| `execution.rs` | 执行层：启动计划（纯函数）+ 端口（`MemberExecutor` / `CredentialLedger`）+ 回复副作用映射 | 执行语义（见 §2.2） |
| `delivery.rs` | 投递：通道路由 + 两笔写入协议（纯函数） | 投递协议 |
| `boot.rs` | 域级 boot 入口：独立 loopback listener + 活集合门 | 端点坐标 |
| `authorize.rs` | 授权矩阵（工具数 × 角色数，**当前 11 × 2 = 22 格**；格数由 `ALL_TOOL_NAMES` 自算，见 `matrix_is_enforced_cell_by_cell`） | 加减工具 |
| `observe.rs` / `deliver.rs` | hook 事件的团队投影 / 投递入口（见 §6） | 新信号 |
| `events.rs` | 前端事件：`TEAM_EVENT` 常量 + 失效脉冲载荷 + `TeamNotifier` 端口（见 §8） | 改事件名 / 载荷 |
| `view.rs` | **视图构造的唯一落点**：`TeamStatusView`（MCP 读者）/ `TeamSnapshot` / `TaskCard` / `TaskDetail`（前端读者） | 加读字段 / 改列载荷（见 §8） |
| `commands.rs` | 本地 Tauri 入口（九条：建队开场 / 快照 / 任务详情 / 可启动清单 / 团队配置面 / 团队清单 / 关闭 / **删除**），保持极薄（红线 6） | 新入口命令 |
| `fixtures.rs` | `#[cfg(test)]` 夹具单一源（`Team` / `TeamMember` 全字段）；`store.rs` 的 round-trip 夹具是**刻意例外**（每列都要偏离默认值，否则"某列没写进库"会变绿） | 加字段时只改一处 |

## 0. 租约 = **活性**信号，不是时长上限

`claimed_at + lease_ttl` 单用会被读成「任务最多跑 30 分钟」，而它想表达的是「这个成员还在干」。
两条判据缺一不可，否则回收器一上线就去抢健康成员手里的活：

1. **回收有人在跑**：`reaper::TeamReaper`（组合根 `app::boot` 起，30s 一拍，关闭协议 `team-reaper` 停）。
   纯函数 `lease_expired` + `reclaim_expired` 早在 P1 就有了，但**没有生产调用方** —— 那等于
   「死锁防护只在纸上」。惰性 sweep（读写前扫一遍）不够：AC3 的场景正是**队长阻塞在 `team_wait`
   里、没有任何人在调命令**。
2. **活性即续期**（`manager::renew_lease`）：owner 的 `task_update` 与**活性信号**续期；
   `MemberSignal::is_liveness()` 说了算（`turn_completed` / `approval_requested` / `input_requested`
   是，`failed` / `exited` 不是 —— 拿死亡信号续期会让「已经死了」再拖满一个 ttl）。

判据：`expired_leases_are_reclaimed_without_any_caller`（AC3 的机器形式）、
`an_owner_update_renews_the_lease`、`a_death_signal_does_not_renew_the_lease`、
`stopping_the_reaper_stops_the_loop`。四个都已变异验证（删循环体 / 删续期 / 改 stop 为 detach 各变红）。

## 1. 真相源：库是真相、内存镜像是缓存 ⇒ 启动必须 `load`

`TeamManager` 同时持有内存镜像（`HashMap`）与 SQLite。**唯一允许的真相源是库**；
内存镜像只是缓存，所以它的初始化（hydrate）是启动的硬步骤。

- 生产构造必须走 `TeamManager::load(store)`，**不是** `TeamManager::new(store)`。
  `new` 给的是空镜像：第二次启动起 `team()` / `member()` 恒 `None`，而 `add_member` 的
  团队存在性判据读的正是空镜像 —— 于是它对一个库里真实存在的团队报 `NotFound`。
- 机器判据：`app_state::tests::a_restart_hydrates_the_team_domain_from_the_database`
  （同一个库文件、两次 `AppStateWrapper`：读得到 + 写得进）。
- 池的借用同样有前置条件：`TeamStore::with_pool` 是 `const fn`，**不起池也不跑迁移**。
  组合根只借 `library_store` 那个已经跑过迁移链（含 v14 建表）的池，换池 = 每条查询
  `no such table: team`。判据：`team_manager_shares_the_library_pool`。

## 2. 两相位：`dispatch` 决定、执行层动手

所有会产生**进程副作用**的工具都返回「意图」而不是「已生效」：

| 工具 | 决策层返回（线协议） | 领域副作用（`execution::Effect`） | 执行层动作 |
| --- | --- | --- | --- |
| `team_spawn` | `ToolReply::MemberCreated`（成员已落库） | `StartMember { member_id }` | 签发凭证 → 起 PTY → 注入 env |
| `team_send` | `ToolReply::NeedsDelivery { to, text }` | `Deliver { to, text }` | 经 `Pty` 通道投递字节 |
| `team_close` | `ToolReply::Closed`（已校验的关闭目标） | `Close(ClosePlan)` | 关 PTY → 归档成员 → 作废凭证 |

**理由**：PTY 起不来时成员必须是「已落库、可查询、可清理」的，而不是半生不死的进程；
决策层因此保持纯逻辑 + 可单测（不需要 `AppHandle`）。

**线协议词汇只活在 MCP 入口**：`ToolReply` 是 wire 词汇（变体名 = wire 名、整段进模型上下文），
所以「回复 → 副作用」与「结果 → 回复」各只有一份实现，都在 `mcp::dispatch`
（`effect_for` / `reply_for`）。执行层只认识 `Effect` / `EffectOutcome`：

```text
ToolReply ──effect_for──▶ Option<Effect> ──apply_effect──▶ EffectOutcome ──reply_for──▶ ToolReply
```

- **「没有副作用」只有一种表示法**：`effect_for` 返回 `None`（没有 `Effect::Nothing`）。
- **一一对应由编译器兜住**：`effect_for` 的 `match` 没有 `_` ⇒ 新增 `ToolReply` 变体直接编译
  不过，直到你回答「它要不要副作用」。运行期判据：
  `dispatch::tests::every_tool_reply_variant_is_translated`。
- **本地入口不认识它**：`commands::team_close` 走 `apply_effect(Effect::Close(plan))`，源码级判据
  `commands::tests::the_local_entry_does_not_depend_on_the_mcp_vocabulary`（本文件不得出现 MCP
  的模块路径与工具回复类型名）。

### 执行参数不随工具返回走（红线 14 的**输出侧**）

`team_spawn` 的回复只有三件事：`member_id` / `tier` / `unverified`。env、MCP 注入方式、
传输、旁路参数**一律不出现**在回复里 —— 它们全部能从已落库的成员行重新推导：

| 执行层需要 | 推导式 |
| --- | --- |
| env | `identity::member_env(team_id, member_id)` |
| 注入方式 / 传输 | `admission_for(member.agent_id)` |
| 旁路参数 | 上一行 `.bypass_args(member.approval_policy)` |
| token 明文 | `TeamManager::issue_token(member_id, now)` |
| 工作目录 | `member.workspace` |

两个理由：① 把推导结果再传一遍就是给同一件事实造第二个源（成员行改过之后副本就是错的）；
② 回复会进模型上下文，**多一个接收方无法行动的字段就是在邀请模型去重放它**——这与入参侧
「Schema 里多一个 dispatch 不读的参数」是同一条规则。机器判据：
`dispatch::tests::member_row_carries_everything_the_executor_needs`（把四个推导入口各走一遍；
哪天有人从 `TeamMember` 上删字段，这里先红，而不是 2.5b 运行时才发现推不出来）。

## 2.1 模型给的字符串在入口就 sanitize

`team_spawn` 的三个入参最终会**离开 JSON 世界**（进入不能再转义的地方），所以判据在入口，
且是「拒绝」不是「清洗」：

| 字段 | 落点 | 判据 | 漏判的后果 |
| --- | --- | --- | --- |
| `name` | env（`NEEKO_TEAM_MEMBER_ID`）、`{name}@{team}` 解析、日志/sentinel 行 | 非空（`required_str`）· 无 `@` · 无控制字符 · ≤ 64 字符 | `\0` ⇒ 2.5b 的 `Command::env` **panic**；`@` ⇒ 身份可伪造；超长 ⇒ 花名册与每次 `tools/call` 载荷被撑大 |
| `model` | argv（`--model <value>`） | 非空 · 无控制字符 | NUL ⇒ `Command::arg` panic；换行 ⇒ 把后面内容变成另一条参数 |
| `workspace.path` | 文件系统（`git worktree` / PTY cwd） | 非空 · **绝对** · 无控制字符 | 相对路径按进程 cwd 解析；NUL 无法表示 |

控制字符判据只有**一个实现**（`dispatch::reject_control_chars`）—— 三个字段各写一份，
未来加第四个注入点必然漏一处，而漏掉只在 spawn 时爆。

## 2.2 执行层：纯计划 + 端口 + 回复副作用（`execution.rs`）

决策层只落库；执行层要的三件套由 **`execution::plan_member_spawn`** 算出来。执行者本身是
**端口**，组合根提供唯一 impl；两者之间只隔 `apply_effect` 一行。

| 组成 | 是什么 | 为什么在这一层 |
| --- | --- | --- |
| `plan_member_spawn` | 纯函数：成员行 → `cwd` / `env` / `args` | 全部输入可从库重建，可直测 |
| `MemberExecutor::{spawn, deliver}` | 端口：起进程 / 投递字节 | 端点不该认识 PTY / 项目库 |
| `CredentialLedger::admit` | 端口：签发明文 + **同一动作内**让门接受它 | 拆开就留一个「库里有新凭证、门还不认识」的窗口 |
| `Effect` / `apply_effect` | 领域副作用 → 动手的**唯一**映射 | 写在 handler 里会漂移，且只能靠发真 HTTP 才能测 |
| `ClosePlan` / `CloseOutcome` | 关闭的**意图**（关谁）与**事实**（关掉了谁、停在哪个状态） | 合成一个类型就会出现「同一字段两个时刻的含义」 |

**`SpawnPlan { cwd, env, args }`** —— 输入全部来自已落库的成员行：

| 字段 | 推导 | 拒绝条件 |
| --- | --- | --- |
| `cwd` | `Workspace::Shared`/`ReadOnly` → 团队根；`Worktree{path}` → 该路径 | 路径不存在；**不在团队根之下** |
| `env` | `identity::member_env(team_id, member_id)` | —（不含凭证） |
| `args` | `AgentAdmission.mcp_argv` 模板，`{{mcp_config}}` 换成配置 JSON | 准入档不是 `Argv`；该 CLI 无 MCP 面 |

**团队根无条件 `canonicalize`**（不只是 worktree 分支）：它是 `starts_with` 判据的信任边界，
未规范化的根会让「落在根内」整体失效，而 `Shared` 成员的 cwd 也会与判据存在两种写法。

两条容易写错的地方：**凭证明文只出现在 `args` 里**（env 会被子进程继承、会进
`/proc/<pid>/environ`），**模板替换是行内的**（`admission::render_argv` → `render_arg`：
单个 argv 元素里**任意位置**的 `{{name}}` 都被换成值，「只认整串等于占位符」是 2026-11 之前的
旧行为，已被 `execution::tests::placeholders_are_substituted_inside_arguments_too` 当成 bug 钉住）。
行内是必须的：真实模板里占位符**嵌在值中间**（pi 的 header 写法就是
`x-neeko-team-token={{token}}`，见 `admission::ADMISSIONS` 里 pi 那一行的 `mcp_argv`），
整串匹配会把它留成字面量，成员拿到的就是错的 token/地址 —— 而它**不会报错**，只会 401 或
连不上。拿不到值时只有一个错误出口（`missing_placeholder`），所以拼错的占位符不会静默变空串。
`plan_member_spawn` 会 `canonicalize` ⇒ 调用方必须在阻塞池里调（红线 3）。

**依赖方向**：`execution` 只依赖 `admission`（per-CLI 数据）与 `mcp::protocol`（wire 常量），
**不认识** `mcp::dispatch` / `mcp::server` / `AppHandle` / `TerminalRouter`。
`dispatch → execution` 与 `server → execution` 都是单向的（入口把副作用交出去）—— 线协议常量
之所以搬进 `mcp/protocol.rs`，就是为了不让这几层互相依赖。`execution` 曾经 import 过
`ToolReply`（为了 `apply_reply`），那是「本地入口被绑上线协议」的根源，已消除。

**`apply_effect(StartMember)` 的顺序是契约**：`admit` **先于** `spawn`。反过来成员的首次工具调用会 401
（它就在那个窗口里刚启动）。`spawn` 失败的错误里**必须带 `member_id`** —— 成员已落库，
丢掉 id 就等于毁掉两相位承诺的「可查询、可清理」。

**投递文本在决定层拼好**：`dispatch::send`（principal 就在手边）用
`delivery::delivery_text(from, message)` 得到 `[team] {发送者}: {正文}`，`Effect::Deliver { to, text }`
只带**最终文本**。理由是「执行参数不随工具回复走」的同一条：执行层不该认识「谁是发送者」这个
决定层的事实，它只该拿到「要写进 stdin 的那一行」。wire 上也因此只有 `to` + `text`（**模型看到的
是投递文本，不是发送者字段**；一个 `from` 字段既无行动可做，又给「谁发的」造了第二个源）。
判据：`dispatch::tests::the_needs_delivery_payload_uses_the_documented_wire_keys`。

**`Pty` 投递恒为两笔**：`emit(terminal-input-{id}, text_bytes)` → `sleep(150ms)` →
`emit(..., "\r")`。一次写 `"text\n"` 会被部分 AI TUI 丢弃或误解释（`research/04` 实测）。
走既有事件而不是抢 terminal 的 writer 所有权：terminal 域对团队一无所知。

**通道由 `delivery::route(WorkerChannel, msg)` 决定（纯函数）**：`Pty` → 两笔写入；
`Mcp` / `None` → `Unsupported` + **可行动**的理由（`Mcp` 成员是我们自己的客户端，没有推送
通道，只能走板上派活）。静默「成功」比报错坏得多：队长会继续往下走，而成员从未收到任务。

**身份 env 只能注入 Local PTY**：`TerminalRouter::create_session` 对 WSL / SSH + 非空
`extra_env` 返回 `Unsupported`。静默丢弃的后果是成员「有进程、无身份」，而上报归因失败在团队
上下文里是**拒绝归属** —— 表现为「成员永远不产出」，离家太远。

**环境来自项目，不来自团队**：`Team` 不持凭证（`ProjectEnvironment::Remote` 内含 SSH 认证）。
环境归属是 **`team.project_id`**（v16 起），执行层据此精确查表；只有 v16 之前的旧行才退回
路径前缀反查。两者的判据与完整理由见下面 **§2.4**。反查 / 查表失败一律拒绝 —— 降级成
`Local` 会在本机起一个指向远端路径的 PTY，而那种错在花名册上看不出来。

## 2.3 端点启动（`team/boot.rs`）与门的活集合

团队 MCP 是**独立 loopback listener**（design §3.1b）：与 hooks 共用端口会让成员 token 能
`POST /hook/{source}` 伪造队友的上报。四条容易写错的约束：

| 约束 | 否则会怎样 |
| --- | --- |
| `request_timeout` **必须大于** `WAIT_TIMEOUT_MAX_SECS` | `team_wait` 会在等待中被引擎 408 掐断，而「超时是结果不是错误」是核心语义 |
| 门装 **活集合**（`AuthGate::with_shared_hashed_tokens` + `SharedTokenSet`） | 快照门让「先 promote、后 spawn」的成员永远进不来；重建 listener 换端口又会让已下发的 MCP URL 全部失效 |
| `refresh_credentials` **先**写身份表**再**替换门的期望集合 | 反过来有窗口：门放行新 hash 而 handler 查不到主体（200 + 空主体） |
| 读库失败 **不**降级成空表 | 空表 = 谁都进不来，看起来像「所有成员都没权限」，比启动失败更难排查 |

门的**期望集合形态与摘要编码不可分开配置**：`ExpectedTokens::{Plain, Sha256HexShared}`
两个变体各含锁行为与编码，`AuthGate` 只有一个 `expected` 字段。拆成两个字段能拼出
「活集合 + 明文」这种无意义组合，而下一个接入方挑错构造器的症状是「所有成员恒拒」。
`TeamServer` **不提供 `refresh()`**：凭证同步只有一个写入点（`CredentialLedger::admit`）。

`endpoint_url(port)` 是唯一拼装点（`http://127.0.0.1:{port}/team/mcp`）：
loopback 而非 `localhost` —— 后者在某些平台先解析到 `::1`，而 listener 只绑 IPv4。

## 2.4 团队执行环境来自**项目 id**（v16）

`Team` 同时记住两件事，**不要当成一件**：

| 字段 | 是什么 |
| --- | --- |
| `project_path` | 团队根的**工作区根**。可以是工作树，而 Neeko 自己的工作树按设计在 `~/.neeko/worktrees/<name>`（项目目录**之外**）|
| `project_id` | 拥有这个团队**执行环境**的项目 id。环境是项目的事实（`Project.environment`）|

建队时 `project_id` 来自前端 `activeProjectId`，**不是**从路径反推。

### 为什么不是路径前缀

`core::project::environment_for_path` 的**最长前缀**语义对别的调用方是对的（嵌套项目落最具体
的那个）。缺陷不在那个函数，而在「用路径反查**项目**」这个决策：工作树不在项目目录之下，
前缀永远匹配不上 ⇒ **从工作树单元开团队必失败**。失败点又在「建队写入之后、起进程之前」，
库里因此留下真实团队行（面板里能看见的孤儿队）。

所以：

- 命令层 `start_team_session` 在**任何写入之前**调 `state.project_environment(&project_id)`（与端点
  门面同一台阶：两件都是「有没有能力做这件事」），未知 id 直接返回可读 `NotFound`；
- 执行环境来源是**纯函数** `execution::environment_source(&team)`：
  `EnvironmentSource::{ProjectId, LegacyPath}`。`app::team_executor` 只按变体调
  `project_environment(id)` / `project_environment_for_path(path)` —— 执行层不写匹配规则。

**不要**改 `environment_for_path` 的前缀规则来「修」这个缺陷：那会改变项目域的语义，
而这里的缺陷是选错了依据。

### 空 id = 旧行，不是「没有项目」

`project_id TEXT NOT NULL DEFAULT ''`：空串只可能是 **v16 之前建的行**（那时环境只能靠路径
前缀猜），因为写入路径在纯函数层就拒绝空 id（判据
`planning_a_team_without_a_project_id_is_refused`）。执行层对这类行退回 `LegacyPath` ——
**它对工作树仍然无效**（旧数据缺了「项目归属」这个事实），这是有意保留的行为：
默默降级成 `Local` 会让一个 SSH 项目的旧团队突然在老本机跑起来。

### 迁移与三个写入点

v15→v16 用既有的 `add_column_if_missing`（与 v14→v15 同形状，所以可手工重放）。
**三处必须同时改**，漏一处就是「新库能写、旧库读不出」：`CREATE TABLE team` 建表串、
`SELECT_TEAM`、`INSERT … ON CONFLICT` 的列与绑定。

判据：`a_v15_team_row_upgrades_to_an_empty_project_id` / `a_team_row_round_trips_its_project_id` /
`planning_a_team_without_a_project_id_is_refused` /
`a_team_row_with_a_project_id_resolves_the_environment_by_id` / `a_legacy_team_row_falls_back_to_the_path`，
前端两条：建队 `invoke` 带 `projectId`（值与激活项目一致）、无激活项目 ⇒ 按钮禁用 +
可见理由 + 零 `invoke`。

命令级的 `project_environment` 预检**没有单测**（它需要 `AppStateWrapper`）：改坏它不会让任何
单测变红，靠集成 / 手测验证 —— 不要把它当成「已覆盖」。

## 2.5 任务 id 是**队内**标识符，`TaskRef = (team_id, id)` 是唯一寻址形式

`team_task` 的主键是 **`(team_id, id)`**，任务 id 形如 `t{seq}` 且 **每个队的板都从 `t1`
开始编号**：

```text
store::TeamStore::next_task_seq(team_id)              -- 本队板的水位线
  SELECT coalesce(max(CAST(substr(id, 2) AS INTEGER)), 0)
    FROM team_task WHERE team_id = ?1 AND id GLOB 't[0-9]*'
dispatch::next_task_id(manager, team_id) = format!("t{}", next_task_seq(team_id)?)   -- 已是「下一个」
```

两个 SQL 细节是**承重**的：`GLOB 't[0-9]*'` 挡住将来任何非 `t{n}` 的行（否则
`CAST('x' AS INTEGER)` = 0 会静默污染水位线）；`CAST(substr(id, 2) AS INTEGER)` 给**数值**序
（字符串比较下 `max('t9') > 't10'`，会算出 `t2` 并重撞）。

### 「单独一个 `id` 不是任务的标识符」是**类型**约束，不是纪律

`types::TaskRef { team_id, id }` 是任务的唯一寻址形式：

- `TeamTask::key()` 是「从任务行回到它的键」的唯一方式；
- `TeamManager` 的内存镜像是 `HashMap<TaskRef, TeamTask>`（不是 `HashMap<String, _>`）；
- `store::get_task(&TaskRef)`；`manager.task / claim_task / update_task / force_done /
  set_task_workspace` 全部收 `&TaskRef`；`reclaim_expired` / `finish_member_close` 返回
  `Vec<TaskRef>`（不是裸 id）；
- `Display for TaskRef` 是 `{team_id}/{id}`，**只给错误信息与日志用**，刻意没有
  `Deserialize` —— 用字符串解析回键就是重新引入「拼字符串找身份」（红线 12）。

为什么必须做成类型：`t1` 在每个队都存在，漏传 / 传错队的症状是「**静默读到别队的任务**」，
比任何报错都难查。判据 `a_task_id_is_only_unique_inside_its_team`（A/t1 与 B/t1 内容不同、
改 A 不动 B、`task_detail(B/t1)` 返回 B 的正文）与
`task_detail_rejects_a_pair_that_does_not_belong`。

### 两个入口的 team 从哪来（语义分界，不许互相借用）

| 入口 | 线上形状 | `team_id` 从哪来 | 为什么 |
| --- | --- | --- | --- |
| MCP 工具（`task_claim` / `task_update` / `task_list` / `team_wait` …） | **仍然只有 `task_id`** | `principal.team_id` | token 已经声明了它在哪个队；让模型自己传 `team_id` 等于给它一个伪造（或写错）的机会。唯一的构造点是 `mcp::dispatch::task_of_team(manager, &principal.team_id, task_id)`（它同时返回 `TaskRef` 与任务行，避免第二个拼接点） |
| 本地 IPC（面板） | `team_task_detail(team_id, task_id)` | 调用方显式给 | 本地入口没有 principal（模块文档已写明），所以**两个参数都必填、顺序固定** |

`view::TaskCard` 与 `TaskDetail` **都带 `team_id`**：面板拿一张卡片就能凑出详情请求的两个
参数，不必去猜父级（猜错 = 静默看到别队的任务）。审计行 `team_event.subject` 仍然只放队内
id —— 同一行的 `team_id` 列就是另一半键，「id 必须与 `team_id` 一起出现」在那张表上是
**行级**满足的。

`depends_on` 同理按队内解析：`TaskRef::new(task.team_id, dependency)`。只按 id 找会让 A 队
任务的依赖被 B 队的同名 id 满足（判据 `depends_on_resolves_inside_the_team`，构造「本队没有
该 id、别队有且已 done」的局面 —— 否则 `values().find(..)` 这类实现在两个队都有该 id 时是
**不确定**的，测试会假绿）。

### 迁移 v17：复合主键是**整表重建**，为什么这次安全

`v16_to_v17` 走 `CREATE TABLE team_task_v17 / INSERT ... SELECT / DROP / RENAME` 并重建三个
索引。安全性的依据是结构性的：

1. **`team_task` 是子表**：没有任何表引用它，所以重建期间它身上的 `ON DELETE CASCADE`
   永远不会被触发 —— 「重建中途级联掉父行」这条路径不存在（v14 期否决复合主键的理由只对
   父表成立）；
2. 整步跑在 `migrations::run_migrations` 的 `EXCLUSIVE` 事务里，DDL 在 SQLite 里是事务性的
   ⇒ 失败 = 整步回滚，旧表原样还在；
3. `INSERT ... SELECT` 在 `foreign_keys=ON` 时顺带校验每行的 `team_id` 都能在 `team` 找到，
   等于一次免费的一致性检查（孤儿行确实会让迁移失败 —— 那是数据损坏，不是可静默丢弃的东西）；
4. **幂等**：先查 `pragma_table_info('team_task')` 的 `pk` 列（`team_id = 1 且 id = 2` 即已迁移）
   —— 重建本身不幂等，半迁移后手工重放不得炸（判据 `migration_step_is_idempotent` /
   `v17_step_is_idempotent`）；
5. **列序也是承重的**：`(team_id, id)` 的隐式索引直接服务 `WHERE team_id = ?`
   （`list_tasks` / `next_task_seq` 都是这个形状），`(id, team_id)` 的索引对它们无用。判据
   `the_task_primary_key_is_team_first`。

判据：`a_v16_database_regains_the_task_id_for_a_second_team`（v16 库里 `(tm_a, t1)` 升级后
行仍在 + `user_version == 17` + 队 B 能插入 `t1`，并断言**改前**那次插入确实被单列主键挡住）/
`a_new_team_numbers_its_tasks_from_one` / `next_task_seq_is_per_team` /
`next_task_seq_ignores_rows_that_are_not_t_numbered` / `next_task_seq_is_numeric_not_lexicographic` /
`the_task_sequence_grows_numerically_past_t9` / `next_task_seq_is_one_on_an_empty_board`。

### 复盘：先做了全局序号（D1），为什么后来它不再需要

v16 期的裁决是「任务 id 的命名空间**就是 DB 全局单调**」，起因是一次真实事故
（2026-11-03）：`tm_1a196cefa87` 已占 t1/t2/t3，新建一个队时按本队板取最大值算出 `t1`，
撞上 `id TEXT PRIMARY KEY` ⇒ **新队第一次 `task_create` 必然 Conflict**，队长永远派不出活。
当时的解法是让水位线**全库**最大（跨团队共享一条 seq），代价是单个团队的 id 不连续
（`t4` 起头很正常）。

那时**否决过**复合主键，理由是「整表重建 + 事务内 `PRAGMA foreign_keys` 是 no-op，没有安全
形态」。这个理由在**子表**上不成立（见上一节），而且它把「任务 id 是队内句柄」这个**语义**
事实误当成了「主键凑巧全局唯一」这个**实现**事实 —— 于是全局唯一性反过来泄漏到了产品语义里
（队长看到 `t7` 会以为漏了任务）。

本轮按用户裁决改回队内编号：「肯定不能单独传 `task_id`，`team_id` 一定要和 `task_id` 在一起
这样语义才完整」。**全局序号唯一的理由（避开单列主键冲突）被复合主键消掉之后，它就不再
需要了** —— 而它留下的代价（id 不连续）反而变成了一个会被误读的信号。

判据里的 `a_second_team_continues_the_global_task_sequence` / `max_task_seq_*` 已**删除**，
替换成队内版本（见上一节列表）。谁再想改回全局序号，必须先回答：既然主键是复合的，
全局唯一换来了什么？（答案是：什么都没有。）

## 3. 准入表（红线 15 落点）## 3. 准入表（红线 15 落点）

「这个 CLI 能不能当成员、走哪条通道」是 **per-CLI 数据**，只允许是 `ADMISSIONS` 里的一行：

- 通用模块禁止 `if agent_id == "…"`；`admission.rs` 有源码级护栏
  （`per_cli_facts_live_only_in_the_table`：禁止比较/`matches!`/`match` 分支形状，
  且每个已准入 id 在生产段**恰好出现一次** = 它自己那行）。
- **档位由数据推导**（`tier_of`：无 hook ⇒ C；有 hook 有 MCP 面 ⇒ A；有 hook 无 MCP 面 ⇒ B），
  调用方不可声明。
- `result_channel`（怎么**报**）只由 hooks 决定；**工具面**（`has_mcp`）是另一列。
  两列不合并：`grok` 是「有工具面但报不上来」的真实反例。
- `channel`（怎么**发**）**不是** per-CLI 事实，CLI 成员一律 `WorkerChannel::CLI_MEMBER = Pty`。
  按「有 MCP 面 ⇒ `Mcp`」推导会造出一条**不存在的通道**：MCP over HTTP 没有 server→client
  推送，工具面里也没有收件箱。症状是 `team_send` 对每个成员都 `Unsupported` ——
  队长以为派了活，成员从未收到（`a_spawned_member_is_deliverable_over_its_pty` 钉住这一条）。
  `Mcp` 留给将来的 Chat 成员（`SessionRequest` 是真正的下行通道）。
- `unverified` 字段是**诚实面**：B 级证据（配置已装、未跑一轮）必须原样回给队长。
- `McpTransport` 的变体集合 = **本仓已实现的传输集合**。加变体必须与它的 bridge 同一个 diff，
  否则 `has_mcp()` 会把一条发不进去的配置宣传成「有工具面」。
- `McpInjection` **四档的区别是「谁来写配置、写到哪里」**，不是便利性：
  - `Argv` = 启动参数（**不写任何文件**，本次启动生效）：claude-code / codebuddy / qoder 用
    `--mcp-config <json>`；**codex 用 `-c mcp_servers.<name>.…` 覆盖**（同一个目录下 `-c` 覆盖也能
    在 `codex mcp list` 里看到 —— 这是把它从 `Subcommand` 改成 `Argv` 的依据）。
  - `ConfigDir` = **重定向该 CLI 的配置目录**，在其中用**它自己的** `mcp add` 写 → 用户配置零写入：`pi`
    （`PI_CODING_AGENT_DIR`）。这是「`Subcommand` 但不污染用户配置」的形态，也是「不碰用户配置」这条约束下唯一干净的路。
    它的事实全在兄弟字段 [`ConfigDirSpec`]（`env` / `mcp_file` / `add_argv` / `home_subdir` / `mirror`）——
    档位本身不带负载：它是持久化列（`team_member.mcp_injection`）又是 `static` 数据，负载会变成第二份真相。
  - `Subcommand` = 该 CLI 自己的 `mcp add` **写用户全局配置**（grok / opencode）—— v1 不做（C3：
    必须先有备份 / 幂等 / 拆除三件套）。
  - `ConfigFile` = 直改配置文件（gemini）—— 同上，v1 不做。
  把「子命令写配置」记成 `Argv` 的后果是执行层传一个 CLI 不认的启动参数 —— **成员起得来，
  MCP 面静默不可见**。因此 `launch_refusal()` 是**单一判据**：`team_spawn` 写库之前、
  执行层起进程之前、以及面板的 CLI 清单（`team_launchable_agents`）三处都问它。
- **`prompt_argv` 是第五列**（`{{preamble}}` 模板）：它回答「这个 CLI 能不能在**启动时**收到角色
  上下文」。非空 ⇔ 能当队长；空 + 队长 ⇒ `lead_refusal` 拒绝（一个不知道自己是谁的队长会坐在
  那儿一动不动，看起来和正常团队一模一样）；空 + 成员 ⇒ **照常起**（成员的第一份上下文由
  `team_send` 沿 PTY 带来）。这条不对称是本域最容易写错的一处。
  - 「谁可以当 X」是**准入问题**，所以角色选择 `refusal_for(role, agent_id)` 住在准入域，不在执行层：
    执行层只是提问者之一。放在执行层的结果是面板只能问成员那一半 —— `team_launchable_agents`
    曾经就把成员判据当队长判据在用，而两个集合**当时恰好相同**，于是错了也看不出来。
  - 不在准入表里的 id 对**两种角色**都是拒绝（返回「可启动」会让面板显示一个永远起不来的 CLI）。
- 准入表与 `builtin_configs()` 是两个真相源，中间只有一条机器桥：
  `every_admitted_agent_has_an_agent_config`（`dsh` 被拒的理由正是「没有 `AgentConfig`」）。

### 3.1 模板占位符（不是字符串拼接）

`mcp_argv` / `add_argv` 是 `&'static [&'static str]` 模板，由 `render_argv` 做**元素内**替换：
`{{mcp_config}}`（JSON 整段）/ `{{url}}` / `{{token}}` / `{{token_env}}` / `{{preamble}}`。
**未知或未闭合占位符 → 报错**，**`{{preamble}}` 缺值也报错**（用 `Option` 而不是空串：否则会退化成
`--append-system-prompt ""`，队长安静地不知道自己是谁）。静默留字面量等于把 `{{token}}` 当参数发给 CLI。
`pi --header x-neeko-team-token={{token}}` 这种嵌在参数里的形态是它存在的理由 —— 「整元素等于占位符」的旧实现会
把它原样发出去。

### 3.2 凭证可以进 env 的唯一例外

`SpawnPlan.env` 是**身份**（不含凭证）；`SpawnPlan.credentials_env` 是唯一的含密通道，
且**只有 `bearer_token_env_var` 那一族需要**（CLI 的鉴权通道就是 env，argv 里只放 env 名）。
判据挂在**模板**上（含 `{{token_env}}` ⇒ 注入一条 `(TEAM_TOKEN_ENV, token)`），不是 `agent_id` 分支。
可见性评估：argv（`--mcp-config` JSON）与 env 都只在本机同用户边界内可见，Neeko 不外发、不写日志，
且两者都不进 `team_event` 审计行。

### 3.3 配置目录的 provisioning 与清理归属

隔离目录放在 Neeko 自己的状态根下（`state_root/team/<team>/<member>/`，根由**组合根**传，
域里不硬编码临时目录）。副作用全部在 `app/team_executor.rs`（与起 PTY 同层），域只产出
`ConfigDirPlan`（纯）。

| 阶段 | 谁负责 | 失败后的行为 |
| --- | --- | --- |
| mkdir + 镜像（symlink）| `provision_config_dir`（阻塞池）| 删目录 |
| 跑 CLI 自己的 `mcp add`（`core::exec`，红线 1）| 同上 | 删目录（里面有 token 明文）|
| 起 PTY | 同上 | 删目录 |
| 成员正常跑起来 | — | **不删**：留给关队命令（它是唯一有权判「成员真的不在了」的地方）|

两条实战约束：

- **镜像只列能共享的项**：用户资产（`auth.json` / `models.json` / `settings.json` / `trust.json` /
  `extensions` / `skills` / `themes`）必须镜像，否则成员是「未登录、无扩展」的裸进程；
  运行时缓存（`npm` / `bin` / `models-store.json`）**也镜像** —— 不镜像时 pi 会在隔离目录里
  现场跑 `npm install`（实测 ~10s 且**需要网络**，离线直接起不来）；
  绝不镜像：`sessions/`（团队成员会话与用户历史分开）、MCP 配置文件本身、OAuth 态。
- **Windows 无开发者模式**：`symlink` 失败（`PermissionDenied`）时**文件复制、目录跳过**并 warn。
  代价是凭据可能多一份字节拷贝 —— 取舍是「未登录的成员」比「多一份拷贝」更糟。
- 镜像源路径必须 `canonicalize`（红线 8），源目录不存在 ⇒ **拒绝启动**（配置目录不存在意味着
  该 CLI 从未初始化，起一个未登录的成员在花名册上与正常成员一模一样）。

### 3.4 能力缺口必须在 UI 上可见

`team_launchable_agents() -> [{ agentId, refusal }]`（`admission::launchable_agents`）与
`team_spawn` **同一份判据**。面板把 `refusal` 渲染成**可见文字**（不是 `title`：被拒行是
`disabled` ⇒ 不可聚焦，键盘与读屏用户拿不到 tooltip），并在点击路径上再拦一次。
不允许 UI 自己维护第二套「能不能启动」的判据 —— 那一定会与后端漂移。

**「能不能提交」与「能不能启动」是两件事**：前者是 `utils/launchGate.ts` 的纯函数
（`launchGate`），四条否决来源（无激活项目 / 无工作区根 / 无可启动 CLI / 配置草稿不可提交）
各自单独成立就足以打掉主按钮，理由也从同一返回值出（**可见**文字）。没有激活项目那条
是 v16 的：执行环境按 `projectId` 查表（见 §2.4），所以「有根但没项目」也算不可提交。

### 3.5 关闭协议（`team_close`）

状态机：`Active → Closing → Closed`（单向）。**两个入口同一份决策**：MCP 工具（有 principal，
走授权矩阵）与本地面板命令（无 principal，走本机用户）都调 `execution::plan_close`；
执行都在 `execution::apply_effect(Effect::Close(..))`。判据只此一份。

| 阶段 | 做什么 | 失败后 |
| --- | --- | --- |
| 决策（写库 ⇒ 阻塞池） | 校验 + `begin_team_close`（整队）/ 单成员校验 + 审计 `close_request` | 什么都没变 |
| 执行 | `executor.close`（请求关 PTY）→ `finish_member_close`（Dead + 清 `terminal_id` + 作废凭证 + 在飞任务回 `pending`）→ 全部成功才 `finish_team_close`（`closed` + `closed_at`）→ **收尾**：`credentials.refresh()` | 停在 `Closing`，错误逐个点名，**可重试** |

几条不显然但必须守住的语义：

- **先请求关进程，再归档成员**（design §7.1）。反过来会留「成员已 Dead、PTY 还活着」——那是
  「会撒谎的状态」：面板说关了，进程还在跑。
- **但 `close` 只是「请求」**：`MemberExecutor::close` 的 `Ok` 只保证 kill 已发出（PTY 的收尾
  在另一个线程里，`close_session` 是 remove-then-close）。所以「归档 + 撤凭证」可能先于
  「进程消失」发生 —— 这**不影响**正确性（凭证撤掉之后它再也调不动工具），但 `notes` 里有一条
  明说这件事（`member processes exit asynchronously: …`），**不许**写成「进程已关」。
  不引入「等进程消失」是刻意的：那会把关闭变成一个可能卡住的操作，而换来的不是安全性质。
- **手动关闭不加 `reclaim_count`**：它是「反复失败」的判据（>3 → `blocked`），不是操作计数。
  让任务替人的决定背锅，这个指标就废了。`reclaim_expired` 那条路仍然 +1，两条不可合并。
- **凭证立即作废**：`finish_member_close` 清 `token_hash` → `principals_from` 过滤空 hash →
  `CredentialLedger::refresh`（唯一 writer = `TeamServerState::refresh_credentials`，先表后门）。
  不清 hash 的后果有反例测试钉着（关掉的成员旧 token 仍可用）。
- **`graceful` 本期不兑现**：PTY 没有可发的关闭协议，所以行为等同于直接关；**必须写进 `notes`**，
  不许假装协商过（红线 14）。
- **worktree 一个都不删**（本期零 fs 操作）：路径收进 `notes`（`worktree kept for manual review: …`），
  协商式清理要等 worktree 创建接线之后（P4）。
- **`Closing` 期间只允许读**：`team_status` / `task_list` / `team_list` / `team_close`；
  其余工具一律 `Conflict`，理由里带当前状态与允许清单。否则「正在解散的队」还能 spawn/派活。
- 幂等：对 `Closed` 再关 → `Ok`，不重写 `closed_at`；对已归档成员再关 → 空操作。
- 判据：`a_member_whose_process_survives_is_not_archived` / `a_partially_closed_team_stays_closing` /
  `finish_member_close_archives_and_releases_without_touching_reclaim_count` /
  `closing_a_member_revokes_its_credential_before_the_gate_is_rebuilt` /
  `a_closing_team_refuses_writes_but_answers_reads`

### 3.5.2 删除协议（`team_delete`）—— 与关闭的边界

删除**不是**关闭的一个布尔参数。两件事的不可逆程度不同，所以判据也不同：

| | `team_close` | `team_delete` |
| --- | --- | --- |
| 可逆面 | **可重试**（失败停在 `closing`，再调一次是同一目标集重走） | **不可逆**（行 + 成员 + 任务 + 审计一起没） |
| 允许的状态 | `active` / `closing` | **只** `closed` |
| 需要 `team_surface` | 是（要 `credentials` 作废凭证、要 `executor` 关 PTY） | **否**（成员已归档，本域不再持有进程） |
| 失败后 | 停在 `closing`，可查询可重试 | 什么都没变 |
| 载荷 | `ClosedReply`（关掉了谁 + 诚实面 `notes`） | `()` |

**为什么只允许删 `closed`**：`active` / `closing` 背后是还在跑的进程。删掉那种队等于把
「它还在跑」从唯一能看见它的界面抹掉，而后果是**不可撤销**的：`principals_from` 从**库**
组装身份表，行没了表就空了 —— 那些进程的 token 全部失效，而进程还活着。这不是一个能回滚的
状态。拒绝信息必须点名当前状态并指出下一步（「先关闭」），不是只说「不行」。状态词用本文件
既有的 `{:?}` 口径（`Active` / `Closing`，与 `task {key} is {:?}` 一族一致）——**不要**为一句
错误另造一个 enum→文本投影，那是第二份口径，而它只在那一句上生效。

**为什么级联只写一条 `DELETE`**：`team_member` / `team_task` / `team_event` 都有
`team_id … REFERENCES team(id) ON DELETE CASCADE`，而 `PRAGMA foreign_keys=ON` 挂在
`common/db/pool.rs` 的 `with_init` 上（pragma 是 per-connection 的，池懒建连接 —— 只能挂
在那里）。在 Rust 里手写四张表的删除顺序是第二份级联定义，两份漂移的症状是「删了队但板上
还留着任务」（看不见的孤儿行）。

**镜像必须与库同一步，而且四个容器一个都不能漏**：`store.delete_team` 成功之后立刻清
`inner.teams` / `inner.members` / `inner.tasks` / **`inner.verification`**。只删库的话，
`team_list`（读镜像）会继续列出一个已经不存在的队 —— 而那是面板的数据源。

`verification` 以**成员 id** 为键（没有 `team_id` 列），所以要先收集该队的成员 id 再
`retain`。它当前**读不到**（四个读入口都先查 `members`），但它是只增不减的，而 `Inner` 的
契约是「与库在同一把锁内一起改」—— 留下无法回收的残留键就是那条约定的反例，且下一个人加
字段时会照着这个不完整的形状再漏一次。判据 `only_a_closed_team_can_be_deleted` 会先认领
一张任务，让 `verification` 里**有物可查**（否则那条断言是空转的；变异验证过：删掉那行
`retain` 即变红）。

**不幂等**：已不存在 ⇒ `NotFound`。合成 `Ok` 会让面板在竞态下（另一窗口已经删了）报一个假成功。

判据：`only_a_closed_team_can_be_deleted`（状态判据 / 镜像与库同步 / `NotFound`）/
`deleting_a_team_emits_exactly_one_pulse`（写路径恰好一次脉冲）/
`deleting_a_team_cascades_to_members_tasks_and_events`（级联真的生效 —— `foreign_keys` 是
per-connection 的，DDL 里写着不等于会级联）。

### 3.5.1 关闭的后置条件是**一条**不可分割的动作

「关掉一个成员」不是一串调用，是库里的四个事实必须**同时**成立：

| 事实 | 谁写 | 漏了会怎样 |
| --- | --- | --- |
| `member.state = Dead` | `finish_member_close` | 花名册上还显示在跑 |
| `member.terminal_id = None` | 同上（**同一把锁的同一次写**） | 已关闭成员仍给一个「打开终端」的死按钮（前端唯一判据是 `terminalId == null`） |
| `member.token_hash = ""` | 同上 | 旧 token 还能调工具（直到门重建） |
| 门**忘掉**那把钥匙 | `credentials.refresh()` | 上面三条都做对了也没用：**门还认旧 hash** |

前三条由 `archive_member` 在锁内一次写完（判据
`a_closed_member_has_no_terminal_and_no_credential` 用一条断言钉住三个事实）。第四条不属于任何
**单个成员** —— 它属于整次关闭，所以它的位置不是「某一步之后」，而是**收尾**。

#### 为什么 `refresh` 不能被 `?` 跳过

旧形状是 `finish_team_close(...)??` 排在 `credentials.refresh()` **之前**。任一 `?` 提前返回 ⇒
已经归档的成员 `token_hash` 已在库里清空、**门却还认那把钥匙** ⇒ 一个「已关闭」的成员旧 token
照样能调工具（包括 `team_close`）。库里看起来一切正确，而门放行了一个已经不存在的成员。

所以 `execution::close_targets` 的形状是写死的：

```text
① 循环：executor.close(id) → finish_member_close(id)
        每个失败只记进 failed，**没有一个 `?`**（含 spawn_blocking 的 JoinError）
② seal：finish_team_close(team)（仅在「整队 + 全部成员已归档」时）
        结果记进变量，**没有一个 `?`**
③ 收尾：if 有任何凭证被作废（含 seal 顺手归档的队长）→ credentials.refresh()
        这是**唯一**一处没有 `?` 的 await：错误记进变量
④ 判定顺序：成员失败 → refresh 失败 → seal 失败（安全面最重的先说）
```

判据：

- `a_failed_seal_still_revokes_the_credentials`（让 `finish_team_close` 因状态冲突失败，
  断言 `refresh` **仍**被调用、成员 `token_hash` **已**清空、错误文案诚实说明「凭证已撤、
  团队还没 sealed」）—— 变异验证：把 `refresh` 移回 seal 之后的 `?` 链上，这条立即红；
- `a_partially_closed_team_stays_closing`（有成员关不掉时已关成员的凭证仍失效）；
- `a_member_whose_process_survives_is_not_archived`（没关掉进程 ⇒ 不得归档、不得撤凭证、
  **也不得白刷新门**）。

#### `notes` 必须诚实（第三条 note）

`close_notes` 恒带一条「进程是**异步**退出的」：`MemberExecutor::close` 只保证 kill 已发出，
归档与撤凭证可能先于进程消失。这不影响正确性（凭证撤了它再也调不动工具），但**不许**把关闭
说成「进程已关」。`graceful` 那条也改成了「请求 kill」而不是「已经关掉」——两条 note 各说一件事，
不重复。

### 3.6 团队清单（`team_list`）

重启后团队从库里 hydrate，但「有哪些队」必须有个读路径，否则用户既看不到也重不开自己的队。

- `view::list_teams` 是唯一构造点；MCP 工具与 Tauri 命令同源。
- **有界**：`MAX_LISTED_TEAMS = 50` + `truncated`（红线 4：历史团队会一直累积，单次载荷不许无界）。
  排序 `created_at` 倒序、同毫秒按 id 稳定。
- `member_count` **不含队长、含已 Dead 的成员** —— 与 `team_options` / `team_spawn` 的上限判据同源；
  同一个队不能有两个成员数。`TeamStatusView.member_count` 与 `TeamSummary.member_count` 因此走
  **同一个**访问器（`TeamManager::member_count`），判据
  `view::tests::the_two_faces_of_a_team_report_the_same_member_count`。花名册 `members` **含队长**，
  所以 `members.length` 永远不能当成员数用。
- 三个计数走 `TeamManager::task_counts`（锁内一次遍历、**不 clone 任务行**）：`list_teams` 是每次
  面板脉冲都会走的读路径，`tasks()` 会把整段任务行 clone 出来（红线 4 的时间维度）。
- 面板据此渲染三态徽标（`active` / `closing` / `closed` **不许合并**：`closing` 就是「关到一半」）。

### 3.7 团队组成：配置是数据列，三个消费者一个推导

团队允许谁进来、还能加几个、成员继承什么缺省，都存在 `team` 行上（v15 迁移：
`allowed_agent_ids` / `default_model` / `default_workspace` / `default_approval_policy` / `max_members`）。

| 消费者 | 用法 |
| --- | --- |
| 面板（`team_options` 命令） | 建队前看目录（`team_id = None`）、建队后看该队的实际配置 |
| 队长（MCP 工具 `team_options`） | 派活前读「我能选谁 / 还能加几个 / 缺省是什么」 |
| `team_spawn` + 角色 preamble | 校验池子与上限、**填**缺省、**只广告**池内的 CLI |

- **空池 = 不限制**（`allowed_agent_ids` 为空表示「本机全部可启动」）。开一个团队不该先逼用户
  勾选；**限制**才是显式动作。于是有两个概念，不可互换：`Team.allowed_agent_ids` 是**意图**（可空），
  `TeamOptions.defaults.allowed_agent_ids` 是**解析结果**（永不为空）。
- **不许静默过滤**：池子里写了今天起不来的 CLI → **构造期拒绝**，不是悄悄丢掉。一个被勾了却
  消失的选项，是这里最难发现的失败。
- 上限区间 [1, 8]：前端有镜像（只用于「不发必败请求」），**后端先拒**，镜像不成判据。
- 三个缺省值必须从**团队行**读，不是从常量：否则成员的 model / workspace / approval 会变成
  「模型当时随手写的」而不是可复现的事实。
- 判据：`a_spawn_outside_the_team_pool_is_refused_with_the_pool` /
  `the_member_limit_is_enforced_and_the_lead_does_not_count` / `spawn_defaults_come_from_the_team_row` /
  `team_options_is_the_same_derivation_as_the_panel` / `the_lead_preamble_only_advertises_the_teams_pool` /
  `a_v14_team_row_upgrades_to_the_documented_defaults`

### 3.8 角色 preamble 的位置：argv，不是任务体

队长/成员的角色上下文（你是谁、工具面、硬规则、可 spawn 的 CLI）**作为启动 argv 注入**，
不写进任务体。理由与 design §5.7 同源：任务体经 PTY 打进 pane，整段会回显进字节流，
既抬高 sentinel 误匹配面，也顶大 prompt。

- 工具清单**从 `TOOLS` 派生**（`preamble_is_derived_from_the_tool_table`）——手写第二份就会漂移。
- 可 spawn 的 CLI 列表来自 `options_for(...)` 的池子，**不是**全机目录：广告一个永远失败的选项
  只会让队长把时间花在重试上。
- 注入形态**逐家实测后落数据**（`--append-system-prompt` / `--prompt` / 位置参数三种形态），
  验法可零成本复用：**未知开关**与**不存在的 `--model`** 退出签名不同 —— 前者证明「这个 flag 不认识」，
  后者证明「argv 被完整解析了」。

## 4. 凭证：明文只在执行层出现一次

- 落库只存 `sha256`（`member.token_hash`）；**明文从来不经工具返回**（那会进模型上下文、
  会话 transcript 与导出）。
- `team_spawn` 落库时 `token_hash` 为**空串 ⇒ 该成员不可认证**；执行层拿到 `member_id` 后调
  `TeamManager::issue_token` 取一次并用掉。
- `issue_token` **会轮换**：旧 hash 被覆盖，执行层重试不会留下两把能用的钥匙。
  审计只记「何时签的」，不记明文也不记 hash（`team_event` 会被导出做排查）。
- 落库的 `sha256` 就是 `principals` map 的 key：`resolve_principal` 只做查表，**不做恒定时间
  比较**（攻击者无法控制 key 侧）；`server/gate.rs` 的「进程内比较落点 = 1」不变量因此仍成立。
  组装 `principals` 必须**从库**（`mcp::principals::principals_from`）且**过滤空 hash** ——
  空串是一把空钥匙，任何空 header 都会命中它。
- **门的期望值是 hash 而不是明文**（`AuthGate::with_shared_hashed_tokens` + `SharedTokenSet`）：
  候选值在比较前先摘要，因此门**不需要持有明文**也能裁决。两种编码必须逐字一致
  （小写十六进制），否则门会对**所有**成员恒拒 —— 表现为"token 错了"，实际是编码漂移。
  hooks 的门仍是 `AuthGate::with_tokens`（明文、零锁）。

## 5. 并发与阻塞（红线 3）

- `TeamManager` 是**同步**的：唯一阻塞调用是 `rusqlite`，包成 `async` 只会让「锁跨 await」变成可能。
  调用方负责把整次调用放进 `spawn_blocking`。
- 唯一异步边界是 `dispatch::call_async`：`team_wait` 留在异步侧（等待循环只读内存快照，
  阻塞它等于钉死一个 worker 直到超时），**其余工具一律进阻塞池**（它们是会写库的那一类）。
  同步入口 `dispatch::call` 是 `#[cfg(test)]` —— 留一个能在 async 上下文直接调的同步入口，
  等于给「把 SQLite 写回 tokio worker」留后门。
- 写路径必须经 `manager.lock_writing()`（离开作用域时置代数 + `notify_waiters()`），
  顺序固定「先置位、后 notify」；纯读用 `inner.lock()`，**不得**唤醒等待者。

## 6. hook 事件的团队投影（依赖方向）

`team/observe.rs` 是投影，`team/deliver.rs` 是投递入口，两者**故意放在消费方域内**。
`hooks` 只声明端口 `ExtraConsumer`（`Arc<Deliver>`），具体接线在组合根（`app::boot`）。
判据与例外全文：`agent-hooks-domain.md`「消费者投影文件的位置（例外：团队观察者）」。
消费者与通知共享**同一次** `spawn_blocking`（通知在前），且各自被 `run_guarded` 隔离 panic ——
顺序不等于依赖：任一侧崩溃都不该让另一侧收不到事件。理由见同一文件
「一次 spawn_blocking，N 个消费者」。

### 6.1 上报模板是**生产侧**：契约两端都要有判据

团队归因的输入是 `EnvHints.{team_id, team_member_id}`，而它们的**唯一生产者**是五份上报模板
（`hooks/templates/` 下的 `neeko-report.mjs` / `neeko-pi-status.ts` /
`neeko-opencode-status-v2.js` / `neeko-opencode-status.js` / `neeko-omp-status.ts`）。

**事故（2026-11-03）**：这两个字段在 Rust 侧早就有了，`attribution_verdict` 也靠它们判团队
上下文——但**生产侧从来没填过**（模板只发 `{neeko_session_id, project_id}`）。于是每条成员
hook 都走 `NotTeamContext` → 静默跳过：成员 `state` 永远 `spawned`、`last_seq` 永远 0、
`team_wait` 只能超时。而 Rust 侧测试用手搓的 `HookEvent`（自带 hints）所以**全绿**——
**契约两端只有一端被测过，于是链路上没有任何一处会红**。

两条规则：

1. **新增/修改任何上报模板都要加一条「内容守卫」**：`include_str!`（或扫目录）后断言模板正文
   包含 Rust 常量的**值**（`identity::TEAM_ID_ENV` / `TEAM_MEMBER_ID_ENV`，不是字面量
   `"NEEKO_TEAM_ID"`）——而且断言**读取形态** `process.env.{NAME} || null`，否则只写在注释里
   也能命中。
2. **清单要靠扫描而不是手写**：`templates::tests::every_hook_template_forwards_the_team_identity_env`
   扫 `hooks/templates/` 目录并对**每一份** `.js/.mjs/.ts` 断言（新增模板自动被盯上），再把
   文件名清单逐字比一次——手写清单会漏，而漏的那份就是下一个静默缺口。

落盘不必手工重装：`shim_is_current` 比**内容**，`install` 在内容变化时原子重写；app 重启时的
`reconcile`（`hooks/boot.rs`）会把新 shim 刷到已安装的 CLI 上。

**仍未修**：`team::deliver` 的 `SkippedUnknownAgent` 把「身份缺失」与「非团队上下文」压成同一个
结论——它让本次事故难查（如果日志能分开，一开始就能看出是模板没发 env）。那是观察者层的改动，
要单独做。

## 7. 验证入口

```bash
cargo test --lib agent::team        # 本域全集（含准入矩阵、状态机、租约、水位线、MCP 工具面）
cargo test --lib agent::team::mcp   # 只跑工具面（schema / dispatch / server）
```

## 8. 前端可观测：快照读路径 + 失效脉冲

### 8.1 视图构造只有一个落点（`view.rs`）

`TeamStatusView`（MCP 的 `team_status`）与 `TeamSnapshot` / `TaskCard` / `TaskDetail`（前端两条命令）
**共用 `view.rs`**。入口层（`mcp/dispatch.rs` / `commands.rs`）不得自己构造视图 ——
第二个构造点就是第二个「哪些字段进列」的答案，而 `lease_remaining_secs` 这类派生会因此出现两份。

### 8.2 列路径的载荷契约（红线 4）

- `TeamTask.body`（派活正文）**长度无上限**，因此 `TaskCard` **没有这个字段**（不是
  `skip_serializing`，是类型上不存在）。正文只能走 `team_task_detail`（点开才拉），
  与「成员 transcript 不默认上行、点开才拉 conversation」是同一条原则。
- `MAX_BOARD_TASKS = 200` + `tasks_truncated` 是**列载荷上界**，不是分页实现：单个快照稳在
  数十 KB 量级，但「每次派活都重拉一遍」会把红线 4 的约束从单次搬到时间维度上破。
- 判据落在**序列化后的 `Value`**：断言结构体没有字段不算取证（wire 上可能有）。

### 8.3 前端事件 = 失效脉冲，不是增量

`TEAM_EVENT = "agent-team://event"`，载荷只有 `TeamPulse { rev }`（`rev` = 该次写之后的
`TeamManager::epoch`）。**事件只说「有东西变了」，不说变了什么**。

裁决理由：增量载荷＝在 TS 里重建一份状态机（两份必然漂移，且漂移是静默的）；而面板无论如何
都必须能靠一次快照自愈（重连 / webview 重载 / 错过事件 / 慢消费者），既然快照是必需的，
它就该是唯一真相。判据：**若一段 TS 代码在解释事件载荷的语义，它就已经越界。**

代价写下：脉冲不保证送达、不保证顺序 —— 由「快照是唯一真相」兜住。

发射点是 `WriteGuard::drop`（与 `notify_waiters` 同一个落点）：任何写路径恰好一次脉冲，
含 `?` 早退；读路径零次。`bump()` 返回 `fetch_add` **之后**的代数 —— 分两步读会把两次写
报成同一个 `rev`，前端去重于是吞掉一次真变化。

前端消费契约（`src/features/agent-team/`）：`rev <= lastRev` 直接忽略；窗口内多脉冲合并成
**一次**重取（一次动作后端发多条）；在飞期间到达的脉冲在落地后补一次（否则刷新期间的最后一
次变化被永久吞掉）；卸载即退订。**不得**缓存或派生成员/任务的当前状态副本。

双端护栏：`tools/guards/checks/check_event_constants.py`（Rust `xxx://` + 名字含 `EVENT` 的常量
↔ `src/shared/events.ts`）。**边界必须记住**：无协议事件名（`file-changed` / `dap-event`）与前缀
式名（`lsp-*-{path}`）**不在射程**，仍需人工 review。

### 8.4 本地 Tauri 入口 vs MCP 工具：授权分界

`authorize.rs` 的**工具数 × 角色数**矩阵（当前 11 工具 × 2 角色 = 22 格，由
`mcp/schema.rs::ALL_TOOL_NAMES` 派生，见 `matrix_is_enforced_cell_by_cell`）回答的是
「**成员（模型进程）能不能对队友做某事**」—— 那是不可信主体。
`team_snapshot` / `team_task_detail` / `start_team_session` 是**本机用户**的入口，不做 principal 校验
（否则像是漏了授权）；它们也**不得**顺手放宽矩阵里的任何一格。

### 8.4a 命令载荷的 wire 键名（一次真实事故）

`TeamSession` 少了 `#[serde(rename_all = "camelCase")]`：命令成功、队长 PTY 也在跑，前端却提示
「团队『undefined』已建立，但队长进程没有落地」—— 它读的是 `session.teamId` / `session.terminalId`，
收到的是 `team_id` / `terminal_id`。

判据：**新增或修改任何跨 IPC 的载荷，都要有一条断言 JSON 键集的测试**。字段名对了不代表 wire 上
名字对了；从结构体定义处看不出口径。`commands.rs` 的
`every_command_payload_uses_camel_case_wire_keys` 用一张表钉住当前全部命令载荷，并顺带扫描
「键名里有没有下划线」—— 新增载荷时**加一行**即可获得同样的保护。

### 8.5 终端接管的所有权（跨域契约，团队入口的前置）

队长/成员 PTY 由**后端**创建（`start_team_session` 返回 `terminal_id`），前端只是**接管**：
`TerminalTabData.existingSessionId` → 策略 `createSession` 直接返回该 id（不发
`create_terminal_session`），且 `CacheEntry.attached = true`。

- 接管**不需要新握手**：credit-pull 的缓冲按 session 存在后端（`SessionDrain` + `pump` 的背压
  语义：缓冲满时暂停读而不是丢字节），前端拿到 id 就能 drain。
- **`attached` 的 entry 不拥有进程**：销毁缓存 / 自愈重建只销毁缓存，不下发
  `close_terminal_session`。否则「关一个 tab 就 kill 掉整个团队的队长」，而用户看不出因果。
  PTY 的生命周期归团队域的关闭协议（先 close PTY，再归档成员）。
- 同一 `sessionId` 只能有一个 tab：drain 是 per-session 单队列且 `take_all()` 取走全部积压，
  两个 tab 同时拉 ⇒ 谁先 poll 谁吃掉整块字节，另一方永远缺。


新增工具的清单：`ToolName` 变体 → `ALL_TOOL_NAMES` → `TOOLS`（含 `input_schema`）→
`dispatch_tool` 的 `match` → `authorize.rs` 的矩阵表（格数 = `ALL_TOOL_NAMES` 长度 × 2 个角色，
当前 22 格；编译器与 `matrix_is_enforced_cell_by_cell` 会同时追着你补）。

### 8.6 成员详情与**有界事件读法**（`team_member_detail`）

花名册能看「谁在干什么」，但点开一个成员此前什么都没有：不知道它手上有哪些任务、刚才
发生了什么、是不是卡在审批上。`team_member_detail` 补这条读路径，同时是 **AC5 待批队列**
的落点（`prd.md` R5.3 / design §6.1）。

#### 载荷形状（`view.rs::MemberDetail`）

| 字段 | 内容 | 上界 |
| --- | --- | --- |
| `member` | **花名册的同一行**（`member_status_view`，全仓唯一构造点）| 恒定小字段 |
| `tasks` | 它在飞的任务 + 它最近完成的 | `MAX_BOARD_TASKS`（200）+ `tasksTruncated` |
| `awaitingApproval` | `state == awaiting_approval` 且 `owner == 该成员` | `tasks` 的**子集** |
| `events` | 最近审计（最新在前）| `MAX_MEMBER_EVENTS`（50）+ `eventsTruncated` |

- **为什么不进 `team_snapshot`**：花名册是「每次脉冲都拉一遍」的恒定小载荷；任务行 + 50 条
  事件只在**点开**时拉一次（与 `team_task_detail` 的正文同一条原则，红线 4 的时间维度）。
- **`member` 必须复用 `member_status_view`**：分成第二份推导，同一个人会在花名册与抽屉里得到
  两种「租约剩余秒」/ 两种「取证水位线」，而这类偏差只在数字不对时才被发现。
- **`awaitingApproval` 是 `tasks` 的子集**（同一遍过滤产出，不是第二遍扫板）：它在 UI 上置顶，
  但判据只有一条。前端**不得**自己从 `tasks` 里筛 —— 那样抽屉一折叠/截断「当前任务」块，
  待批块就会静默消失。

#### 事件读法：`actor` 与 `subject` **两边都算**

`store::TeamStore::member_events(team_id, member_id, limit)` 的过滤条件是
`actor = ?2 OR subject = ?2`。少一半就半边瞎：

| 来源 | `actor` | `subject` | 例子 |
| --- | --- | --- | --- |
| 成员自己动手 | 成员 | 任务 / 成员 | `claim` / `update` / `signal` |
| 别人对它动手 | 队长 / `system` | **成员** | `close_member`（队长关了它）、`signal` 的陈旧 seq 判定 |

只按 `actor` 过滤的症状是「队长把它关了」从抽屉里消失 —— 而那恰好是用户最想看到的一句话。

#### 上界在 SQL 里，不在内存里

`ORDER BY id DESC LIMIT ?` 且**多读一行**（`limit + 1`）来回答「还有更早的吗」：

- 事件表**只追加**，一个队跑久了会上万条。`list_events` 的全量读法在「抽屉每秒重取」面前
  不可用（红线 4：单次载荷不大，但每次都大）。
- `truncated` 因此不需要额外的 `COUNT(*)`：多出来的那一行就是证据。
- 顺序用 `id DESC`（`AUTOINCREMENT` = 写入顺序）：按 `at` 排会在同毫秒内给出不稳定顺序，
  抽屉每次重取都会换一遍行序。

**这一条只有一半能靠单测**：`LIMIT` 改成「读全量再 `truncate`」在行为上完全等价，单测全绿。
判据因此是**代码审查 + 集成观察**（判据表见 `.trellis/tasks/…/implement.md` C21），
不许当成「已测过」。

#### 成员归属：从行里读，不从 id 反解

命令签名只有 `member_id`（id 自带 `@{team}` 后缀，但**不拆字符串** —— 红线 12）。团队归属由
`team_member.team_id` 那一列回答，于是「成员属于别的队」不需要调用方判：任务与事件自然只能
从它自己的队里读。未知成员 → `NotFound`（可读信息里带 id）。

#### 前端契约（`MemberDetailDrawer`）

- **两个动作不合并**：点行 → 抽屉；行内「打开终端」→ 直接接管 PTY。合并成一个就得选一个，
  而它们是两个不同的问题（「它在等什么」vs「我去按那个键」）。
- **待批块空则不渲染**，且必须写「Neeko 不代批」：审批发生在成员自己的终端里，面板上没有
  批准按钮；只列一行「待批准」会让用户去找一个不存在的东西。
- **租约走动用抽屉自己的 1s 定时器**（`LEASE_TICK_MS`，`unmount` 清）。全局定时器会让没打开
  抽屉的面板也每秒重渲染 —— 而后端只在**写路径**发脉冲，时间流逝本来就没有事件。
- **失败不清数据**：重取失败保留上一次的 `MemberDetail`，错误另起一条可见文字（闪空比旧数据更糟，
  同 `teamStore.refresh`）。

