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
| `identity/` | `env`（注入）/ `token`（签发与解析）/ `verdict`（归因） | 三者无共同变化理由，故分文件 |
| `admission.rs` | **红线 15 落点**：per-CLI 准入事实表 + 纯函数推导 | P0 实测结果变了 |
| `mcp/schema.rs` | 工具清单（`TOOLS`）与入参 Schema | 新增工具 |
| `mcp/dispatch.rs` | 工具调用：翻译 → 授权 → 入参校验 → 委派 | 工具语义 |
| `mcp/protocol.rs` | 线协议常量（`TOKEN_HEADER` / `ENDPOINT_PATH`）：端点读的与客户端写的同一份 | wire 契约 |
| `mcp/server.rs` | MCP over HTTP（JSON-RPC + header token → 主体） | 协议层 |
| `mcp/principals.rs` | 身份表：`token hash → TeamPrincipal`（从**库**组装） | 凭证模型 |
| `execution.rs` | 执行层：启动计划（纯函数）+ 端口（`MemberExecutor` / `CredentialLedger`）+ 回复副作用映射 | 执行语义（见 §2.2） |
| `delivery.rs` | 投递：通道路由 + 两笔写入协议（纯函数） | 投递协议 |
| `boot.rs` | 域级 boot 入口：独立 loopback listener + 活集合门 | 端点坐标 |
| `authorize.rs` | 授权矩阵（9 工具 × 2 角色 = 18 格，表驱动测试） | 加减工具 |
| `observe.rs` / `deliver.rs` | hook 事件的团队投影 / 投递入口（见 §6） | 新信号 |
| `events.rs` | 前端事件：`TEAM_EVENT` 常量 + 失效脉冲载荷 + `TeamNotifier` 端口（见 §8） | 改事件名 / 载荷 |
| `view.rs` | **视图构造的唯一落点**：`TeamStatusView`（MCP 读者）/ `TeamSnapshot` / `TaskCard` / `TaskDetail`（前端读者） | 加读字段 / 改列载荷（见 §8） |
| `commands.rs` | 本地 Tauri 入口（三条：建队开场 / 快照 / 任务详情），保持极薄（红线 6） | 新入口命令 |
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

| 工具 | 决策层返回 | 执行层（2.5b 接线段）动作 |
| --- | --- | --- |
| `team_spawn` | `ToolReply::MemberCreated`（成员已落库） | 写 MCP 配置 → 起 PTY → 注入 env |
| `team_send` | `ToolReply::NeedsDelivery` | 经 `Pty` / `Mcp` 通道投递字节 |
| `team_close` | `ToolReply::Closed`（已校验的关闭目标） | 关 PTY → 归档成员 |

**理由**：PTY 起不来时成员必须是「已落库、可查询、可清理」的，而不是半生不死的进程；
决策层因此保持纯逻辑 + 可单测（不需要 `AppHandle`）。

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
**端口**，组合根提供唯一 impl；两者之间只隔 `apply_reply` 一行。

| 组成 | 是什么 | 为什么在这一层 |
| --- | --- | --- |
| `plan_member_spawn` | 纯函数：成员行 → `cwd` / `env` / `args` | 全部输入可从库重建，可直测 |
| `MemberExecutor::{spawn, deliver}` | 端口：起进程 / 投递字节 | 端点不该认识 PTY / 项目库 |
| `CredentialLedger::admit` | 端口：签发明文 + **同一动作内**让门接受它 | 拆开就留一个「库里有新凭证、门还不认识」的窗口 |
| `apply_reply` | 回复 → 副作用的**唯一**映射 | 写在 handler 里会漂移，且只能靠发真 HTTP 才能测 |

**`SpawnPlan { cwd, env, args }`** —— 输入全部来自已落库的成员行：

| 字段 | 推导 | 拒绝条件 |
| --- | --- | --- |
| `cwd` | `Workspace::Shared`/`ReadOnly` → 团队根；`Worktree{path}` → 该路径 | 路径不存在；**不在团队根之下** |
| `env` | `identity::member_env(team_id, member_id)` | —（不含凭证） |
| `args` | `AgentAdmission.mcp_argv` 模板，`{{mcp_config}}` 换成配置 JSON | 准入档不是 `Argv`；该 CLI 无 MCP 面 |

