# 执行计划：live-sessions 注册表 → 三个投影

> 顺序即依赖：纯层 → 注册表 → 两个生产者 → IPC → 前端投影。
> 每步都留可验证判据；**单测先红再绿**（TDD），跨栈常量最后统一。

## P0 纯层（无 IO，100% 直测）
- [ ] 1.1 `live_sessions/{mod,entry}.rs`：`SessionKind` / `SessionState` / `TitleSource` / `SessionEntry`；
      `mod.rs` 只 `mod` + `pub use`（红线 9）。
- [ ] 1.2 `live_sessions/state.rs`：`Signal` + `reduce` 表；用例覆盖全部 `(state, signal)`、
      「终止不复活」、「审批往返回 Ready」。
- [ ] 1.3 `live_sessions/title.rs`：`pick` / `truncate` / `should_upgrade`；用例覆盖强弱、
      空白候选、中文截断、`User` 不被覆盖。
- [ ] 验证：`cargo test --lib live_sessions::`

## P0 注册表
- [ ] 2.1 `live_sessions/registry.rs`：`register` / `apply` / `set_title` / `unregister` /
      `snapshot(Option<&UnitScope>)` / `version()`；锁内只做 map 与克隆，落盘在锁外。
- [ ] 2.2 `ResumeCursor::from_entry`（单一投影）+ `SessionState → SessionStatus` 单向映射。
- [ ] 2.3 用例：重复 id 只 warn、迟到信号丢弃、状态未变不 bump、`snapshot` 排序稳定。
- [ ] 2.4 `AppStateWrapper` 挂 `live_sessions: Arc<Registry>`（复用既有 `SessionStore` 实例）。

## P0 chat 生产者（AC4）
- [ ] 3.1 `live_sessions/wiring/chat.rs`：`StreamEvent → Option<Signal>` 纯函数 + `observe(registry, sid, &[SequencedEvent])`。
- [ ] 3.2 在 `spawn_session_pipeline`（`agent/chat/commands.rs`）接线：注册（标题 =
      `pick([(Native, req.topic), (Prompt, req.prompt)])`，都没有则留空）、
      批量 emit 处观察、结束处注销。**不新增事件通道**。
- [ ] 3.3 用例：假 session 驱动（`for _ in 0..N` 有界读，勿用 `while let`）+ 断言状态序列、
      `Error` 后 `TurnEnd` 不改写失败态。

## P1 PTY 生产者（AC5）
- [ ] 4.1 `create_terminal_session` 增 `agent_id: Option<String>`；PTY 创建成功后注册
      （`workspace` 来自参数、`cwd` 用于校验归属）。
- [ ] 4.2 `spawn_pty_pipeline` 的 child 退出 → `Exited` / `Failed` + 注销。
- [ ] 4.3 用例：退出码 0 / 非 0 两态；真机各跑一次（`exit` / `false`）。
- [ ] 4.4 前端 `TerminalTabData` 增 `ptySessionId?`，由终端策略创建后回写 tab data；
      删除 `status` 字段（视图不再持有状态副本）。

## P1 IPC（AC6）
- [ ] 5.1 `live_sessions/events.rs`：`SESSIONS_EVENT`；`shared/events.ts` 同名常量。
- [ ] 5.2 `live_sessions/commands.rs::list_live_sessions(workspace?)`：薄命令，
      `state.resolve_unit_scope` 唯一分组入口（红线 6/12）。
- [ ] 5.3 `wait_live_sessions(since, timeout_ms)`：版本未变挂起，超时返回 `changed: false`
      （复用 `terminal_drain_wait` 的 credit-pull 结构与超时上限）。
- [ ] 5.4 用例：两单元交叉过滤（只返回本单元）；超时不空转。
- [ ] 5.5 注册命令到 `lib.rs` 的 `generate_handler!`。

## P1 前端 store + selector + 图标（AC7）
- [ ] 6.1 `shared/store/liveSessionsStore.ts`：只做 hydrate / apply（丢弃乱序回包）；
      `useLiveSessionsBridge()` 挂在 AppShell 层（全局一次监听 + 长轮询）。
