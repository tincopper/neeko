# Implement — Multi-Agent 编排（CLI-only）

> 范围：**队长与成员都是 PTY 里的 CLI agent**。Agent Chat 成员延后（见 design §7.4 延期项表）。
> 执行顺序按可独立验收切分。每步先写测试（Red）→ 最少实现（Green）→ 重构（Refactor）。
> 收尾只跑一次 `pnpm check:quick`；开发中的红绿反馈用**单个**测试命令（见仓库 `AGENTS.md`）。

---

## P0 准入实测（不走完不进 P1）

### 0.1 产出 `research/admission-matrix.md`

对 8 个 hook 目标逐一实测（`opencode` / `pi` / `omp` / `claude` / `codebuddy` / `qoder` / `codex` / `dsh`），每个 CLI 三列：

| 列 | 怎么验 | 不合格的后果 |
| --- | --- | --- |
| ① `turn_completed` 是否上报 | 装上 hook，跑一轮，看 `/hook/{source}` 是否到达 | 没有 → **不能当成员**（无完成信号） |
| ② MCP 配置的真实文件与格式 | 找到该 CLI 实际读取的 MCP 配置文件（`mcp_config` 只是路径模板，格式各异） | 没有 → 只能当**一次性工人**（`channel: None`） |
| ③ MCP 客户端支持的传输 | 试 stdio 与 streamable-HTTP | 只吃 stdio → 必须靠 bridge |
| ④ 审批旁路开关写法 | 查 `--help` / 实测 | 决定 `approval_policy = Bypass` 时传什么（R0b.2） |

- [x] **矩阵已产出** → `research/admission-matrix.md`（9 个 CLI 只读探测，2026-10-30）
- [x] `dsh` 记一行：hook-only、无 `AgentConfig` ⇒ 不可被 `team_spawn` 选中
- [x] `omp` 实测判定：**无 MCP 表面**（无 `mcp` 子命令、`config.yml` 无 mcp 键）⇒ **B 档**
- [x] `grok` 改判：有完整 MCP 但无 Neeko hook ⇒ `channel=Mcp` + `result_channel=Sentinel`（**C 档但有 Mcp 面**）
- [x] `gemini` 未安装 ⇒ 未测，记为待补
- [x] 仍需补 A 级证据（配置已装 ≠ 实测上报）：`team_spawn` 落地后抓一次 `/hook/{source}` 真实 payload
      → **已取证（2026-11-03 真实冒烟）**：用户机器上的 `/hook/{source}` 真实载荷证明上报确实到达
      （`neeko.log` 有 `team::deliver source=pi event=turn_completed`），同时暴露了「载荷里没有团队
      env」这个 A 级缺口 —— 见 C22/D2。`team_spawn` 落地**不等于**能上报，两者已被分开取证。
- [ ] 仍需补：codex 完整旁路开关、`pi --approve` 语义、codebuddy/qoder 的 `--mcp-config` JSON 形状（各跑一次最小样例）

**门已通过**（矩阵产出）。P0 带出**四条改变设计的结论**，已同步到 `prd.md` / `design.md`：

1. ⚠️ `DeploySpec.mcp_config` 对 claude 指向 `~/.claude/settings.json`（只有 hooks），
   MCP 实际在 `~/.claude.json → projects[].mcpServers` ⇒ **现有 MCP 市场安装链路对该 CLI 从未生效**（应单独立 issue）
2. ✅ 优先 **`--mcp-config` 启动参数注入**（claude / codebuddy / qoder 实测支持）⇒ `AgentConfig.mcp_injection: Argv | ConfigFile | None`
3. ✅ **HTTP 传输覆盖广**（claude `-H` / codex `--bearer-token-env-var` / opencode `--header` / pi `--url` / grok `-H`）
   ⇒ stdio bridge 降级为兜底
4. ✅ **`channel` 与 `result_channel` 必须分离** —— `grok` 就是反例（能收不能报）

### 0.2 五处裁决已拍板（2026-10-30），本轮只做落地

用户已按建议值全部确认（见 `prd.md` §「已拍板的裁决」）。本步不是决策门，而是**把裁决写进代码**：

- [ ] 代码域命名 `agent::team` / `TeamTask`；UI 文案「团队任务」；**不并入** Tasks 看板（前端目录 `src/features/agent-team/`）
- [ ] 成员不可 `create`，只能 `claim` / `update` / `propose`
- [ ] `neeko-report.mjs` 保持「永远 exit 0」，不加否决权
- [ ] MCP 传输走 **B 方案**（HTTP + `neeko-team-mcp.mjs`）
- [ ] sentinel 一期就做（P1 扫描器 + P2 nonce 注入）

> 这些是常量与命名，不是可选项 —— 后续步骤直接依赖，不再复述。

## P1 协调基质（不接 UI、不接 MCP，可独立测）

> **P1 全部单元已完成**（2026-10-30）：`src-tauri/src/agent/team/` **4332 行 / 85 测试全绿**；
> `cargo test agent::hooks` 166 绿；clippy `-D warnings` 干净；fmt 干净；
> 33 条 Python 护栏全过；不变量 **37 条 / 0 违规**。
>
> **接线（1.5b / 1.6b / 1.7b）按设计推迟到 P2** —— 详见各节说明，理由是需要
> `AppStateWrapper.team_manager`、`team_spawn` 能建成员、以及 flush 闭包包装点。
>
> **实现中被测试逼出的语义问题，已回写 `design.md` §2.2**：
> ① `claim_task` 必须重置取证（否则 t1 的 `Verified` 会延续到 t2）
> ② `observe_signal` 在无在飞任务时不得改写取证（否则迟到的 `turn_completed` 抹掉 L2 裁决）
>
> **两处相对 spec 的偏离（均为安全方向，已在代码注释说明）**：
> - sentinel 的 carry 上限取 `MAX_LINE_BYTES`(2KiB) 而非 `MAX_CARRY_BYTES`(8KiB) —— 单缓冲，
>   carry 恒 ≤ 单行上限，比"两个预算各自管"更难写错
> - 前缀匹配用 `find()`（行内任意位置）而非行首锚定 —— 多出的误命中面由 manager 的
>   `nonce + owner + state` 三重校验挡掉（`research/03` 的四条接受条件）

### 1.1 `agent/team/types.rs` + `lease.rs`（纯函数优先）✅

- [ ] 先写测试：状态迁移表（合法/非法各若干）、租约计算、`reclaim_count > 3 → blocked`
- [ ] 实现 `Team` / `TeamMember` / `TeamTask` / `Workspace` / `WorkerChannel` / `MemberState` / `TeamTaskState`
- [ ] `MemberSignal` 枚举（design §5.6）：**本期唯一为 Chat 预留的形状**
- [ ] `WorkerChannel` / `ResultChannel` / `AdmissionTier` / `ApprovalPolicy` 四个枚举（design §2）
- [ ] `AgentConfig.approval_bypass_args`（**落插件数据**，红线 15：团队代码禁止按 CLI 名分支）
- [ ] 先写测试：`tier` 由能力组合推导（A/B/C 三档各一例），**调用方传入的 tier 被忽略**
- [ ] 不变量测试（纯函数 100% 覆盖）
- [ ] 验证：`cargo test agent::team`

### 1.2 `agent/team/store.rs`（SQLite）✅

- [ ] 先写测试：建表迁移幂等、事务回滚、summary 4KB 截断 + `truncated` 标记
- [ ] 迁移挂在 `common/db/migrations.rs` 既有机制里（不新开连接池）
- [ ] 验证：`cargo test agent::team::store`

### 1.3 `agent/team/completion.rs`（五层判据 → 状态迁移）✅

**参考原型：** `prototype-agent-team.html` 视图 ②（六态徽标契约）—— 这六种状态一个都不能合并。

- [ ] 先写测试：design §6 映射表**逐格**、`Idle` 不升级 `Done`、无 L2 → `unverified`、`Stalled` 文案依据
- [ ] 纯函数：`(MemberState, TaskState, MemberSignal) -> (MemberState, TaskState)`
- [ ] 验证：`cargo test agent::team::completion`

### 1.4 `agent/team/manager.rs`（唯一写入口）✅

- [ ] 先写测试：原子 claim（两成员并发抢同一任务只一个成功）、依赖未满足不可 claim、lease 到期回收、`Done` 只由 owner 或队长 `force_done` 触达
- [ ] `TeamManager` 持内存态 + 落 store；所有迁移经 `completion.rs`
- [ ] 红线 3：任何 `std::fs` / 阻塞调用包 `spawn_blocking`
- [ ] 验证：`cargo test agent::team::manager`

### 1.5a 观察者单元（纯逻辑，不接线）

- [ ] 先写测试：注入一个 `HookEvent{event: "turn_completed"}`，断言成员状态迁移 + 唤醒 waiter
- [ ] 与 `notify::project` **并列**加 `team::observe`（第三路消费者）；不改 `notify` 现有行为
- [ ] `HookEvent.event` → `MemberSignal` 的映射是**纯函数**且单独可测
- [ ] **`seq` 单调去重**（偷自 herdr）：`HookEvent` 增 `seq`，`TeamMember.last_seq` 为水位线，
      序号不大于已接受值的上报**直接丢弃**并记 audit
- [ ] 先写测试：先到 `approval_requested(seq=5)` 后到 `turn_completed(seq=3)` → 后者丢弃，成员仍 `Awaiting`（AC12）
- [ ] 验证：`cargo test agent::team` + `cargo test agent::hooks`（后者防回归）

> **接线留在 P2（1.5b）**，理由是它需要 `AppStateWrapper.team_manager`，而团队表的**持久化挂载点**
> 要和 MCP 生命周期一起定 —— 现在接一次、P2 再改一次，等于两次回归面。
> 接线方式：在 `handlers::route_group` 组合两个 `Deliver` 闭包（`HookEvent` 已是 `Clone`），
> **不改 `dispatch.rs`**（它只服务通知）；团队侧任何错误只记日志，不得影响 204 与通知链路。

### 1.6a env 身份与归因裁决单元（纯逻辑，不接线）

- [ ] `EnvHints` 增加 `team_id` / `team_member_id`（`#[serde(default)]`，缺省 `None` = 现状行为）
- [ ] PTY spawn 注入 `NEEKO_TEAM_ID` / `NEEKO_TEAM_MEMBER_ID`
- [ ] 团队上下文中 env 未命中 → **拒绝归因** + 记 `unattributed`
- [ ] 先写测试（**关键**）：两个成员同 cwd、只有 A 带 env，注入 B 的 `turn_completed` → 断言**不**归属到 A
- [ ] 兼容性测试：`neeko-report.mjs` 契约不变（argv 形状 / 永远 exit 0）
- [ ] 验证：`cargo test agent::hooks`

> **env 注入的接线留在 P2（1.6b）**：`member_env()` 先做出来，`team_spawn` 时真正塞进 PTY env
> 要等成员能建。本期只保证**归因裁决**逻辑正确且不改既有通知行为。

**P1 验收门**：AC2 / AC3 / AC7 —— 无 UI 情况下用 `cargo test` + 一段脚本即可证明。

---

### 1.7a sentinel 扫描器（纯函数，**不接 pump**）

**依据：** `design.md` §5.7 / `research/03-sentinel-channel.md`

- [ ] 纯函数 `SentinelScanner::feed(bytes) -> Vec<SentinelHit>`：有界 carry（≤8KB）、只在 `\n` 切行、单行 ≤2KB
- [ ] 剥 ANSI 后再匹配（复用 `conversation/text.rs` 的正则原语，不新造）
- [ ] 接受条件四条（design §5.7）：nonce / JSON+schema / **task_id owner+state** / executionId 幂等
- [ ] 状态校验放在 `TeamManager`（它持有权威状态），扫描器**不自己判断归属**
- [ ] 接入 `terminal/pump.rs` 的 sink 作为**第二消费者**（不改既有 flush/背压逻辑）
- [ ] 先写测试（五条，全为纯函数）：
      ① 跨两帧切分的行能拼回 ② ANSI 插在 JSON 中间仍能解析
      ③ 回显的模板被 `owner/state` 校验拒绝 ④ 重复 `executionId` 只消费一次
      ⑤ 超长行被丢弃且内存不增（AC13）
