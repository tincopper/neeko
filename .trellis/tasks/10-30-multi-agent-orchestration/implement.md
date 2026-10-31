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
- [ ] 仍需补 A 级证据（配置已装 ≠ 实测上报）：`team_spawn` 落地后抓一次 `/hook/{source}` 真实 payload
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
等 `Pty` 投递落地再放开 —— 现在的测试 `tier_b_agent_has_no_mcp_channel` 断言的是"能建"，届时同步改。

**C6 `terminal` 没有 env 参数**（`terminal/manager.rs:91`）

design §5.1 说"不需要新抽象"，实测**不成立**：`create_session(cwd, cols, rows, shell_override,
command, app_handle)` 没有 env 位，而成员身份全在 env 里。

⇒ `create_session` 收一个**不透明**的 `env: &[(String, String)]`（terminal 域不认识 team 词汇，
只做透传）；env 的**装配**留在 `identity::member_env`（纯函数，可测）。PTY 侧不可单测
（需 `AppHandle`），由 `check_unit_tests_spawn_real_binaries` 的既定口径兜底：装配测纯函数，
真实起进程靠集成 / 手测。

#### 建议落地顺序（拍板后即可开工）

1. `terminal` env 透传（C6）→ `agent/team/execution.rs`：`SpawnPlan` 纯计划层（cwd / env / argv，
   仅 `Argv` 档）→ `team_spawn` 对 `Subcommand`/`ConfigFile`/`None` 明确 `Unsupported`（C2/C5）
2. 团队 MCP listener mount：独立 loopback + 自己的 `AuthGate::with_tokens` + 从成员行组装
   `principals`（**过滤空 hash**）—— `server::route_group` 已就绪，缺的只是组合根那 20 行
3. 队长 PTY 启动（C1 方案 A）：一个命令 / UI 入口，复用第 1 步的 `SpawnPlan`
4. `Pty` 投递 + `team_send` 原子 send+wait（AC14 的「text 与 CR 分两次写入」）
5. sentinel 接线（C4 的模型 + 迁移先落地）

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

- [ ] `agent/team/events.rs:TEAM_EVENT`（`"agent-team://event"`）；`src/shared/events.ts` 同步
- [ ] **新增护栏** `tools/guards/checks/check_event_constants.py`：从 Rust 扫 `"agent-team://*"` 与 TS 表比对
- [ ] 验证：护栏自身有测试夹具（不通过时红）

### 3.2 待批队列（不冒泡进队长对话）

**参考原型：** `prototype-agent-team.html` 视图 ① 右下角提示 + 顶栏「切换到队长视角」按钮（演示反模式）。

- [ ] 后端：`approval_requested` → 成员 `Awaiting` + 任务 `awaiting_approval`
- [ ] 前端：队列 UI，批准/拒绝回填到成员 PTY
- [ ] 验证：`pnpm vitest related src/features/agent-team`

### 3.3 团队面板

**参考原型：** `prototype-agent-team.html` 视图 ① 与视图 ③（全部 CLI 成员）。

- [ ] 花名册（状态/颜色/workspace/channel/租约）、任务板（按状态列）、队长 PTY（复用既有终端组件，不重画）
- [ ] 成员详情**按需拉取**：点开才读 `conversation` 会话文件（红线 4）
- [ ] 红线 4 测试：构造超大成员会话，断言单次 IPC 载荷 ≤ 2MB
- [ ] 验证：`pnpm vitest related src/features/agent-team`

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

## 回滚点

| 提交边界 | 可独立 revert |
| --- | --- |
| P0 矩阵（纯文档） | ✅ |
| P1 域 + 观察者 + env | ✅ 不接 MCP/UI，env 缺省即回现状 |
| P1.6 归因拒绝 | ⚠️ 这是行为变更；回退即恢复"可能串台"，需在 spec 里标注 |
| P2 工具面 | ✅ 不接 UI 时无用户可见面 |
| P3 面板 + 事件 | ✅ 关掉入口即回旧态 |
| P4 worktree | ✅ 默认 `Workspace::Shared` 即退化为串行 |