- [ ] 6.2 `shared/selectors/liveSessionSelectors.ts`：`sessionsByUnit` / `dominantState` /
      `tabSession`（chat 用 `data.sessionId`，terminal 用 `data.ptySessionId`）。
- [ ] 6.3 `shared/components/SessionStatusIcon.tsx`：状态→视觉唯一表（穷举用例）。
- [ ] 6.4 用例：三个 selector + 图标映射（每个状态都有确定输出、无会话不渲染）。

## P2 三个投影（AC8）

> 视觉契约：[`prototype.html`](./prototype.html)。7.2 / 7.3 的成品要与它对齐
> （状态→视觉一张表、单元角标取 dominantState、派生标题、无会话不画点）。

- [ ] 7.1 tab 标题：`features/editor/utils/tabTitle.ts::resolveTabTitle`；`TabItem` 改用派生值。
- [ ] 7.2 侧栏单元图标：`SessionRow` 增 `status?: SessionState`；`ProjectGitSection` /
      `WorktreeRowList` 用 `dominantState(sessionsOfUnit(key))` 传入。
- [ ] 7.3 侧栏单元子列表：`shared/components/SessionList.tsx`（**agent 图标** + 标题 + 状态 +
      相对时间；点击激活对应 tab），单元行默认折叠、展开渲染（≤20 条 + 查看全部）。
      图标复用既有 `getAgentIconSrc` / `AgentIcon`（`DEFAULT_AGENT_ICON = cli.svg` 已是兜底）——
      **不要**为会话行另建 agent→图标 映射表（那是第二份真相）。
- [ ] 7.4 用例：`resolveTabTitle` 优先级（注册表 > tab 兜底）、空会话不渲染状态点。
- [ ] 7.5 与 `prototype.html` 逐项对齐（5 状态视觉 / 角标规则 / 派生标题），
      差异要么改实现、要么改原型并在此记录理由 —— 不允许"实现与原型各说一套"。
      `TitleSource` **不渲染**任何徽标（原型已按评审去掉），只参与 `should_upgrade`。

## P2 标题升级（AC8）
- [x] 8.1 terminal：`term.onTitleChange` → `set_title(Native)`（xterm.js 已提供，当前未接）。
      走**薄命令**（`set_live_session_title`）而非新事件通道 —— 理由见「实施记录 · 8.1」。
- [x] 8.2 chat：会话落盘后由 conversation 扫描反查 `ConversationMeta.title` → `set_title(Native)`
      （按 `cwd` + `native id`；归属用 `UnitScope`，不做字符串前缀）。**不做（理由见实施记录）**。
- [x] 8.3 用例：升级单调（`Prompt` 不被 `Placeholder` 覆盖）、`User` 永不被覆盖。
      由 `registry::tests::set_title_upgrades_but_never_downgrades` /
      `user_title_survives_automatic_sources`（已落地于步骤 2）覆盖；8.1 另补
      `osc_title_is_native_so_it_can_replace_another_native_title` 钉住"包装层送的是 `Native`"。

## 护栏 / 收尾
- [x] 9.1 跨栈常量用例：`SESSIONS_EVENT` 双端一致（照 `transports.test.ts` 的序列断言写法）。
      `shared/__tests__/sessionsEventConstant.test.ts`：取后端**声明值**与前端常量比相等
      （非子串断言）+ 声明恰好一条 + 不与 `AGENT_CHAT_EVENT` / `TRANSLATION_EVENT` 撞名。
- [ ] 9.2 若加静态判据（`SessionState` 赋值只允许在 `live_sessions/`），同步护栏 + 台账。
- [x] 9.3 spec 同步：`agent-chat-transports.md`（新增「会话状态与标题的唯一来源」一节）、
      `frontend/state-management.md`（注册表快照 vs 视图派生）、`persistence-and-cache.md`（写穿策略）。
- [ ] 9.4 收尾只跑一次 `pnpm check:quick`；AC1–AC9 勾验；`add_session.py`；**不主动提交**。