- [ ] 红线 4：断言扫描路径**不新增**任何 IPC 载荷 —— 命中只落库，不 emit

**门**：扫描器逻辑全绿后**才**讨论接 pump —— 且接线本身推迟到 P2（P1.7b）。
接线方式：包装 `services.rs` 里构造的 `flush` 闭包（`pump::run` 的 `flush_fn: impl FnMut(&[u8]) -> bool`），
**不要把扫描塞进 pump**（那会动到合流/背压，而 5.2GB 事故就出在那一层）。

## P2 工具面（MCP）

> **进度（2026-10-30）**：2.1a / 2.2 / 2.3a 已完成 —— `agent/team/mcp/{schema,dispatch}.rs` +
> `authorize.rs` + `identity.rs` 追加，**122 个团队测试全绿**（+37），clippy / fmt 干净。
>
> **2.1b 已完成**（D+E 已拍板）：`server/gate.rs` 改多 token（保留 `new()` 行为、`ct_eq` 调用点
> 仍为 1，并新增**源码计数自检**，已用变异验证：插第二个调用点立刻红）；新增
> `agent/team/mcp/server.rs`（JSON-RPC `initialize` / `tools/list` / `tools/call` + `route_group`）。
> 团队测试 **134 绿**、`server::` 38 绿、clippy/fmt 干净。
>
> **一处相对 spec 的实现选择**：`route_group` 放进 `server.rs` 而非单独 `boot.rs` ——
> 它只有 15 行，为一个函数开模块是过度切分（红线 9 精神）。
>
> **一处语义澄清（由失败测试逼出）**：**他队 token 在传输层是合法的** —— 一个 listener
> 服务哪些团队由**组合根**决定，服务端无从得知自己的作用域，因此不能硬编码"拒绝外队"。
> 跨队隔离由 `TeamPrincipal.team_id` 在 `dispatch` 层完成，测试改为
> `outsider_token_is_scoped_by_its_principal_team`（比原来的"拒绝"更强：证明它能拿到
> 自己的队、拿不到别人的）。
>
> 待办：2.1c stdio bridge / 2.4 `team_wait` 阻塞 / 2.5 `team_spawn` 三档准入。

### 2.1a 工具清单 + dispatch ✅ / 2.1b MCP 端点 + 路由组 ✅ / 2.1c stdio bridge

- [ ] `server/` 侧只加 `RouteGroup`，**禁止** import `agent::team`（组合根注入）
- [ ] `FailurePolicy::FailClosed`（交互式客户端必须收到真实错误）
- [ ] `neeko-team-mcp.mjs` bridge：照 `neeko-report.mjs` 的 `include_str!` → 写配置目录 → argv 传 endpoint/token
- [ ] 先写测试：bridge 的 argv 解析、失败时退出码语义（**与 hook shim 不同**：bridge 失败必须非 0，否则 CLI 以为工具成功了）
- [ ] `Pty` 通道写入协议（实测要求，见 `research/04`）：`write_literal(text)` → **间隔约 150ms** → `write(CR)`。
      **禁止**一次写 `"text\n"` —— 部分 AI TUI 会丢弃或误解释同一批里的回车
- [ ] 先写测试：断言两次 write 之间存在延迟；literal 语义（`C-m` 不被当键名）
- [ ] 验证：`cargo test agent::team::mcp` + 手工跑一次 stdio 握手

### 2.2 工具清单与授权 ✅

- [ ] 先写测试：`schema.rs` 工具清单与 `dispatch.rs` 分支**一一对应**（漏一个即失败）
- [ ] 入参校验（`to` 只接队内 id、`task_id` 必须存在且属于本队）
- [ ] 授权矩阵逐格（design §3.2）：成员不能 spawn / create / 冒充队长 / 转交审批
- [ ] 验证：`cargo test agent::team::mcp`

### 2.3a token 签发与解析 ✅ / 2.3b token 签发接线（随 2.5 `team_spawn`）

- [ ] 队长/成员 token 签发；落库只存 hash；团队关闭即失效
- [ ] 凭据落盘收敛：复用 `hooks/ingest/endpoint.rs` 的既有逻辑（它已处理过"每个 `.env` 一份 token"的副本数问题）
- [ ] 先写测试：token → principal 解析、过期失效、跨队 token 被拒
- [ ] 验证：`cargo test agent::team::identity`

### 2.4 `team_wait` 后端阻塞 ✅（2026-10-30）

> `agent/team/wait.rs` 932 行 / 12 测试；`cargo test agent::team` **159 绿**；clippy / fmt 干净。
>
> **相对 design §4.3 补了一处**：原文只有 Satisfied / Timeout 两种结局，漏了
> **目标消亡**。按原设计，队长会为一个永远不会到来的完成白等满 1800s。
> 现加 `WaitOutcome::TargetGone { member_id, .. }`：成员进 `Dead` / `Failed` → 立即返回。
>
> **唤醒形状照 `pi_rpc/process.rs:282-302`**：`notified()` → `pin!` → `enable()`（同步注册）
> 之后才读代数与快照；写入方「先置位、后 notify」。缺任一半都会**每次多等一个 timeout** 且
> 看起来像"agent 慢"。
>
> 两条测试值得单独一提：**真唤醒**条同时卡上界（500ms，timeout 是 2s）与**下界**（15ms）——
> 下界防的是「判据为假导致的立刻返回」也通过；**钉住**条先证明接手者 B 真的 `Verified`
> 再断言 A 的判据仍不可满足，杜绝空断言。

- [ ] 先写测试：`until=declared` 在 `task_update(done)` 时返回；超时返回 `Timeout{snapshot}` **不报错**；多目标 any/all
- [ ] 返回摘要（每成员一行 + 任务状态），**不含 transcript**
- [ ] **按 `member_id` 钉住**被等对象（偷自 herdr）：任务被租约回收并由新成员接手后，旧 waiter **不得**被满足（AC15）
- [ ] `team_send(to, …, wait?)` **原子提交并等待**；目标 `Awaiting` 时返回 `target_blocked` 且**一个字节都不写**（AC14）
- [ ] **阻塞发生在 MCP 工具调用内** —— 这是本设计的核心优势（队长物理上无法边等边干活），测试要断言"工具未返回期间不产生额外轮次"
- [ ] 验证：`cargo test agent::team::wait`

### 2.4b `dispatch.rs` 按工具族拆分 —— **暂缓**（附触发条件）

`neko-check` 提出 `mcp/dispatch.rs` 非测试区 738 行 / 27 函数偏大。**本轮不拆**，理由：

- 内聚单位是「工具族」而非文件长度；当前 27 个函数里 8 个是工具、其余是入参校验，
  平均 ~27 行/函数，**没有胖函数**；
- 拆分要把跨族的校验 helper（`required_str` / `member_of_team` / `resolve` …）搬进第 4 个
  文件，结果是 **4 个文件互相 import 一批 helper** —— 模块边界增加了，耦合没减少。

**触发条件（满足任一再做）**：非测试区 > 900 行 · 出现 > 60 行的单函数 · 第 9 个工具
（`team_spawn`）落地后新增分支仍找不到位置。

### 2.5a `team_spawn`：准入 + 建成员（**决策层**）— ✅ 已完成

> **两相位设计**（与既有 `team_send → NeedsDelivery` 同构）：
> `dispatch` **决定**（准入、成员落库），返回 `ToolReply::MemberCreated`；
> **执行**（签发 token、写 MCP 配置、起 PTY、注入 env）留在 2.5b 的接线段。
>
> 理由：`dispatch` 保持纯逻辑 + 可测；PTY 起来是唯一有进程副作用的一步，把它留在组合根，
> 失败面才收得住（PTY 起不来时成员已落库的状态是可查询、可清理的，而不是半生不死的进程）。

- [x] `admission.rs` 是**红线 15 的落点**：P0 实测结果编码成数据表，`tier_of` / `channel` /
      `result_channel` / `bypass_args` 全是从数据推导的纯函数；源码级护栏
      `per_cli_facts_live_only_in_the_table`（禁比较/`matches!`/`match` 分支形状，
      且每个已准入 id 在生产段恰好出现一次）
- [x] `unverified` 字段诚实列出未确认项，并**原样回给队长**
- [x] 准入表 ↔ `builtin_configs()` 的交叉断言（`every_admitted_agent_has_an_agent_config`）——
      `dsh` 被拒的理由（无 `AgentConfig`）从此是机器判据，不再是 10 行靠人肉对齐
- [x] `McpTransport` 的变体集合 = 已实现的传输集合（删掉未落地的 `Stdio`）
- [x] 入参 Schema 与 dispatch 实际读取的字段逐字对齐（`team_spawn_schema_matches_the_documented_shape`）
- [x] `workspace.path` 入口即要求**绝对**路径（相对路径在 2.5b 会按进程 cwd 解析）
- [x] 入口 sanitize：`name`（无 `@` / 无控制字符 / ≤64）· `model` 与 `workspace.path`
      无控制字符 —— 三者最终进 env / argv / 文件系统，`\0` 在 2.5b 的 `Command::env` /
      `Command::arg` 上会 panic（判据单实现：`reject_control_chars`）
- [x] 工具返回只带**队长能行动的信息**（`member_id` / `tier` / `unverified`）；执行参数
      一律从已落库的成员行推导，不随回复走（红线 14 的输出侧）
- [x] 判据：`cargo test --lib agent::team`（含 `member_row_carries_everything_the_executor_needs`）

### 2.5b-α 组合根接线（团队观察者挂上 hooks）— ✅ 已完成

- [x] `AppStateWrapper.team_manager`（`Arc`，共用 `library_store` 的池）
- [x] 构造走 `TeamManager::load`（**hydrate**）而不是 `new` —— 库是真相源、内存镜像是缓存，
      否则第二次启动读到空花名册且 `add_member` 对库里存在的团队报 `NotFound`
      （判据：`a_restart_hydrates_the_team_domain_from_the_database`）
- [x] `handlers::route_group` 经端口 `ExtraConsumer` 挂第二个消费者，两者共用**同一次**
      `spawn_blocking`、通知在前（装配规则收在 `compose_consumers`，可测）
- [x] 团队侧 fail-open：`team::deliver::observe` 只记日志、不返回 `Result`、不 `panic`

### 2.5c 接线段的六个前置结论（2026-10-31 复审取证，**需拍板 C1 / C3 / C5**）

> 这六条都是**实测代码之后**才看清的：每条都意味着「按原计划写会写错」，不是风格偏好。
> 括号里是取证位置。

**C1 队长从哪来 —— 原形态技术上不成立**

`create_team` 在 `src-tauri/src` 里**没有任何生产调用方**（只有 app_state 的测试），也没有
任何 team 相关的 `#[tauri::command]`；而 CLI 的 MCP 配置是**启动时读取**的 —— 一个已经在跑的
CLI 进程无法被塞进新的 MCP server（`grok mcp add` / `--mcp-config` 都只在启动期生效）。

⇒ 「把已在跑的会话提升为队长」做不到。两个候选：

| 方案 | 代价 |
| --- | --- |
| **A（建议）** 队长也由 Neeko 起 PTY，"提升" = UI 上「以队长身份开会话」 | 与成员同一条执行路径，promote 代码量为 0；代价是队长会话不是用户原来那个 |
| B 把 `neeko-team` 预置进全局 MCP 配置，token 用 hooks 的进程 token | 任何持有 hook token 的进程都能当队长 —— design §3.1b 明令禁止 |

**C2 MCP 注入是**三**档，不是两档**（`agent/team/admission.rs` 的 `McpInjection`）

`Argv` 只对 `--mcp-config <json>` 的三家成立（claude / codebuddy / qoder）。grok / opencode / pi 是
**一次性子命令**（`grok mcp add --transport http …`）写自己的配置，codex 是 TOML + `-c` 覆盖。
现在表里 `grok = Argv` ⇒ 执行层会传一个它不认的参数：**成员起得来、tool 面静默不可见**。

⇒ `McpInjection` 扩为 `Argv | Subcommand | ConfigFile | None`；v1 只实现 `Argv`，其余档在
`team_spawn` 明确 `Unsupported` + 可读理由（红线 14：别声明用不了的能力）。