**团队根无条件 `canonicalize`**（不只是 worktree 分支）：它是 `starts_with` 判据的信任边界，
未规范化的根会让「落在根内」整体失效，而 `Shared` 成员的 cwd 也会与判据存在两种写法。

两条容易写错的地方：**凭证明文只出现在 `args` 里**（env 会被子进程继承、会进
`/proc/<pid>/environ`），**模板替换只认完整等于占位符的元素**（模板是数据，不是格式化字符串）。
`plan_member_spawn` 会 `canonicalize` ⇒ 调用方必须在阻塞池里调（红线 3）。

**依赖方向**：`execution` 只依赖 `dispatch`（回复形态）、`admission`（per-CLI 数据）与
`mcp::protocol`（wire 常量），**不认识** `mcp::server` / `AppHandle` / `TerminalRouter`。
`server → execution` 是单向的（handler 把结论交出去）—— 线协议常量之所以搬进
`mcp/protocol.rs`，就是为了不让这两者互相依赖。

**`apply_reply` 的顺序是契约**：`admit` **先于** `spawn`。反过来成员的首次工具调用会 401
（它就在那个窗口里刚启动）。`spawn` 失败的错误里**必须带 `member_id`** —— 成员已落库，
丢掉 id 就等于毁掉两相位承诺的「可查询、可清理」。

**`Pty` 投递恒为两笔**：`emit(terminal-input-{id}, text_bytes)` → `sleep(150ms)` →
`emit(..., "\r")`。一次写 `"text\n"` 会被部分 AI TUI 丢弃或误解释（`research/04` 实测）。
走既有事件而不是抢 terminal 的 writer 所有权：terminal 域对团队一无所知。

**通道由 `delivery::route(WorkerChannel, msg)` 决定（纯函数）**：`Pty` → 两笔写入；
`Mcp` / `None` → `Unsupported` + **可行动**的理由（`Mcp` 成员是我们自己的客户端，没有推送
通道，只能走板上派活）。静默「成功」比报错坏得多：队长会继续往下走，而成员从未收到任务。

**身份 env 只能注入 Local PTY**：`TerminalRouter::create_session` 对 WSL / SSH + 非空
`extra_env` 返回 `Unsupported`。静默丢弃的后果是成员「有进程、无身份」，而上报归因失败在团队
上下文里是**拒绝归属** —— 表现为「成员永远不产出」，离家太远。

**环境来自项目，不来自团队**：`Team` 只持久化 `project_path`（它不持凭证，而
`ProjectEnvironment::Remote` 内含 SSH 认证）。执行层用
`AppStateWrapper::project_environment_for_path` 反查归属项目，匹配规则在
`core::project::environment_for_path`（两侧 canonicalize + **最长前缀**，嵌套项目取最具体的
那个）。反查失败一律拒绝 —— 降级成 `Local` 会在本机起一个指向远端路径的 PTY，而那种错在
花名册上看不出来。

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

## 3. 准入表（红线 15 落点）

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
- 准入表与 `builtin_configs()` 是两个真相源，中间只有一条机器桥：
  `every_admitted_agent_has_an_agent_config`（`dsh` 被拒的理由正是「没有 `AgentConfig`」）。

### 3.1 模板占位符（不是字符串拼接）

`mcp_argv` / `add_argv` 是 `&'static [&'static str]` 模板，由 `render_argv` 做**元素内**替换：
`{{mcp_config}}`（JSON 整段）/ `{{url}}` / `{{token}}` / `{{token_env}}`。
**未知或未闭合占位符 → 报错**（静默留字面量等于把 `{{token}}` 当参数发给 CLI）。
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

`authorize.rs` 的 18 格矩阵回答的是「**成员（模型进程）能不能对队友做某事**」—— 那是不可信主体。
`team_snapshot` / `team_task_detail` / `start_team_session` 是**本机用户**的入口，不做 principal 校验
（否则像是漏了授权）；它们也**不得**顺手放宽矩阵里的任何一格。

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
`dispatch_tool` 的 `match` → `authorize.rs` 的 18 格表（编译器与表驱动测试会同时追着你补）。