## 实施记录（2026-10-31，8.1 / 9.1 / 9.3）

### 8.1 terminal 的 native 标题：选 (a) 薄命令，不选 (b) 复用事件

理由（不是偏好，是通道事实上没有可复用的）：前端 → 后端**只有**两条既有通道 ——
`terminal-input-{id}`（载荷是 stdin 字节，塞标题就是污染 stdin 流）与 agent chat 事件
（方向相反，后端→前端）。复用任一条都必须新造一个通道名，而红线 5 要求事件名只能来自
单一常量源、不得扩散 —— 于是选 (a)：`set_live_session_title(sessionId, title)`，命令体只有
一行 `Registry::set_title(Native, …)` 调度，升级判定留在 `title::should_upgrade` 唯一处。

**节流判据**：同一会话「值不变不发」，前端在 `createTerminalTitleSync` 里按**归一化后的值**
（折叠空白 + 去首尾，与后端 `truncate` 同口径）去重。依据：xterm 的
`setTitle(){…this._onTitleChange.fire(e)}` **无条件** fire，CLI 的 spinner 帧会反复发同一串。
**不做时间窗节流**：把 1s 内的变化压成最后一次会压掉「跑完了」这类关键跃迁。
订阅按 React effect 生命周期归属（`Terminal` 实例跨 mount 存活、listener 不存活）；
`ptySessionId` 未铸造时不发且**不记基线**，保证 PTY 建好后的第一个标题会补发。

### 8.2 chat 标题反查：明确不做

原计划「chat 会话落盘后由 conversation 扫描反查 `ConversationMeta.title` → `set_title(Native)`」
**不做**，三条理由都是事实性的：

1. `SessionEntry` 没有 agent 原生会话 id（`SessionHandle` 只有 `agent_id` / `workspace` /
   `request_tx`），反查需要先给条目加 `native_session_id` 并在 adapter 握手后回填；
2. 恢复会话的原生标题**已经**由 `StreamRequest.topic → TitleSource::Native` 覆盖（R4.2），
   扫描只会把同一个值再写一次；
3. 新会话的标题就是首条 prompt —— 与 CLI 自己显示的一致，不需要再猜一个「扫描结果」去覆盖它。

### 9.1 断言形态

值相等（`expect(SESSIONS_EVENT).toBe(backendSessionsEvent())`），不是子串 ——
子串断言挡不住「后端声明被注释掉 / 旧声明残留」这类半改状态。另外两条：后端声明必须
**恰好一条**（0 条 = 判据丢了，多条 = 存在两个事件名），且不得与另两个事件通道同名
（值相等挡不住「两端一起抄错」）。

## 验证命令

```bash
cargo test --lib live_sessions::      # 纯层 + 注册表 + 两个 wiring
cargo test --lib agent::chat          # 接线未破坏既有 chat 契约
cargo clippy --all-targets -- -D warnings && cargo fmt --check
npx vitest run src/shared src/features/editor src/features/project
pnpm check:quick                      # 收尾一次（含 35+ 条护栏）
open .trellis/tasks/10-31-live-sessions-title-status/prototype.html   # 与视觉契约对照
```

## 回滚点

- 步骤 1–2 完成后即可独立合入（注册表存在但无人接线，零行为变化）。
- 步骤 3–4 各自可回滚（删 wiring 调用即恢复原状）。
- 步骤 7 的侧栏子列表若引起性能问题，可整体隐藏（`SessionList` 不进渲染），不影响标题与图标。

---

## 10. 审核修复轮（2026-10-31，neeko-check 增量审核后）

按「第一性原理 + 高内聚 / 低耦合 / 可扩展 / 最大化复用」重审本任务的 diff，修掉 7 条 Warning
与 8 条 Nit。**没有新增能力**，全部是收敛：把重复的判据收成一处、把无调用方的接口删掉、
把「恒真的返回值」删掉。

### 10.1 正确性：登记早于信号（原 Warning 1）