**C3 `ConfigFile` 注入会污染用户配置文件**（`agent/resource_deployer.rs:379` `merge_mcp_json`）

`deploy_mcp` 直接 merge 进用户的 `~/.claude/settings.json` 之类；而 design §5.5 已记：claude 的
`DeploySpec.mcp_config` 路径**是错的**（MCP 实际在 `~/.claude.json → projects[].mcpServers`）。

⇒ v1 不碰用户配置文件。`ConfigFile` / `Subcommand` 档与「纠正 `DeploySpec` 路径」单独立项，
且必须先有**备份 / 幂等 / 拆除**三件套。

**C4 sentinel 的四条接受条件没有数据模型**（design §5.7 vs `agent/team/types.rs:157`）

§5.7 要求「nonce 绑定 team/member/task/attempt」与「executionId 幂等」，但 `TeamTask` **没有**这两个
字段，派活时也没有注入 nonce 的路径。扫描器（`team/sentinel.rs`，纯函数，已测）算出来的 nonce
无处校验 ⇒ 接线会得到一个「永远丢包」的通道。

⇒ sentinel 接线排到 **P3.5（`neeko-team` skill 部署）之后**，先落 `TeamTask.nonce` +
`team_execution` 表（迁移 v15）。

**C5 tier B/C 成员无 MCP 面（`channel = None`，omp / reasonix）收不到任务**

`has_mcp() == false` 的成员没有任何投递通道（`Pty` 通道也还没落），spawn 出来只会是个
「花名册里能看见、永远不动」的进程。

⇒ 建议 v1 `team_spawn` 对 `has_mcp() == false` 返回 `Unsupported`（理由可读），
等 `Pty` 投递落地再放开 —— 届时要同步改的是档位推导那条判据
`admission::missing_mcp_surface_means_tier_b`（它断言的是 `tier_of` = B，不是“能建”）与
`launchable_agents` 的拒绝面。

**C6 `terminal` 没有 env 参数**（`terminal/manager.rs:91`）

design §5.1 说"不需要新抽象"，实测**不成立**：`create_session(cwd, cols, rows, shell_override,
command, app_handle)` 没有 env 位，而成员身份全在 env 里。

⇒ `create_session` 收一个**不透明**的 `env: &[(String, String)]`（terminal 域不认识 team 词汇，
只做透传）；env 的**装配**留在 `identity::member_env`（纯函数，可测）。PTY 侧不可单测
（需 `AppHandle`），由 `check_unit_tests_spawn_real_binaries` 的既定口径兜底：装配测纯函数，
真实起进程靠集成 / 手测。

#### 落地进度（2026-10-31，不含调用方）

- [x] **C6 `terminal` env 透传** —— `create_session(..., extra_env, ...)`；env 名仍只在
      `identity::member_env` 定义（terminal 域不认识 team 词汇）。附带一条镜像安全属性：
      `TerminalRouter::create_session` 对**非 Local** 传输 + 非空 `extra_env` 直接
      `Unsupported`（WSL/SSH 的 env 注入不到内层 shell，静默丢弃会让成员「有进程、无身份」，
      而归因失败表现为串台，design §5.4）。判据：`identity_env_is_only_injectable_on_the_local_path`
- [x] **`agent/team/execution.rs`：`SpawnPlan` 纯计划层** —— `plan_member_spawn(team, member,
      mcp_url, token) → SpawnPlan{cwd, env, args}`。三种拒绝：无 MCP 面 / 注入档不是 `Argv` /
      worktree 落在团队根之外（红线 8，两侧 canonicalize 后比较）。10 条测试
- [x] **`admission.mcp_argv` 数据列** —— `Argv` 三行（claude-code / codebuddy / qoder）的启动
      参数模板含 `{{mcp_config}}`；其余档为空。判据
      `injection_gear_and_its_data_column_live_and_die_together`（档位与数据列同生共死）
- [x] **`agent/team/delivery.rs`：`Pty` 投递** —— `pty_write_plan` 恒为两笔（正文 literal +
      单独 `\r`，间隔 150ms），走既有 `terminal-input-{id}` 事件（不抢 terminal 的 writer 所有权、
      事件名同源）。判据 `the_message_and_the_enter_are_two_separate_writes`（AC14 后半）

#### C7 监听器 mount 的授权缺口 — ✅ 已按方案 A 落地（2026-10-31）

`server::AuthGate::with_tokens` 装载的是**明文 token 集合**（`ct_eq` 逐项比），而团队域
`issue_token` **只落 sha256**、明文只返回一次。方案 A：**门里做摘要后查表**。

- [x] `server/gate.rs`：`CredentialExt::extract` 改返回 `Cow<'a, [u8]>`（不摘要的路径仍零拷贝）；
      摘要**编码由集合变体携带**（`ExpectedTokens::{Plain, Sha256HexShared}`），不单列
      `digest` 字段 —— 两字段能拼出「活集合 + 明文」这种无意义组合。
      `ct_eq` **调用点仍为 1**（`constant_time_comparison_has_exactly_one_call_site` 仍绿）；
      hooks 的 `new` / `with_tokens` 行为逐字不变（仍是明文比较、零锁）
- [x] 编码同源：`sha256("abc")` 的已知十六进制被钉住（大写 / 裸字节 / 前缀都会让门对所有成员恒拒）
- [x] `agent/team/mcp/principals.rs`：`principals_from(manager)` 从**库**组装身份表
      （`token hash → TeamPrincipal`），**过滤空 hash**（空串是一把空钥匙）；
      `token_hashes()` 给出门的期望集合（排序，遍历顺序不随 HashMap 抖动）
- [x] 端到端判据（C7-A 的机器形式）：`issue_token` → `principals_from` → `with_shared_hashed_tokens`
      → 明文能过、**hash 本身被拒**、轮换后旧明文立即失效
      （`a_gate_built_from_the_principal_table_accepts_the_issued_token` /
      `rotating_a_credential_invalidates_the_previous_plaintext`）

#### C8 门的期望集合是绑定在 serve 时 — ✅ 已按方案 A 落地（2026-10-31）

`AuthGate.expected` 原本是 `Vec<String>`，`serve()` 按值拿走 ⇒ 团队端点启动后无法增删 token。
而团队是活的（promote → spawn → 轮换 → 关队）。

- [x] `AuthGate.expected` → `enum ExpectedTokens { Plain(Vec), Sha256HexShared(SharedTokenSet) }`：
      hooks 走 `Plain`（**仍然零锁**），团队走 `Sha256HexShared`。变体自带「锁行为 + 编码」，
      非法组合在类型上不存在
- [x] `SharedTokenSet`（`Arc<parking_lot::RwLock<Vec<String>>>`）：`replace()` 整体替换、
      `snapshot()` 供诊断。整体替换而非增删单条 —— 调用方本来就持有完整的一份表
- [x] `AuthGate::with_shared_hashed_tokens` 是团队形态的**唯一**构造器（不存在「定值 + hash」
      版本：它只会被测试用，多一个 `pub` 就多一个被生产代码选错的机会 —— 选错的症状是
      「所有成员恒拒」）。判据 `a_shared_token_set_takes_effect_after_the_gate_is_built`
      （同一个门实例：轮换后旧明文立即失效、新集合立即生效）
- [x] `parking_lot` 不中毒 ⇒ `authorize` 仍零 panic；`ct_eq` 调用点仍为 1

#### 团队端点 boot — ✅ 已落地（2026-10-31，未接组合根生命周期）

`agent/team/boot.rs`：`boot(runtime, manager, executor) -> TeamServer`

- [x] bind `127.0.0.1:0`（端口由 OS 分配）；`endpoint_url()` 是**唯一**的 URL 拼装点
      （loopback 而非 `localhost`：后者可能先解析到 `::1`，而 listener 只绑 IPv4）
- [x] 身份表**从库**组装（`principals_from`，过滤空 hash）→ `SharedTokenSet::new(token_hashes)`
      → 门装活集合
- [x] `TeamServerState::refresh_credentials()`：**先**重建身份表并写入共享表，**再**替换门的
      期望集合（反过来会留一个「门放行但查不到主体」的窗口）。**唯一写入点**是
      `CredentialLedger::admit` —— `TeamServer` 刻意**不**暴露 `refresh()`
- [x] **超时预算与 hooks 不同**：`REQUEST_TIMEOUT = WAIT_TIMEOUT_MAX_SECS + 60`。引擎的
      `request_timeout` 一旦小于 `team_wait` 的等待上限，队长会收到 408，而
      「超时是结果不是错误」是本设计的核心语义（判据：`team_wait_times_out_without_an_error`）
- [x] body 上限 1 MiB（`task_create.body` 是派活 prompt，比 hooks 的 64 KiB 大得多；
      仍远低于红线 4 的 2 MB —— `ToolReply` 全是小载荷）
- [x] 读库失败**不降级成空表**（空表 = 谁都进不来，像"所有成员都没权限"，更难排查）
- [x] 判据：`boot_binds_a_loopback_port_and_exposes_its_url` /
      `admitting_a_credential_makes_it_reachable_through_the_gate`

**仍未接**：`AppStateWrapper` 持有 `TeamServer` + 关闭协议里停机（下一项）。

#### 组合根生命周期 — ✅ 已落地（2026-10-31）

- [x] `AppStateWrapper.team_server: Arc<Mutex<Option<TeamServer>>>`（**不合并进 `http_server`**：
      两个端点各有自己的门与失败策略，共用一个 handle 会让「谁在哪个端口」变回隐式知识）
- [x] `app::boot` 在 hooks 之后 boot 团队端点；**起不来只记日志**（团队功能不可用，
      但 hooks 那条常开路径与整个应用不该跟着受影响）
- [x] `set_team_server` / `team_endpoint_url()`：URL 拼装点唯一。凭证同步**不**在组合根
      （`CredentialLedger::admit` 一次做完签发 + 认门，见 C7/C8）
- [x] 关闭协议新增 `team-http` 清理任务（`TeamServer::stop` 消费自身；不 graceful 会把退出
      拖到在途 `team_wait` 的超时）
- [x] 判据：`team_endpoint_url_is_none_until_the_endpoint_boots`（端点没起来时执行层拿到
      `None`，而不是拼一个空 URL 写进成员配置）

#### 执行层端口的**接线** — ✅ 已落地（2026-10-31，生产实现待做）

- [x] `execution::{MemberExecutor, CredentialLedger}` 两个端口（`spawn(member_id, token)` /
      `deliver(member_id, message)` / `admit(member_id)`）+ `TeamServerState.executor`（**必填**：
      组合根没有「构造执行者失败」这种状态，留一个 `None` 分支只会撒谎 —— 测试用
      `fixtures::NoopExecutor` 打底）
- [x] 回复副作用收进 `execution::apply_reply`（**唯一映射**）：`MemberCreated` → `admit` **再**
      > ⚠️ **已被 C24 取代**：`apply_reply` 删除，改为 `Effect` / `apply_effect`（执行层不再认识 `ToolReply`）。
      `spawn`（反过来新成员第一次调用就 401）；`NeedsDelivery` → `deliver`。
      `spawn` 失败的错误里**带 `member_id`**（成员已落库，丢 id = 毁掉「可查询、可清理」）
- [x] 判据：`starting_a_member_admits_first_then_spawns_with_that_token` /
      `a_failed_spawn_keeps_the_member_id_in_the_error` /
      `a_created_member_is_handed_to_the_executor` / `a_sent_message_is_handed_to_the_executor` /
      `the_needs_delivery_payload_uses_the_documented_wire_keys`（wire 键集只剩 `to`/`text`，C24 后）

#### C9 成员启动**不能**走 shell 命令行（红线 2 的落点）

`terminal::create_session` 的 `command: Option<String>` 是**一段 shell 命令行**（`build_task_command`
→ `cmd /c` / `sh -c`）。成员启动要带 `--mcp-config '{"mcpServers":…}'`，那是含引号与空格的 JSON：

- 走 shell 就必须引号转义，而 `common::utils::command::quote_shell_arg` 是 **POSIX 专用**
  （`'…'` + `'\''`），在 `cmd /c` 下语义不同 ⇒ 直接踩红线 2；
