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
| `fixtures.rs` | `#[cfg(test)]` 夹具单一源（`Team` / `TeamMember` 全字段）；`store.rs` 的 round-trip 夹具是**刻意例外**（每列都要偏离默认值，否则"某列没写进库"会变绿） | 加字段时只改一处 |

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
- `channel`（怎么**发**）只由 MCP 面决定，`result_channel`（怎么**报**）只由 hooks 决定 ——
  **两列不合并**：`grok` 是「能收不能报」的真实反例（C 档但 `channel = Mcp`）。
- `unverified` 字段是**诚实面**：B 级证据（配置已装、未跑一轮）必须原样回给队长。
- `McpTransport` 的变体集合 = **本仓已实现的传输集合**。加变体必须与它的 bridge 同一个 diff，
  否则 `has_mcp()` 会把一条发不进去的配置宣传成 `channel = Mcp`。
- `McpInjection` 三档的区别是**生效时机**，不是便利性：`Argv` = 启动参数（本次启动生效，
  claude-code / codebuddy / qoder）、`Subcommand` = 该 CLI 自己的 `mcp add`（写配置、下次启动生效，
  grok / codex / opencode / pi）、`ConfigFile` = 直接改配置文件（降级兜底，gemini / reasonix）。
  把「子命令写配置」记成 `Argv` 的后果是执行层传一个 CLI 不认的启动参数 —— **成员起得来，
  MCP 面静默不可见**。代码侧目前只实现 `Argv`，其余两档由执行层明确拒绝。
- 准入表与 `builtin_configs()` 是两个真相源，中间只有一条机器桥：
  `every_admitted_agent_has_an_agent_config`（`dsh` 被拒的理由正是「没有 `AgentConfig`」）。

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

新增工具的清单：`ToolName` 变体 → `ALL_TOOL_NAMES` → `TOOLS`（含 `input_schema`）→
`dispatch_tool` 的 `match` → `authorize.rs` 的 18 格表（编译器与表驱动测试会同时追着你补）。