`TerminalRouter::create_session` 曾在 `create_session` **返回之后**才登记，而退出信号的
生产者（PTY watcher / SSH io 线程）在进程创建时就已启动。进程秒退 ⇒ `apply` 丢弃未知会话的
退出信号 ⇒ 随后登记出一条永远 `Running` 的幽灵行（无第二个信号能清理）。

- 登记点移入 `services::spawn_pty_pipeline`（`spawn_watcher_thread` **之前**）与
  `RemoteTerminalManager::create_session`（起 io 线程**之前**）；
- 原生事实（地址 / 运行根 / agent）收成 `wiring::pty::TerminalRegistration`，由 router 一次
  成型、沿 `router → manager → pipeline` 单向传递；
- 顺序不变量写进 `wiring/pty.rs` 模块注释 + 判据用例
  （`on_exit_for_unknown_session_is_a_no_op` 是它的反证）。

### 10.2 通知只此一份（原 Warning 2）

「改状态 + 只有真变了才 `emit_changed`」原本在 4 个调用点各写一遍。收成四个入口：
`pty::LiveTerminal::register` / `pty::exit_and_notify` / `pty::unregister_and_notify` /
`chat::register_and_notify`。第 N 个生产者忘写通知的故障形态（侧栏不刷新、无报错、无日志）
因此在结构上不成立。

### 10.3 单一依赖归属（原 Nit 2）

`TerminalManager` / `RemoteTerminalManager` 曾各自存一份 `Option<Arc<Registry>>`（只为了转发）。
现在注册表**只由 router 持有**，接线是每次调用带下去的 `LiveTerminal<'_>`（Copy）——
少 2 个字段、2 个 builder，且「哪个后端持有注册表」不再是需要同步的第二份事实。

### 10.4 删掉无调用方的接口（原 Warning 3）

`list_live_sessions(workspace: Option<WorkspaceSession>)` 的 `Some` 分支在生产里从未被调用，
却让后端多出一套与前端并行的单元归属判据（`UnitScope::owns` 按 cwd 最深根 vs 前端按
`workspaceKey` 等值）。删除参数（连带 `snapshot(scope)` / `snapshot_view(scope)` 收窄、
`optional_workspace_commands.json` 台账恢复为空），单元分组只保留前端
`sessionsByUnit` + `useSessionsByUnit`（一次 O(n) 分组供所有行共用）。

### 10.5 删掉误导性的类型/返回值（原 Warning 4 + Nit 1）

- `SessionState` 不再派生 `PartialOrd/Ord`：状态之间没有大小关系，Rust 的声明序与前端
  `STATE_RANK` 语义相反，留着就是「按它排序就错」的陷阱；
- `Registry::register` 的返回值改为「是否新增」（原来是恒真的装饰）；
- `LiveTerminal::register` / `chat::register_and_notify` 不返回 bool（调用方不看）。

### 10.6 写穿节流（原 Warning 7）

`apply` 只在 `turn_count` 变化（回合结束）或新状态是终态时落盘；中间态不写。
判据是读者：`list_active` 只按 `status != Closed` 过滤，没有任何代码把中间态读回 live 条目。
效果：每回合一次同步 SQLite 写（原为每次状态转移 2 次查询），且语义对全部读者等价
（`persist_is_throttled_to_reader_relevant_transitions`）。

### 10.7 前端：同一事实只有一处判据

- `isSameSession`（kind + sessionId）成为「同一会话」的唯一判据，`tabSession` / `sessionTab` /
  会话行高亮全部走它（原来 `UnitSessionList` 把 `kind` 丢掉只比裸 id）；
- `useNowTick` + `formatRelativeTime(iso, now)`：相对时间有节拍，空闲会话不再永远停在「刚刚」
  （一个列表一个定时器，10s）；
- `sessionsOfUnit` 删除，`NO_SESSIONS` 单一导出，`useSessionsByUnit` 取代三处
  `useMemo(() => sessionsByUnit(...))` 与两处「每行 filter 全表」；