- 就算引对了，JSON 里的 `"` 在不同 shell 下的转义规则也不一致。

⇒ **成员必须用 argv 启动**（不经 shell）。落地形状：`create_session` 的启动参数从
`Option<String>` 改成 `Option<TerminalLaunch>`，其中

```rust
pub enum TerminalLaunch {
    /// 任务终端：一段 shell 命令行（平台 shell 差异由 `platform::shell_launch` 处理）。
    Shell(String),
    /// 需要精确 argv 的调用方（团队成员）：直接进 `CommandBuilder`，**无引号规则**。
    Argv(Vec<String>),
}
```

调用点只有 3 处（`terminal/commands.rs`、`router.rs`×2），全部传 `Shell`；团队成员走 `Argv`。

#### 落地进度（执行层，2026-10-31）

- [x] `TeamManager::set_member_terminal(member_id, terminal_id, now)`：回填 `terminal_id`
      （内存镜像 + 库同锁内一起改，**允许覆盖** —— PTY 重试会拿到新 session id；审计记
      `bind_terminal` 与前后 id）。判据：`binding_a_terminal_updates_mirror_and_store` /
      `binding_rejects_an_empty_id_and_an_unknown_member`

#### C9 `TerminalLaunch::Argv` — ✅ 已落地（2026-10-31）

- [x] `terminal::manager::TerminalLaunch::{Shell, Argv}`；`create_session` 收枚举
- [x] `Shell` 走 `platform::shell_launch::build_task_command`（平台 shell 差异不变）；
      `Argv` 直接 `CommandBuilder::new(program).args(rest)` —— **没有引号规则，也没有平台分支**
- [x] 空 argv → `InvalidInput`，校验点在**域边界** `TerminalRouter::create_session`
      （`manager` 只能返回 `anyhow`，会被归成 `Unknown` —— 编程错误报成未知错误会让排查跑偏）
- [x] 入参收成 `SessionSpec` 值对象（9 个位置参数里三个是 `Option`/切片，`&[]` 读不出语义）

#### C13 注入四档：`ConfigDir` + codex 改走 argv — ✅ 已落地（2026-10-31）

**动机（用户实测）**：队长选 `pi` 被早拒 —— `Subcommand` 档没实现，而 `Argv` 只盖了
claude-code / codebuddy / qoder。**影响面是四个 CLI**（codex / grok / opencode / pi），不是一家。

**两条路都是实测走出来的（命令与输出在报告里）**：

- **`pi` → 新增 `McpInjection::ConfigDir`**：`PI_CODING_AGENT_DIR` 把整个配置目录重定向到隔离目录，
  再用 **pi 自己的** `pi mcp add --url … --header KEY=VALUE` 写进去 —— 用户全局 `mcp.json`
  **未被创建**（实测校验）。隔离目录里用 symlink 镜像用户资产（`auth.json` / `models.json` /
  `settings.json` / `trust.json` / `extensions` / `skills` / `themes`），`pi -p` 仍能登录并回答。
- **`codex` → 改判 `Argv`**：`-c mcp_servers.neeko.url="…"` + `-c mcp_servers.neeko.bearer_token_env_var="NEEKO_TEAM_TOKEN"`，
  `codex mcp list` 里能看到 `Auth = Bearer token`，且 `config.toml` 未被改动 —— 纯 argv，不写文件。

落地：

- [x] `render_argv`：元素内替换 `{{mcp_config}}` / `{{url}}` / `{{token}}` / `{{token_env}}`；
      未知或未闭合占位符**报错**（旧实现只认「整元素等于占位符」，`--header KEY={{token}}` 会原样发出去）
- [x] `SpawnPlan.credentials_env`：唯一含密通道，且**只由模板里的 `{{token_env}}` 触发**（不是 `agent_id` 分支）
- [x] `ConfigDirSpec { env, mcp_file, add_argv, home_subdir, mirror }` 挂在准入行（红线 15）；
      `McpInjection::ConfigDir` 本身**不带负载**（它同时是持久化列与 `static` 数据）
- [x] `execution::ConfigDirPlan`（纯）+ `app/team_executor::provision_config_dir`（副作用，阻塞池）：
      mkdir → symlink 镜像 → `core::exec` 跑 `mcp add` → 同一个 env 起 PTY；**任一步失败删目录**
      （里面有 token 明文）；成功则留给关队命令
- [x] `launch_refusal()` 是唯一判据：`team_spawn` 写库前、执行层起进程前、`team_launchable_agents`
      （面板 CLI 清单）三处都问它
- [x] 面板：被拒 CLI **禁用 + 理由作为可见文字**（`title` 不行：被拒行不可聚焦）；前端不再维护
      「enabled + 有 command」的第二套判据
- [x] 判据：`pi_add_argv_is_the_verified_key_value_form` / `codex_argv_is_the_verified_config_override` /
      `codex_plan_puts_the_token_into_the_credentials_env_only` / `render_refuses_unknown_and_unclosed_placeholders` /
      `a_failed_add_command_removes_the_isolated_directory` / `the_mirror_source_is_canonicalized` /
      `launch_refusal_admits_the_implemented_gears_only`（各自变异验证过）
- [x] `#[ignore]` 真实冒烟（装了 pi 才跑）：`pi mcp add` → 隔离目录出现 `mcp.json`、用户全局目录未被创建

**仍缺（下一批）**：

- [ ] `grok` / `opencode` 仍是 `Subcommand`（写用户全局配置）—— 要分别找它们的配置目录重定向变量
      （opencode 可能是 `XDG_CONFIG_HOME`，未实测）；找不到就按 C3 维持拒绝
- [ ] 关队命令里的隔离目录清理（现只在失败路径删）
- [ ] `pi` 首次启动的 `npm install` 代价已通过镜像 `npm` / `bin` / `models-store.json` 消除（实测 ~6s，
      与用户自己开 pi 同量级）；若将来发现并发写缓存的问题，退回冷启动的代价是 ~10s + 需要网络

#### 执行者的生产实现 — ✅ 已落地（2026-10-31）

`app/team_executor.rs`：`PtyMemberExecutor`（`MemberExecutor` 的唯一 impl，由 `app::boot` 注入）

- [x] `plan_member_spawn` → `create_session(..., Argv)` → `set_member_terminal` 三步
      （凭证由端点的 `admit` 签发后作为参数传入，执行层不再自己签）；碰库 / `canonicalize`
      的全部进 `spawn_blocking`（红线 3）
- [x] **环境来自项目**：`AppStateWrapper::project_environment_for_path` 反查（`Team` 只持久化
      `project_path`，不持凭证）。匹配规则在 `core::project::environment_for_path`（两侧
      canonicalize + 最长前缀）。反查失败一律拒绝 —— 降级成 `Local` 会在本机起一个指向远端
      路径的 PTY
- [x] 端点没起来时**拒绝**启动（给成员一个空 URL = 花名册上看起来正常但连不上工具面）
- [x] 启动 argv = `AgentConfig.command` + 准入表的 MCP 参数 + `Bypass` 的 per-CLI 旁路开关
- [x] 放在组合根而非团队域：它要同时认识 `AppStateWrapper` / `AppHandle` / 端点 URL，
      放进团队域会让 `team → app_state → team` 成环

**C10 — ✅ 已收敛**：程序名改为读 `AgentManager::get_agent`（含 `agentCommandOverrides`），
不再查 `builtin_configs()`。查不到仍 `Unsupported` 拒绝（**不**拿 id 当程序名猜）。

#### C5 `team_spawn` 早拒「起得来但用不了」的 CLI — ✅ 已落地（2026-10-31）

- [x] `AgentAdmission::launch_refusal() -> Option<String>` 是**判据的单一源**：
      `mcp::dispatch::spawn`（建成员**之前**）与 `execution::plan_member_spawn`
      （执行前再确认）都问它。两处各写一遍的后果不是重复，而是**漂移** —— 早拒放行、
      执行层才拒绝，表现就是「成员落库但永不启动」，而队长以为它已开工
- [x] 拒绝理由可读且**点名注入档**（AC7b）：`omp` → `no MCP surface`；
      `grok` → `injects MCP via Subcommand …`
- [x] 判据翻转了两条测试：`tier_b_agent_is_refused_before_a_member_row_exists`（断言拒绝
      路径上**没有**成员行）/ `tier_c_agent_with_mcp_is_still_refused_until_its_injection_lands`
      （表的事实保留：grok 是 C 档但**有工具面** —— 档位与注入方式是两列，不能互相推）
- [x] 变异验证：删掉早拒 → 两条测试立刻红

#### C1 队长入口：「以队长身份开会话」 — ✅ 已落地（2026-10-31，方案 A）

`agent/team/bootstrap.rs`（纯计划）+ `agent/team/commands.rs`（极薄命令）

- [x] `plan_team(agent_id, project_path, name, team_id, now) -> TeamBootstrap{team, lead}`：
      拒绝三种情形（不在准入表 / `launch_refusal` 命中 / 项目路径非绝对），**全部发生在
      写库之前**
- [x] 队长与成员**同形**：`channel` / `result_channel` / `tier` / `mcp_injection` 全来自
      准入表（判据 `a_leads_channels_follow_the_admission_row` 遍历三个 Argv 行 —— 写死
      一条 claude-code 的断言证明不了「没有硬编码」）
- [x] `TeamManager::create_team_with_lead(team, lead)`：**一次写入**
      （`create_team` + `add_member` 两步之间失败会留下「没有队长」的团队，而那种团队
      看起来和正常团队一样）。拒绝条件与两个单步方法共用私有 helper
      `insert_team` / `insert_member`，规则只有一份
- [x] `set_member_terminal` 在绑定**队长**时同时写 `Team.lead_session_id`
      （两处各写一遍会漂移；它正是「这个团队由哪个会话开创」的唯一线索）
- [x] `start_team_session(agent_id, project_path, name?) -> TeamSession`：
      端点/凭证面缺失 → 先拒 → canonicalize（阻塞池）→ `plan_team` →
      `create_team_with_lead`（阻塞池）→ **`execution::apply_reply`**
      （与成员完全同一条执行路径：`admit` → `spawn` → 回填句柄）
- [x] `TeamServer::credentials() -> Arc<dyn CredentialLedger>`：只交出**端口**，
      `admit` 仍是唯一的「签发 + 认门」写入点（不开第二个刷新入口）
- [x] `AppStateWrapper::team_credentials()`：与 `team_endpoint_url()` 同一个前提
      （没有端点就没有工具面 ⇒ 不该发凭证）
- [x] 变异验证：去掉队长角色校验 / 去掉 `lead_session_id` 同步 → 各自变红

#### C11（新，小）队长 bootstrap 的残余失败面

`create_team_with_lead` 成功而 `apply_reply` 失败时，库里留下「有队长行、无进程」的团队。
那是两相位设计**刻意接受**的可查询状态（同 `team_spawn` 的失败语义），缺的是一条
「重试起进程」的入口（`respawn_member(member_id)` = `apply_reply` 一次）。
**不做自动回滚**：回滚会删掉用户刚建的队，而失败原因可能只是 CLI 二进制没装。

#### C12 CLI 成员的入站通道 = `Pty` — ✅ 已落地（2026-10-31，用户裁决 A）

**问题**：`admission.channel()` 按「有 MCP 面 ⇒ `Mcp`」推导，而 `delivery::route` 对 `Mcp`
明确拒绝 —— 合起来等于**队长无法给任何成员派活**。不是实现缺失，是通道语义错了：
MCP over HTTP 是客户端发起的，没有 server→client 推送，工具面里也没有收件箱。

- [x] `WorkerChannel::CLI_MEMBER = Pty`（**常量**，不是 per-CLI 推导）：CLI 成员的进程就在
      PTY 里，唯一能把字送进它回合的是 stdin
- [x] 删掉 `AgentAdmission::channel()` —— 它不是 per-CLI 事实。`result_channel`（由 hooks 决定）
      与 `has_mcp`（工具面）才是表的两列，仍然不合并（grok 是「有工具面但报不上来」的反例）
- [x] `dispatch::spawn` / `bootstrap::plan_team` 都用常量；夹具同步（夹具偏离生产会让
      「通道对不对」这类断言永远测不到真实值）
