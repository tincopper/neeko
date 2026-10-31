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
      参数模板含 `{{mcp_config}}`；其余档为空。判据 `argv_templates_are_present_exactly_for_the_argv_mode`
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
      `spawn`（反过来新成员第一次调用就 401）；`NeedsDelivery` → `deliver`。
      `spawn` 失败的错误里**带 `member_id`**（成员已落库，丢 id = 毁掉「可查询、可清理」）
- [x] 判据：`member_created_admits_first_then_spawns_with_that_token` /
      `needs_delivery_reaches_the_executor` / `a_failed_spawn_keeps_the_member_id_in_the_error` /
      `a_created_member_is_handed_to_the_executor` / `a_sent_message_is_handed_to_the_executor`

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

#### 剩余顺序

1. 前端入口：`start_team_session` 的按钮（`features/agent-team/`）+ 团队面板（R5）
2. 端到端跑一次：队长 PTY 起来 → `team_spawn` → 成员认领 → 回传（这一步同时补 P0 缺的
   「真实 hook payload」证据）
3. sentinel 接线（C4 的模型 + 迁移先落地）
4. C11 的 `respawn_member`（PTY 死掉 / 首次启动失败后的重试入口）

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
- [x] `team_task_detail(task_id)`：点开才拉正文
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

## 回滚点

| 提交边界 | 可独立 revert |
| --- | --- |
| P0 矩阵（纯文档） | ✅ |
| P1 域 + 观察者 + env | ✅ 不接 MCP/UI，env 缺省即回现状 |
| P1.6 归因拒绝 | ⚠️ 这是行为变更；回退即恢复"可能串台"，需在 spec 里标注 |
| P2 工具面 | ✅ 不接 UI 时无用户可见面 |
| P3 面板 + 事件 | ✅ 关掉入口即回旧态 |
| P4 worktree | ✅ 默认 `Workspace::Shared` 即退化为串行 |