- `SessionRow` 改「容器 + 一个真按钮 + 兄弟动作」：`div role="button"` 内嵌 `<button>` 的
  ARIA 违规与 Enter/Space 被吞的问题一并消失；重命名输入框不再住进按钮里；
- `createTerminalSession(workspace, cols, rows, options)`：消灭
  `(session, cols, rows, null, null, null, agentId)` 的位置参数。

### 10.8 已记录但不改的取舍

终端非零退出**不会**在侧栏留红点：`on_exit` 先 `apply` 再立刻 `unregister`，条目在同一次调用
里消失（chat 侧可见）。保留失败条目是产品决策，已写进
`agent-chat-transports.md` §0.2「终端的 `Failed` 目前在 UI 不可见（已知取舍）」。

### 10.9 验证

```bash
cargo test --manifest-path src-tauri/Cargo.toml   # 2486 + 120 passed
pnpm check:quick                                  # 35 条护栏全绿
npx vitest run                                    # 694 files / 6373 tests passed
```

---

## 11. 真机反馈修复轮（2026-10-31）

| 反馈 | 根因 | 修法 |
| --- | --- | --- |
| tab / 侧栏会话名不是项目名 → **随后改为「没有真标题就不显示名字」** | 占位标题取 `agent_id`（`pi`） | 占位标题留**空串**；侧栏只画图标，tab 用 `Terminal N`。中途曾改成「单元展示名（项目名 / worktree 目录名）」，实测被否：会话行在单元下面，项目名是冗余的 |
| 状态点不流转（终端） | PTY 无完成信号，注册后永远 `Running` | `wiring::pty::OutputActivity`：输出 `stamp()`、100/250ms tick `poll()`，静默 1.5s ⇒ `TurnFinished` |
| 状态点不流转（chat） | `pi` 传输从不发 `TurnStart`，`TurnEnd` 在 `Ready` 上是空操作 | `signal_of` 把回合内容事件也映射到 `TurnStarted` |
| 左侧显示 `pi` 文字 | 同上（占位标题即 agent id） | 标题改单元名后 agent 只剩图标 |
| 会话子列表左侧竖线 | `SessionRow` children 容器 `border-l` | 去掉竖线，只留缩进（`ml-[3.25rem]` 让会话图标对齐单元标签）；行密度/字号/点尺寸对齐原型 |

顺带收敛：`TerminalRouter::create_session` 10 参 → 8 参（原生事实由命令层铸造后整体传入）；
`chat` 注册不再为了取 agent 显示名去锁 `agent_manager`。

验证：`cargo test` 2492 + 120 passed；`npx vitest run` 6373 passed；`pnpm check:quick` 35 护栏全绿。

### 11.1 标题收敛：空占位 + 视图分派（第二轮反馈）

用户否掉了「占位标题显示项目名」：**会话行已经挂在单元行下面，再写项目名是冗余**。
于是 `label` 管道整体撤除（`WorkspaceSession::label` / `AppStateWrapper::workspace_label` /
两个 `*Registration.label` 字段），占位标题回到**空串**，由视图解释：

| 位置 | 空标题时的表现 |
| --- | --- |
| 侧栏会话行（`SessionList`） | 只画 agent 图标 + 相对时间 + 状态点；`aria-label` 给「终端会话 / 聊天会话」，不编名字 |
| tab（`resolveTabTitle`） | 回退 `tab.title`；终端 tab 的占位由 `nextTerminalTitle` 产出 `Terminal N` |

顺带把「agent 名当 tab 标题」一并清掉（同一类问题）：`app/hooks/useTerminalTabs`、
`features/terminal/hooks/useTerminalTabs`（`addTab` / `setTabAgent` / `handleAgentClick`）、
`PaneTabBar` → `ActionMenuDropdown` 的 `onAddAgentTerminal(agentId, agentName)` 全部只传身份，
标题统一走 `shared/utils/terminalTabTitle.ts::nextTerminalTitle`（`features` 不得依赖 `app`，
所以它落在 `shared/`）。`setTabAgent` 现在**只改 agentId、不改标题** —— 标题属于会话，不是 agent 的副本。