- [x] 判据：`a_spawned_member_is_deliverable_over_its_pty`（建出来的成员能排出一次真实写入；
      变异：把常量改成 `Mcp` 立刻红）
- [x] `delivery::route` 的 `Mcp` / `None` 两支保留并注明**谁还会走到**：将来的 Chat 成员、
      本轮之前落库的历史行、无工具面的历史行
- [ ] 仍然缺：`Mcp` 变成真通道时（Chat 成员，`SessionRequest`）要同步解除那一支的拒绝

#### 租约回收的驱动器 + 续期 — ✅ 已落地（2026-10-31，AC3）

**取证**：`reclaim_expired` 在此之前**零生产调用方** ⇒ 成员被 `kill -9` 后任务永远停在
`in_progress`，租约的「防死锁」从未真正发生。

- [x] `agent/team/reaper.rs`：`TeamReaper::start(runtime, manager, interval)`（默认 30s）
      + `stop()`（`abort`：每拍是一次原子 `reclaim_expired`，中止不产生半个状态）
- [x] **为什么不是惰性 sweep**（读写命令前扫一遍）：AC3 的关键场景正是「没人调命令」——
      队长阻塞在 `team_wait` 里等一个已经死掉的成员，惰性 sweep 永远等不到触发者
- [x] 组合根：`app::boot` 在团队端点之后起（**与端点独立** —— 端点可能起不来，而租约
      回收与 MCP 面无关）；`AppStateWrapper.team_reaper`；关闭协议 `team-reaper`
- [x] **上线即暴露的缺陷：租约没有续期** ⇒ 健康的长任务（>30min）会被回收抢走、有在飞任务
      却把 `reclaim_count` 往上加，四轮后进 `blocked`。补 `manager::renew_lease`：
      owner 的 `task_update` + **活性信号**续期；`MemberSignal::is_liveness()` 是判据单一源
      （`exited` / `failed` **不**续期 —— 否则「成员已死」还要再等满一个 ttl）
- [x] 判据：`expired_leases_are_reclaimed_without_any_caller` /
      `stopping_the_reaper_stops_the_loop` / `an_owner_update_renews_the_lease` /
      `a_hook_signal_from_the_owner_renews_the_lease` /
      `a_death_signal_does_not_renew_the_lease` / `a_silent_task_still_expires`
      （四条变异各自变红）
- [ ] 仍缺：`Stalled` 的「静默超阈值」判据（L3）—— 同一个循环就是它的家，但需要先定阈值
      与「静默」的口径（最后一次任意信号？最后一次活性信号？）

#### C14 角色 preamble：让队长知道自己是队长 — ✅ 已落地（2026-10-31）

**这是「团队玩不转」的真实原因（用户实测）**：队长起来时 argv 里只有 MCP 注入参数与旁路开关，
没有任何角色上下文 —— 它不知道 team_id、不知道有 `task_create` / `team_spawn` / `team_wait`、
更不知道「不许自己动手」。表现是一个普通会话，而不是一个不工作的团队（更难发现）。

- [x] `identity::preamble(role, team, member, members)` 纯函数，两份文本（队长 / 成员）；
      工具清单**从 `TOOLS` 派生**；可 spawn 的 CLI 来自 `options_for(...)` 的池子
- [x] `AgentAdmission.prompt_argv`（第五列）+ `{{preamble}}` 占位符（缺值报错，不退化成空串）
- [x] 注入形态逐家实测后落数据：`claude-code` / `qoder` / `codebuddy` / `pi` 用
      `--append-system-prompt`，`opencode` 用 `--prompt`，`codex` 用位置参数；其余为空（不能当队长）
- [x] 验法是**零成本的**：未知开关与不存在的 `--model` 退出签名不同 —— 前者证明「flag 不认识」，
      后者证明「argv 被完整解析」。这条方法论值得复用（已写进 spec §3.6）
- [x] `lead_refusal()` = `launch_refusal()` + 「能收到 preamble」；`refusal_for(role, id)` 在准入域选路
      （**不复制判据**），`team_launchable_agents(role)` 因此能回答队长那个问题
- [x] 判据：`preamble_is_derived_from_the_tool_table` / `the_lead_preamble_forbids_doing_the_work_itself` /
      `the_worker_preamble_requires_claim_and_done` / `the_preamble_never_carries_the_credential` /
      `a_lead_spawn_appends_the_preamble_argv` / `a_cli_without_a_preamble_cannot_be_a_lead`

#### C15 团队组成配置 + `team_options` — ✅ 已落地（2026-10-31）

「其他 agent 的配置怎么分完全没有配置」（用户原话）。裁决 **C**：用户在面板配「池子 + 上限 + 默认」，
队长只能在池内 spawn。

- [x] `Team` 五个配置列（迁移 **v15**，逐列幂等；v14 旧行仍可 hydrate）：
      `allowed_agent_ids`（空 = 不限制）/ `default_model` / `default_workspace` /
      `default_approval_policy` / `max_members`（[1, 8]，默认 4）
- [x] `options.rs::options_for(team, member_count)` 纯函数 = **唯一推导**，三个消费者：
      面板命令 `team_options`、MCP 工具 `team_options`、`plan_member_spawn` 的 preamble
- [x] `team_spawn`：池外拒绝（错误里列池子）、超限拒绝（带数字）、缺省从团队行读
      （model / workspace / approval）；`workspace` 从 schema 的 `required` 移除
- [x] 构造期校验（写库之前）：池内不可启动 / 上限越界 / worktree 越界 → 拒绝，**不静默过滤**
- [x] 判据：`a_spawn_outside_the_team_pool_is_refused_with_the_pool` /
      `the_member_limit_is_enforced_and_the_lead_does_not_count` / `spawn_defaults_come_from_the_team_row` /
      `team_options_is_the_same_derivation_as_the_panel` / `the_lead_preamble_only_advertises_the_teams_pool` /
      `a_v14_team_row_upgrades_to_the_documented_defaults`

#### C16 面板的团队配置区 — ✅ 已落地（2026-10-31）

- [x] 配置区（`TeamConfigSection` + `useTeamConfigDraft`）：成员池多选（不可启动项禁用 + 理由可见）、
      上限、默认 workspace（v1 只给 `shared` / `read_only`）、默认审批（`bypass` 有**按下之前**可见的警示）、
      默认 model（留空 = CLI 自己的默认）
- [x] **默认值只来自 `team_options(null)`**，前端不写死 4 / shared / queue；只提交**改过的**字段
      （否则前端对默认值的理解会变成承重结构）
- [x] 判据：`挂载时拉 team_options(teamId: null)，表单初值全部来自它` /
      `取消勾选一个成员再提交：config 只含 allowedAgentIds` / `上限越界（0 / 9）：即时报错，且不调用 …`

#### C17 `cn()` 把字号 token 当颜色丢掉 — ✅ 已修复（2026-10-31）

`text-micro` / `text-meta` / `text-ui` 是 `@theme inline` 的字号，但 `tailwind-merge` 只认识 Tailwind
自带的阶梯，把它们归进**颜色**组 ⇒ `cn('text-meta', 'text-text-secondary')` 只留颜色，写了字号却不生效。
全仓 `cn()`/`cva()` 里同时写两者的 4 处（含面板主按钮）。

- [x] `src/lib/utils.ts` 用 `extendTailwindMerge` 把阶梯登记进 `font-size` 组；`src/lib/__tests__/utils.test.ts`
      逐档断言，并保留「同组冲突仍然后者胜出」的反向用例
- [x] **加字号 token 必须同步这处**（`tailwind.css` 的 `@theme inline` 一行 ↔ `FONT_SIZE_TOKENS` 一行）

#### C18 关闭协议 + 团队清单（后端） — ✅ 已落地（2026-10-31）

此前 `mcp/dispatch.rs::close` **只做校验**：不关 PTY、不迁移状态、整队关闭直接 `Unsupported`；
也没有「有哪些队」的读路径（重启后团队会 hydrate，但用户看不到、也重不开）。

- [x] `execution::plan_close`：**决策层**（校验 + `begin_team_close` / 单成员校验 + `close_request` 审计），
      两个入口共用 —— MCP 工具（有 principal，走授权矩阵）与本地面板命令（无 principal）
- [x] `MemberExecutor::close` 端口 + `PtyMemberExecutor` 实现（走 `TerminalRouter::close_session`，
      红线 1；「本来就没有进程」与「已关过」都算成功 = 幂等）
- [x] 执行顺序（design §7.1）：**先关进程，再归档成员** —— 反过来会留「成员已 Dead、PTY 还活着」，
      那是会撒谎的状态（反例测试 `a_member_whose_process_survives_is_not_archived`）
- [x] `TeamManager`：`finish_member_close`（Dead + **作废凭证** + 在飞任务回 `pending`，
      **不动 `reclaim_count`**）/ `begin_team_close` / `finish_team_close`
- [x] `Closing` 期间只允许读（`team_status` / `task_list` / `team_list` / `team_close`），
      其余 `Conflict` 并带当前状态与允许清单
- [x] `team_list`：`TeamSummary` + `MAX_LISTED_TEAMS = 50` + `truncated`（红线 4：历史团队会累积）；
      `member_count` 不含队长、含已 Dead 成员（与上限判据同源）
- [x] Tauri 命令 `team_close` + `ClosedReply`（**扁平**，不背 MCP 信封 `{"closed": …}`；
      `membersFailed` 是二元数组）
- [x] 诚实面写进 `notes`：`graceful` 本期不兑现（PTY 没有关闭协议）、队长自身 PTY 不由本次关闭、
      worktree **一个都不删**（零 fs 操作，只把路径记进 notes）
- [x] 判据：`a_partially_closed_team_stays_closing` /
      `finish_member_close_archives_and_releases_without_touching_reclaim_count` /
      `closing_a_member_revokes_its_credential_before_the_gate_is_rebuilt` /
      `a_member_that_died_without_being_archived_still_holds_a_usable_credential`（反例）/
      `a_closing_team_refuses_writes_but_answers_reads` / `the_team_list_is_bounded_and_flagged`

#### C19 团队列表 + 关闭团队（面板面） — ✅ 已落地（2026-10-31）

后端 `team_list` / `team_close` 见 C18，本轮补前端 + 测试。

面板此前只有「当前打开的这个队」：app 重启后团队会从库里 hydrate，但用户看不到、也关不掉。
后端 `team_list` / `team_close`（C14）已在，本轮只补前端 + 测试。

- [x] 类型镜像 `TeamSummary` / `TeamList` / `ClosedReply`（`membersFailed` 是 **二元数组**，
      不是对象 —— Rust 侧 `Vec<(String, String)>`）
- [x] `fetchTeamList()` / `closeTeam(teamId, memberId?)`：`memberId` 显式传 `null`（整队关闭），
      **不传 `graceful`**（省略 ⇒ 后端取 `true`，而 `true` 已在 `notes` 里声明未兑现）
- [x] 面板空态 = 队长入口 + **已有团队**列表（三态徽标不合并 / 成员数与任务 open-total /
      项目根末段 + 完整路径进 title / 创建时间 / `truncated` 提示 / 加载中不显示空态）
- [x] 行操作按状态分：`active` / `closing` → 打开 + 关闭；`closed` → 只有「查看」（只读快照）
- [x] 已打开的队：头部「关闭团队」（二次确认，文案对齐 `close_notes` 四条 + 在飞任务回 `pending`）、
      `closing` 横幅 + 「重试关闭」、`closed` 不显示关闭
- [x] 「返回列表」只切视图**不清 store**（`browsingFrom` 派生，随换队/关闭自动复位）
- [x] 关闭成功才清 store；失败**不清**（团队停在 `closing` 是可查询、可重试的事实），
      并重取快照 + 列表
- [x] 判据（`components/__tests__/TeamPanel.teamList.test.tsx`，14 例）：三态徽标互不相同 /
      行数据来自载荷 / 截断提示正反例 / 打开即 `openTeam(该行 id)` / 二次确认后才 `team_close` /
      成功清 store + 重取列表 / 失败不清 store + 原文可见 + 双刷新 / `closed` 无关闭按钮 /
      `closing` 横幅 + 重试 / 空列表·加载中·失败重试三分 / 返回列表不清 store
- [x] 变异验证（改坏 → 红 → 还原）：`closing` 并进 `active` → 3 红；失败时清 store → 1 红；
      不刷新列表 → 2 红；`closed` 也显示关闭 → 1 红

#### C20 团队执行环境改为**项目 id**（迁移 v16） — ✅ 已落地（2026-11-03）

**症状**：从工作树单元开团队必失败 ——
`no project owns ~/.neeko/worktrees/multi-agent`。

**根因**：`PtyMemberExecutor::spawn` 拿 `team.project_path` 去
`core::project::environment_for_path` 做**路径前缀**匹配，而 Neeko 的工作树按设计在
`~/.neeko/worktrees/<name>`（项目目录**之外**）⇒ 永远匹配不上。附带缺陷：失败发生在
「建队写入之后、起进程之前」，库里留下真实团队行（面板可见的孤儿队）。

- [x] 迁移 v16：`LATEST_VERSION` 15→16，`store::v15_to_v16` 用 `add_column_if_missing`
      加 `project_id TEXT NOT NULL DEFAULT ''`；**同时**改建表串 / `SELECT_TEAM` /
      `INSERT … ON CONFLICT` 三处（漏一处 = 新库能写、旧库读不出）
- [x] 空串语义写明：**空 = v16 之前建的行**（那时环境只能靠路径前缀猜），不是「没有项目」
- [x] `Team.project_id` + `bootstrap::plan_team(project_id, …)`（空 id 在纯函数层拒绝）
- [x] `start_team_session(project_id, project_path, agent_id, …)`：在**任何写入之前**
      `state.project_environment(&project_id)?`（与端点门面同一台阶），未知 id 直接可读拒绝
- [x] 执行层：纯函数 `execution::environment_source(&Team) → ProjectId | LegacyPath`，
      `team_executor` 只按变体查表；`LegacyPath` 注释写清是 v15 兼容路径且对工作树无效
- [x] **没有**改 `core::project::environment_for_path` 的前缀规则（它对别的调用方是对的）
- [x] 前端：`StartTeamSessionParams.projectId`（项目来源 = `useProjectStore.activeProjectId`）、
      无激活项目 ⇒ 按钮禁用 + **可见**理由（禁用按钮不可聚焦）+ 零 `invoke`
- [x] 提交判定抽成纯函数 `utils/launchGate.ts`（`launchGate` / `startableAgentIds` / `isLaunchable`）：
      四条否决来源各自可单测，主按钮的理由也从同一返回值出（无激活项目那条优先）
- [x] 判据（Rust）：`a_v15_team_row_upgrades_to_an_empty_project_id` /
      `a_team_row_round_trips_its_project_id` / `planning_a_team_without_a_project_id_is_refused` /
      `a_team_row_with_a_project_id_resolves_the_environment_by_id` /
      `a_legacy_team_row_falls_back_to_the_path`；迁移幂等（`migration_step_is_idempotent` 加 v16，
      全链幂等在 `common::db`）
- [x] 判据（前端）：建队 `invoke` 带 `projectId`（值与激活项目一致）/ 无激活项目 ⇒ 禁用 +
      可见理由 + 零 `invoke`
- [x] 变异验证：`environment_source` 恒返回 `LegacyPath` → 1 红；面板用 `projectPath` 顶替
      `projectId` → 3 红（两个 LaunchPanel 断言 + TeamPanel）；`launchGate` 去掉
      `hasActiveProject` → 1 红；去掉命令层 `project_environment` 预检 → **全绿**
      （无单测覆盖，靠集成/手测）

**残余问题（未解决，已记录）**：v15 时代建在**工作树**里的旧团队仍然起不了成员（旧行缺
「项目归属」这个事实）；路径前缀规则保留，不静默降级成 `Local`。

#### C21 成员详情抽屉 + 有界事件读法（AC5 待批队列的落点） — ✅ 已落地（2026-11-01）

团队面板能看见花名册与任务板，但**点开一个成员什么都没有**：看不到它手上是什么任务、最近
发生了什么、是不是卡在审批上；租约数字也只在渲染那一瞬取一次 `Date.now()`，两次脉冲之间冻住。
本轮补 `team_member_detail` + 抽屉（backend spec §8.6）。

- [x] 后端 `view::member_detail`（**唯一构造点**）：`member`（复用 `member_status_view`，
      与花名册同一份推导）+ `tasks`（在飞 + 最近完成）+ `awaitingApproval`（AC5，`tasks` 的子集）
      + `events`（最新在前）+ 两个 `truncated` 标记
- [x] `store::member_events(team_id, member_id, limit)`：`actor = ? OR subject = ?`
      （**两边都算**：`claim` 的 actor 是成员，`close_member` 的 subject 才是成员）、
      `ORDER BY id DESC LIMIT ?`、多读一行判 `truncated`（**不**读全量再内存截——红线 4 的时间维度）
- [x] Tauri 命令 `team_member_detail(member_id)`：`require_id` 校验 + `run_blocking_result`
      （读库 ⇒ 阻塞池，红线 3）+ `neeko_invoke_handler!` 注册 + camelCase 载荷表加一行
- [x] 前端 `fetchMemberDetail` / `useMemberDetail`（`memberId | null`，`null` 不请求；
      跟 `teamStore.lastRev` 脉冲重取；失败保留旧数据 + 错误可见）/ `MemberDetailDrawer`
      （≤200 行，拆出 `MemberApprovalQueue` / `MemberDetailTasks` / `MemberEventList` +
      `utils/memberEvents`）/ 花名册点行开抽屉（「打开终端」仍是同一个行里的第二个动作）/
      `TeamView` 根节点加 `relative`（抽屉与任务详情抽屉的定位基准）
- [x] 租约走动：抽屉自己的 1s 定时器（`LEASE_TICK_MS`）只驱动这一个组件重渲染，
      `unmount` 清；**不**做成全局定时器
- [x] 判据（Rust）：`member_events_read_both_sides_newest_first` /
      `a_member_detail_carries_its_row_tasks_and_approval_queue` /
      `a_member_detail_reads_events_from_both_sides_of_the_audit_row` /
      `a_member_detail_is_bounded_and_flags_it` / `a_member_detail_bounds_its_task_rows` /
      `an_unknown_member_detail_is_not_found` / `building_a_snapshot_emits_no_pulse`（加成员详情）
- [x] 判据（前端，`components/__tests__/MemberDetailDrawer.test.tsx`，12 例）：点行 →
      `team_member_detail` 带该 id / 抽屉「打开终端」递成员自己的 `terminalId` 且点行**不**开终端 /
      关闭后不再请求 / 无进程 ⇒ 置灰 + 可见理由 + 零调用 / 待批块正反例（不代批文案）/ 事件类别与
      截断正反例（长 detail 截断、全文进 `title`）/ 假时钟推进 1s 租约文案变化 / 关闭清定时器 /
      重取失败 ⇒ 错误可见 + 不清已有数据
- [x] 变异验证（改坏 → 红 → 还原）：事件过滤只按 `actor` → 2 红；待批块空数组也渲染 → 1 红；
      去掉定时器清理 → 1 红；**`LIMIT` 改成读全量再截 → 全绿**（SQL 行为，单测看不见 ——
      这一半只靠代码审查/集成，不许当成「已测过」）
- [ ] 仍缺：`tasks` 的「最近完成」没有时间列（`team_task` 无 `completed_at`），只能按
      `claimed_at` 倒序近似；成员 transcript（R5.2）仍未接（本轮的「最近事件」是**审计摘要**，
      不是会话内容）

#### C22 冒烟测试暴露的三个「静默缺口」（任务 id 命名空间 / hook 生产侧 / 投递发送者） — ✅ 已落地（2026-11-03）

一次真实冒烟（用户的 `~/.neeko/neeko.db`：`tm_1a196cefa87` 占用了 t1/t2/t3；
`tm_1a19710a45d` = lead + worker-a(codex) + worker-b(pi)；`team_member` 全部 `state=spawned`、
`last_seq=0`；`neeko.log` 里 `team::deliver source=pi event=turn_completed → SkippedUnknownAgent`）
同时暴露了三个缺陷。三者的共同形状：**链路上没有任何一处会红**，所以问题只能在用户机器上
被发现。

> **已被 C23 取代**：本条当时的「不做复合主键」是权宜（全局单调序号）。复合主键落地后，
> 全局序号不再需要，任务 id 回到「每队从 `t1` 开始」。复盘见 `team-domain.md` §2.5 与 C23。

**D1 新团队上 `task_create` 必然 `Conflict: task t1 already exists`**

`team_task.id` 是**全局主键**，而 `next_task_id` 按**本队板**取最大 +1 ⇒ 新队空板永远算出 `t1`。

- [x] `store::TeamStore::max_task_seq()`：`SELECT coalesce(max(CAST(substr(id, 2) AS INTEGER)), 0)
      FROM team_task WHERE id GLOB 't[0-9]*'`（`GLOB` 挡非 `t{n}` 行；`CAST` 给数值序）
- [x] `dispatch::next_task_id(manager)` 只剩一句拼接（规则归 store，红线 6）
- [x] **不做复合主键 `(team_id, id)`** 的裁决写进 `team-domain.md` §2.5 与 `max_task_seq` 的文档：
      SQLite 改主键要整表重建，且 `PRAGMA foreign_keys` 在事务内是 no-op ⇒ 没有安全回滚形态
- [x] 判据：`a_second_team_continues_the_global_task_sequence`（队 A 建 3 个 → 队 B 第一个是 `t4`，
      改前 `Conflict`）/ `max_task_seq_ignores_rows_that_are_not_t_numbered` /
      `max_task_seq_is_numeric_not_lexicographic` / `the_task_sequence_grows_numerically_past_t9` /
      `max_task_seq_is_zero_on_an_empty_board`（既有 `t1`/`t2` 用例不退化）

**D2 成员永远 `spawned`、`team_wait` 只能超时 —— hook 模板没转发团队 env**

`EnvHints` 有 `team_id` / `team_member_id`，`attribution_verdict` 靠它们判团队上下文；但**生产侧
从来没填过**：五份模板都只发 `{neeko_session_id, project_id}` ⇒ 每条成员 hook 都走
`NotTeamContext` → 静默跳过。Rust 侧测试用手搓的 `HookEvent`（自带 hints）所以全绿 ——
**契约两端只有一端被测过**。

- [x] 五份模板（`neeko-report.mjs` / `neeko-pi-status.ts` / `neeko-opencode-status-v2.js` /
      `neeko-opencode-status.js` / `neeko-omp-status.ts`）的 `hints` 各加 `team_id` + `team_member_id`
- [x] **不改** `attribute()` 的既有降级链（通知链路回归面；`EnvHints` 已 `#[serde(default)]`）
- [x] 判据：`every_hook_template_forwards_the_team_identity_env` —— **扫描模板目录**（新增模板自动
      被盯上）+ 断言 `identity::TEAM_ID_ENV` / `TEAM_MEMBER_ID_ENV` 的**值**的读取形态
      `process.env.{NAME} || null` + 模板清单逐字相等。
      **读取形态的匹配口径（2026-11-03 审计后补强，原口径是假护栏）**：① 先剥行注释
      （`:` 后紧跟的 `//` 不算注释 —— 模板里有 `http://127.0.0.1`）；② 必须在 `hints: { … }`
      块**内**；③ 剥完注释后**恰好出现一次**。原口径只做整文件 `contains`，把两行注释掉仍绿。
      四条变异（注释掉 / 删一行 / 挪出 hints 块 / 去掉 `|| null`）逐条验证过均为红。
- [x] 落盘机制已核实：`shim_is_current` 比内容、`install` 在内容变化时重写；**重启 app 的
      `reconcile` 会把新 shim 刷到已安装的 CLI 上**（无需手工重装）

**D3 `team_send` 投递丢掉发送者身份（队长收到 `1275` / `3775` 不知道谁的）**

`ToolReply::NeedsDelivery` 只有 `{to, message}`，执行层原样写进对方 stdin ⇒ 发送者在链路上
整段消失。

> ⚠️ **已被 C24 取代**（下面两条具体做法都已推翻；只剩结论仍然成立 ——「发送者必须进那一行字」）：
>
> 1. **wire 上没有 `from`**。`NeedsDelivery` 现在只有 `{to, text}`：发送者在**决定层**
>    （`mcp::dispatch::send`，principal 就在手边）由 `delivery::delivery_text` 拼进正文，
>    `from` **永不入 wire**。反例判据 `the_needs_delivery_payload_uses_the_documented_wire_keys`
>    钉住键集恰好是 `to` / `text`（把 `from` 加回来必红）。理由见该变体的文档：模型只该看到
>    投递文本，「谁发的」若有两个源（字段 + 正文）就迟早不一致，而 `from` 是模型无行动可做
>    的执行参数。
> 2. **`execution::apply_reply` 已删除**，改为 `execution::Effect` / `apply_effect`
>    （执行层不再认识 `ToolReply`，见本文件 C24 段）。
>
> 判据名也随之收敛：「`from` 换成 `to` 必红」现在由端到端那条
> `server::tests::a_sent_message_is_handed_to_the_executor` 承担。

- [x] ~~`NeedsDelivery` 增 `from`~~ → **撤销**（C24）：wire 是 `{to, text}`，发送者只在正文里
- [x] `delivery::delivery_text(from, message)`：`"[team] {from}: {message}"`（一行、可 grep、
      **不 trim / 不 escape / 不折叠换行**）
- [x] 拼点是 `mcp::dispatch::send`（principal 在那一刻就在手边）~~`execution::apply_reply`~~（已删除）
- [x] 判据：`the_delivery_text_names_the_sender` / `the_delivery_text_keeps_the_body_verbatim`
      （`trim()` 必红）/ `the_delivery_text_does_not_normalise_the_sender` /
      `the_needs_delivery_payload_uses_the_documented_wire_keys`（键集 `to`/`text`：加回 `from` 必红）
      + 端到端 `server::tests::a_sent_message_is_handed_to_the_executor`（投递文本带**发送者**而非收件人）

**变异验证（逐条做过，均已还原）**

| # | 改坏 | 红的是 | 实际断言 |
| --- | --- | --- | --- |
| 1 | `next_task_id` 改回按本队最大 | `a_second_team_continues_the_global_task_sequence` | `Conflict("task t1 already exists")` |
| 2 | `max_task_seq` 用 `max(id)` 字符串比较 | `max_task_seq_is_numeric_not_lexicographic` | `left: 9, right: 10` |
| 3 | 从 `neeko-report.mjs` 删掉 `team_id` 一行 | `every_hook_template_forwards_the_team_identity_env` | ``neeko-report.mjs 里 `process.env.NEEKO_TEAM_ID || null` 在**活代码**中出现 0 次`` |
| 4 | `delivery_text` 的 `from` 换成 `to` | `server::tests::a_sent_message_is_handed_to_the_executor` | `[team] w1@tm_1:`（收件人成了发送者） |
| 5 | `delivery_text` 对正文做 `trim()` | `the_delivery_text_keeps_the_body_verbatim` | 前后空白与多行被吃掉 |

**仍然没修（本轮明确不动）**

- `SkippedUnknownAgent` 把「身份缺失」与「非团队上下文」压成同一个结论：这次正是它让 D2 变得
  难查（一条 warn 里读不出「模板没发 env」还是「用户终端里的普通 CLI」）。应单独改成两档日志/
  计数，但那是观察者层的改动，与本轮三个缺陷无因果关系。
- `team_launchable_agents` / 成员详情 / 面板相邻缺陷（用户明示不动）。

#### C23 任务 id 是**队内**标识符：复合主键 + `TaskRef` 寻址（撤销 D1 的全局序号） — ✅ 已落地（2026-11-04）

**用户裁决（产品要求，不是风格偏好）：** 「肯定不能单独传 `task_id`，`team_id` 一定要和
`task_id` 在一起这样语义才完整」。D1（C22）的全局单调序号是权宜 —— 它当初唯一的理由
（新队的 `t1` 会撞单列主键）被复合主键消掉之后，剩下的只有代价（新队第一件活叫 `t7`，
队长会以为漏了任务）。

**形状**

- [x] `types::TaskRef { team_id, id }` + `TeamTask::key()`；`Display` 是 `{team}/{id}`，
      **只给错误信息与日志用**（刻意没有 `Deserialize`：用字符串解析回键 = 重新引入拼字符串找身份）
- [x] 迁移 v17：`team_task` 重建为 `PRIMARY KEY (team_id, id)` + 三个索引；
      `LATEST_VERSION 16 → 17`；幂等靠 `pragma_table_info` 的 `pk` 序（`team_id=1, id=2`）
- [x] `upsert_task` 的 `ON CONFLICT(team_id, id)`；`get_task(&TaskRef)`；`list_tasks(team_id)` 不变
- [x] 撤销 D1：`max_task_seq()`（全局）→ `next_task_seq(team_id)`（本队 `max+1`，空板 = `t1`）；
      D1 的两条全局判据**删除**并替换成队内版本
- [x] 内存镜像 `HashMap<TaskRef, TeamTask>`；`task` / `claim_task` / `set_task_workspace` /
      `update_task` / `force_done` 全收 `&TaskRef`；`reclaim_expired` / `finish_member_close`
      返回 `Vec<TaskRef>`
- [x] 两个入口的语义分界：MCP 工具**仍然只有 `task_id`**（队来自 `principal.team_id`，
      唯一构造点是 `dispatch::task_of_team`）；本地 IPC `team_task_detail(team_id, task_id)`
      **两个参数都必填、顺序固定**
- [x] `view::TaskCard` / `TaskDetail` 带 `team_id`（面板拿卡片就能凑出详情请求的两个参数）；
      `view::task_detail(&TaskRef)`
- [x] 前端：`TaskCard.teamId`、`fetchTaskDetail(teamId, taskId)`、`openTaskDetail(teamId, taskId)`、
      卡片点击透传 `(team.teamId, task.id)`、`createTaskCard` 夹具补 `teamId`
- [x] 文档：`team-domain.md` §2.5 整节改写（含 D1 复盘）

**六条判据（先红后绿）**

| # | 判据 | 位置 |
| --- | --- | --- |
| 1 | `a_task_id_is_only_unique_inside_its_team` | `mcp/dispatch.rs` |
| 2 | `a_new_team_numbers_its_tasks_from_one` | `mcp/dispatch.rs` |
| 3 | `a_v16_database_regains_the_task_id_for_a_second_team`（+ `v17_step_is_idempotent` / `the_task_primary_key_is_team_first`） | `store.rs` |
| 4 | `task_detail_rejects_a_pair_that_does_not_belong` | `mcp/dispatch.rs` |
| 5 | `depends_on_resolves_inside_the_team` | `mcp/dispatch.rs` |
| 6 | TS：`team_task_detail` 必须收到 `{teamId, taskId}` 两值 | `teamStore.test.ts` / `TeamPanel.test.tsx` |

**变异验证（逐条做过，均已还原）**

| # | 改坏 | 红的是 | 实际断言 |
| --- | --- | --- | --- |
| 1 | 内存镜像的键退回「只用 id」（插入 / 查找都忽略 team） | 判据 1 | `left: "B 的活", right: "A 的活"` |
| 2 | `next_task_seq` 用全局最大（去掉 `team_id = ?1`） | 判据 2 | `队 B 从 t1 开始编号`：`left: "t4", right: "t1"` |
| 3a | `v16_to_v17` 直接 `return Ok(())`（漏掉重建） | 判据 3 | 升级后队 B 插入 `t1` → `SQL error or missing database`（UNIQUE） |
| 3b | 两处 DDL 都写成 `PRIMARY KEY (id, team_id)` | `the_task_primary_key_is_team_first` | 顺序反了（**判据 3 本身的断言察觉不到**：复合键不论列序都能让 B 插 `t1`） |
| 4 | `manager.task` / `view::task_detail` 忽略 `team_id`（只按 id 找） | 判据 4 | 返回了 `team_id: "tm_1"` 的卡片而不是 404 |
| 5 | `depends_on` 解析改成 `values().find(|t| t.id == dep)` | 判据 5 | 本队缺 `t1` 时认领**成功**（被队 B 那个 `done` 的 `t1` 满足） |
| 6 | `fetchTaskDetail` 只传 `taskId` | 判据 6 | invoke 收到 `{taskId}`（缺 `teamId`） |

> 判据 5 的**构造**是这轮的一个教训：最初写成「两队都有 `t1`、本队那个还 pending」，
> 结果变异后 `values().find(..)` 可能命中本队那个而**假绿**。改成「本队**没有**该 id、
> 别队有且已 done」之后，正确实现必然 `NotFound`、错误实现必然认领成功 —— 两态确定。

**没做 / 缺口**

- `SkippedUnknownAgent` 拆分、sentinel、respawn 一律未动（用户明示不动）
- 队长的 `task_create` 仍可能在并发下算出同一个 `t1` → `Conflict`（可见的重试，不是静默覆盖）
- `team_event.subject` 仍只放队内 id（同一行的 `team_id` 列是另一半键，行级满足语义）

#### 剩余顺序

1. 端到端跑一次：建队（含配置）→ 队长按 preamble 行动 → `team_spawn` → 成员认领 → 回传
   （同时补 P0 缺的「真实 hook payload」证据）
2. ~~`team_close` + 团队列表~~ → ✅ C18（后端）/ C19（面板）
3. ~~审批队列 UI（AC5）~~ → ✅ C21（成员详情抽屉 + 待批队列）；剩成员 transcript 按需拉取
4. sentinel 接线（C4 的模型 + 迁移；`TeamTask.nonce` + `team_execution`）
5. C11 的 `respawn_member`（PTY 死掉 / 首次启动失败后的重试入口）
6. `grok` / `opencode` 的配置目录重定向探测（成则加两行数据；不成维持拒绝）

### 2.5 `team_spawn` 的准入校验（原始清单，已被 2.5a/b 取代）

- [ ] 依据 P0 矩阵计算 `tier`（A/B/C），**调用方传入的档位被忽略**
- [ ] A 档：hook + MCP 齐全；B 档：缺 MCP → `result_channel = Sentinel`；C 档：无 hook → `result_channel = Sentinel` 且**标记卡住不可检测**
- [ ] `dsh` 拒绝（hook-only、无 `AgentConfig`，无法 spawn）
- [ ] `approval_policy = Bypass` 时从 `AgentConfig.approval_bypass_args` 取开关，**不按 CLI 名分支**
- [ ] 先写测试：三档各一例；`dsh` 被拒；Bypass 取到对应 CLI 的参数（AC7b）
- [ ] 验证：`cargo test agent::team::spawn`

**P2 验收门**：AC1 / AC4 / AC7b —— 建队 → 派 3 个任务 → 成员 claim → `team_wait` 返回，全程不轮询。

---

## P3 可观测（面板 + 审批 + 事件）

### 3.1 团队事件常量 + TS 护栏

- [x] `agent/team/events.rs:TEAM_EVENT`（`"agent-team://event"`）；`src/shared/events.ts` 同步
      —— 载荷是**失效脉冲** `TeamPulse { rev }`（不是增量），发射点在 `WriteGuard::drop`
      （任何写路径恰好一次，读路径零次；`bump()` 返回 `fetch_add` 之后的代数）
- [x] **新增护栏** `tools/guards/checks/check_event_constants.py`：从 Rust 扫 `"agent-team://*"` 与 TS 表比对
      （边界：无协议事件名与前缀式名不在射程 —— 已写进 `team-domain.md` §8.3）
- [x] 验证：护栏自身有测试夹具（改坏 TS 常量 → 红：A1 缺镜像 + A2 无出处）

### 3.1a 前端读路径（面板的数据面）

- [x] 视图下沉 `agent/team/view.rs`：`TeamStatusView`（MCP）/ `TeamSnapshot` / `TaskCard` / `TaskDetail`
      共用**唯一构造点**（`mcp/dispatch.rs` 不再自建视图）
- [x] `team_snapshot(team_id)`：花名册 + 任务板列，**列路径不含 `body`**（类型上没有该字段）
- [x] `team_task_detail(team_id, task_id)`：点开才拉正文（C23 起两个参数都必填：任务 id 只在队内唯一）
- [x] `MAX_BOARD_TASKS = 200` + `tasks_truncated`（列载荷上界，不是分页）
- [x] 取证：快照 JSON 不出现 `body` 键（断言序列化后的 `Value`）/ 超 200 置标记 / 未知 id → `NotFound`
- [x] AC2 的数据面：`MemberStatusView.verification`（`idle + unverified` ⇔ 「空闲 ⚠ 未声明」）

### 3.1b 终端接管（队长 PTY 可见的前置）

- [x] `TerminalTabData.existingSessionId` → 策略直接返回既有会话 id（不发 `create_terminal_session`）
- [x] `CacheEntry.attached`：接管来的会话**不拥有进程** —— 关 tab / 自愈重建只销毁缓存，
      不下发 `close_terminal_session`（否则关一个 tab 就 kill 掉队长）
- [x] `useTerminalTabs.openExistingTerminalTab`：同一 `sessionId` 只允许一个 tab（drain 是单队列）
- [x] wsl/remote + 接管 → 显式报错（团队 PTY 只可能是本机会话）
- [x] 取证：接管零次创建 / 同 id 第二次激活已有 tab / 三种变异各自变红


### 3.2 待批队列（不冒泡进队长对话）

**参考原型：** `prototype-agent-team.html` 视图 ① 右下角提示 + 顶栏「切换到队长视角」按钮（演示反模式）。

- [ ] 后端：`approval_requested` → 成员 `Awaiting` + 任务 `awaiting_approval`
- [ ] 前端：队列 UI，批准/拒绝回填到成员 PTY
- [ ] 验证：`pnpm vitest related src/features/agent-team`

### 3.3 团队面板

**参考原型：** `prototype-agent-team.html` 视图 ① 与视图 ③（全部 CLI 成员）。

- [x] 花名册（六态徽标 + 租约剩余 + `verification`）、任务板（按状态分列）、队长入口
      （`start_team_session` → `openExistingTerminalTab`）
- [x] dock 面板注册（`team`，right/5，独立 lazy wrapper）
- [x] 脉冲消费：`rev <= lastRev` 忽略 / 窗口内合并成一次重取 / 在飞补一拍 / 卸载退订
- [x] AC2 的 UI 判据：`memberBadge()` 纯函数，`idle` 的文案 + tone + aria-label 由 `verification` 决定
      （虚线边框 —— 灰度与色觉障碍下形状仍可区分）
- [ ] 成员详情**按需拉取**：点开才读 `conversation` 会话文件（红线 4）—— 未做，下一批
- [ ] 红线 4 测试：构造超大成员会话，断言单次 IPC 载荷 ≤ 2MB —— 跟着 transcript 一起做
- [x] 验证：`pnpm vitest run src/features/agent-team`（5 files / 37 tests）

**剩余已知契约缺口（本轮发现，未改后端）**

- `TeamSession` 不回带 `team_name` ⇒ 队长 tab 标题要先拉一次快照（多一次往返，快照失败时退化成 `teamId`）
- `MemberState` 实际 8 个变体，文档/原型写「六态」—— 措辞待统一（不影响「一个都不能合并」这条性质）
- `MAX_BOARD_TASKS` 的 TS 镜像无护栏（事件名有）—— 扩护栏时一并纳入
- 面板卡片暂无「未声明 chip」（数据已在快照里，纯前端补充）

### 3.4 Histor 打标

- [ ] 团队成员的会话在 Histor 里可见但不与普通会话混排（design §7.4 降级项）
- [ ] 验证：`pnpm vitest related src/features/conversation`

**P3 验收门**：AC5 / AC9 / AC11 —— 演示"卡在审批的成员被看见并被批准"。

---

### 3.5 `neeko-team` skill 部署（协议 preamble 不写进任务体）

**依据：** `research/04-rmux-demo-close-reading.md` §4.2

- [ ] 复用 `agent/resource_deployer.rs` 的 skills 部署能力，部署一份 `neeko-team` skill：
      sentinel 格式、`task_claim`/`task_update` 用法、**禁止假装执行**
- [ ] 任务体里**只留** nonce + task_id + 具体需求（不重复协议文本）
- [ ] 动机：任务体经 `agent.prompt` 打进 pane ⇒ 整段回显进字节流 ⇒ 抬高 sentinel 误匹配；同时顶大 prompt
- [ ] 先写测试：部署产物含 sentinel 格式；任务体**不含**协议 preamble
- [ ] 验证：`cargo test agent::team::skill`

## P4 隔离与并行

### 4.1 worktree 作为成员 cwd

- [ ] `task_create(workspace=Worktree{..})` → `common/git/operations/worktree.rs:create_worktree`
- [ ] 成员 spawn 时把 worktree 路径作为 `create_session(cwd, …)` 的 cwd
- [ ] 先写测试：两个成员不同 worktree 并行编辑互不覆盖（夹具路径一律 `tempdir()`，红线 13）
- [ ] 验证：`cargo test agent::team::worktree`

### 4.2 协商式清理

- [ ] 团队关闭时**先检查未提交改动**：有则保留 worktree 并提示，不静默删除
- [ ] 关闭顺序：先 close PTY → 再归档成员 → 最后处理 worktree（避免悬空 id）
- [ ] 先写测试：有未提交改动时 worktree 不被删；无改动时被删
- [ ] 验证：`cargo test agent::team::lifecycle`

**P4 验收门**：AC6 —— 两成员各自 worktree 并行，产物落各自分支。

---

## 全局验证与收尾

- [ ] `pnpm check:quick` 绿（**只在收尾跑一次**）
- [ ] `cargo clippy --all-targets -D warnings`
- [ ] 红线自查：1 / 3 / 4 / 5 / 6 / 8 / 9 / 12 / 13 / 14 / 15 各一条对应实现或测试
- [ ] 原型对齐：`prototype-agent-team.html` 四视图逐条落地（六态徽标不得合并；「未声明」的任务留在进行中列）
- [ ] 新增 AC 全覆盖：AC12（seq 乱序）/ AC13（sentinel 五条）/ AC14（原子 send 与分两次写）/ AC15（wait 钉住）
- [ ] spec 同步：新建 `.trellis/spec/backend/agent-team-domain.md`；`.trellis/spec/backend/agent-hooks-domain.md` 补团队归因一节
- [ ] `docs/features.md` 登记新能力（Agent 段新增一条），锚点指向 `src-tauri/src/agent/team/`
- [ ] 不主动提交代码（等用户指示）

#### C24 三方 review 的修复轮（后端 4 条 + 前端 7 条 + 一次事故） — ✅ 已落地（2026-11-04）

来源：用户要求的「按第一性原理 + 高内聚低耦合可扩展性」审查。三路并行 reviewer（后端 / 前端 /
判据与文档），结论我逐条回归验证后分组修复。

**后端 —— 根因：一个成员的生命周期事实没有单一所有者**

| # | 错在哪 | 修法 |
| --- | --- | --- |
| B1 | 关闭后置条件被两个 `?` 打断 ⇒ 已归档成员的旧 token 仍在门里 | 关闭的后置条件收成**一段不可分割的动作**；`refresh` 放进**无 `?` 的收尾**，且在 seal **之后** —— seal 会顺手归档队长，先 refresh 会漏掉队长那把钥匙 |
| B2 | `commands.rs` 又 import 了 `mcp::dispatch::ToolReply` | 领域效应 `Effect` / `ClosePlan` / `EffectOutcome`；`ToolReply → Effect` 与 `EffectOutcome → ToolReply` 各一个翻译点，`match` 无 `_`（编译期穷尽）；源码级判据钉住「本地入口不出现 `mcp::`」 |
| B3 | 「先关进程再归档」实为 detach（`close_session_in_background`） | 不引入等待/超时，**把事实写对**：`close` = 请求关闭；notes 恒定一条说明进程异步退出，并说明为什么不影响正确性 |
| B4 | 归档不清 `terminal_id` ⇒ 已关闭成员仍给「打开终端」 | 归档同一把锁内一次写：`Dead + terminal_id=None + token_hash="" + 在飞任务回 pending` |
| minor | 读锁写库零脉冲 · 待批队列可能含 `tasks` 里没有的卡片 · `list_teams` 整段 clone 任务 · `NeedsDelivery.from` 上 wire · `next_task_seq` 放过 `t1abc` | 逐条修（`task_counts` 计数访问器 / 截断后再筛 / 发送者在决定层拼进文本 / SQL 加 `NOT GLOB '*[^0-9]*'`） |

判据：`a_failed_seal_still_revokes_the_credentials` · `the_local_entry_does_not_depend_on_the_mcp_vocabulary` ·
`every_tool_reply_variant_is_translated` · `the_close_notes_say_processes_exit_asynchronously` ·
`a_closed_member_has_no_terminal_and_no_credential` · `recording_a_close_request_emits_exactly_one_pulse` ·
`the_approval_queue_is_a_subset_of_the_listed_tasks` · `task_counts_reports_total_open_and_done` ·
`the_needs_delivery_payload_uses_the_documented_wire_keys` · `next_task_seq_ignores_rows_that_are_not_t_numbered` ·
`every_face_of_a_team_reports_the_same_member_count`。

**前端 —— 根因：「裸 rev + 每个读面自愿订阅」，失败是静默的**

| # | 错在哪 | 修法 |
| --- | --- | --- |
| F1 | 团队列表没有任何失效源（订阅被 `if (!teamId) return` 关掉，而列表态恰好是 `teamId === null`） | 订阅收进 `teamStore`（唯一 listen 点）；新增 `usePulseRefresh`（100ms 合并 + 在飞排队 + 卸载闩）三处读面共用；列表页加常驻「刷新」 |
| F2 | 灰按钮理由说错事，且被用例固化成契约 | 理由说真正缺的东西 + 判据「两条 blocked 理由必须互不相同」 |
| F3 | `Team` 镜像漏 `projectId` ⇒ 成员终端 tab 落在别的树 | 补镜像（`ProjectId` 品牌类型），wrapper 用团队的 projectId；v16 前的旧行才回落激活项目 |
| F4 | 同一队两个成员数 | 三个面统一后端口径；后端补 `TeamSnapshot.member_count`（与 `TeamSummary` / `TeamStatusView` 同一访问器），前端删掉派生兜底 |
| F5 | 两个抽屉无 `role=dialog` / Esc / 焦点归还 | 共享 `useDrawerFocus`（移焦 + Tab 陷阱 + Esc + 归还），两个抽屉共用 |
| F6 | 租约两套实现（一处数字会「停住」） | `utils/leaseText.ts` 唯一文案函数，输入统一到「剩余秒」 |
| F7 | 列映射手写数组（新增状态不编译失败）· 回落用 effect · 「无进程」文案会撒谎 · 空池语义无护栏 · 重复 error 块 · `invokeError` 双实现 | 逐条修（`Record` 穷尽 / 渲染期派生 / 中性文案 / 语义用例 / `ErrorNotice` 共用 / `shared/utils/invokeError.ts`） |

**事故（必须记住的教训）**：一位 reviewer 用 `git checkout <path>` 还原变异，把 `manager.rs`
（2600 行）与一份 hook 模板的未提交改动一起删掉；靠 `/tmp/manager.bak` 与逐字 diff 恢复
（恢复后 2750 全绿、`git status` 回到 81 项）。协议已写进
`.trellis/spec/unit-test/backend-testing.md`「变异验证」：**还原只许内容快照；`git checkout` /
`git restore` / `git stash` 在脏树上是禁手**；review 类任务默认只读。


## 回滚点

| 提交边界 | 可独立 revert |
| --- | --- |
| P0 矩阵（纯文档） | ✅ |
| P1 域 + 观察者 + env | ✅ 不接 MCP/UI，env 缺省即回现状 |
| P1.6 归因拒绝 | ⚠️ 这是行为变更；回退即恢复"可能串台"，需在 spec 里标注 |
| P2 工具面 | ✅ 不接 UI 时无用户可见面 |
| P3 面板 + 事件 | ✅ 关掉入口即回旧态 |
| P4 worktree | ✅ 默认 `Workspace::Shared` 即退化为串行 |
