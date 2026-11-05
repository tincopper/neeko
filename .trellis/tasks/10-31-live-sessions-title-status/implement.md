# 执行计划：live-sessions 注册表 → 三个投影

> 顺序即依赖：纯层 → 注册表 → 两个生产者 → IPC → 前端投影。
> 每步都留可验证判据；**单测先红再绿**（TDD），跨栈常量最后统一。

## P0 纯层（无 IO，100% 直测）
- [x] 1.1 `live_sessions/{mod,entry}.rs`：`SessionKind` / `SessionState` / `TitleSource` / `SessionEntry`；
      `mod.rs` 只 `mod` + `pub use`（红线 9）。
- [x] 1.2 `live_sessions/state.rs`：`Signal` + `reduce` 表；用例覆盖全部 `(state, signal)`、
      「终止不复活」、「审批往返回 Ready」。
- [x] 1.3 `live_sessions/title.rs`：`pick` / `truncate` / `should_upgrade`；用例覆盖强弱、
      空白候选、中文截断、`User` 不被覆盖。
- [x] 验证：`cargo test --lib live_sessions::`

## P0 注册表
- [x] 2.1 `live_sessions/registry.rs`：`register` / `apply` / `set_title` / `unregister` /
      `snapshot(Option<&UnitScope>)` / `version()`；锁内只做 map 与克隆，落盘在锁外。
- [x] 2.2 `ResumeCursor::from_entry`（单一投影）+ `SessionState → SessionStatus` 单向映射。
- [x] 2.3 用例：重复 id 只 warn、迟到信号丢弃、状态未变不 bump、`snapshot` 排序稳定。
- [x] 2.4 `AppStateWrapper` 挂 `live_sessions: Arc<Registry>`（复用既有 `SessionStore` 实例）。

## P0 chat 生产者（AC4）
- [x] 3.1 `live_sessions/wiring/chat.rs`：`StreamEvent → Option<Signal>` 纯函数 + `observe(registry, sid, &[SequencedEvent])`。
- [x] 3.2 在 `spawn_session_pipeline`（`agent/chat/commands.rs`）接线：注册（标题 =
      `pick([(Native, req.topic), (Prompt, req.prompt)])`，都没有则留空）、
      批量 emit 处观察、结束处注销。**不新增事件通道**。
- [x] 3.3 用例：假 session 驱动（`for _ in 0..N` 有界读，勿用 `while let`）+ 断言状态序列、
      `Error` 后 `TurnEnd` 不改写失败态。

## P1 PTY 生产者（AC5）
- [x] 4.1 `create_terminal_session` 增 `agent_id: Option<String>`；PTY 创建成功后注册
      （`workspace` 来自参数、`cwd` 用于校验归属）。
- [x] 4.2 `spawn_pty_pipeline` 的 child 退出 → `Exited` / `Failed` + 注销。
- [x] 4.3 用例：退出码 0 / 非 0 两态（`exit_code_maps_to_the_terminal_state`）；
      真机两态仍待一次手动确认（`exit` / `false`）—— 见 §29 收尾清单。
- [x] 4.4 前端 `TerminalTabData` 增 `ptySessionId?`，由终端策略创建后回写 tab data；
      删除 `status` 字段（视图不再持有状态副本）。

## P1 IPC（AC6）
- [x] 5.1 `live_sessions/events.rs`：`SESSIONS_EVENT`；`shared/events.ts` 同名常量。
- [x] 5.2 `live_sessions/commands.rs::list_live_sessions(workspace?)`：薄命令，
      `state.resolve_unit_scope` 唯一分组入口（红线 6/12）。
- [x] 5.3 `wait_live_sessions(since, timeout_ms)`：版本未变挂起，超时返回 `changed: false`
      （复用 `terminal_drain_wait` 的 credit-pull 结构与超时上限）。
- [x] 5.4 用例：两单元交叉过滤（只返回本单元）；超时不空转。
- [x] 5.5 注册命令到 `lib.rs` 的 `generate_handler!`。

## P1 前端 store + selector + 图标（AC7）
- [x] 6.1 `shared/store/liveSessionsStore.ts`：只做 hydrate / apply（丢弃乱序回包）；
      `useLiveSessionsBridge()` 挂在 AppShell 层（全局一次监听 + 长轮询）。
- [x] 6.2 `shared/selectors/liveSessionSelectors.ts`：`sessionsByUnit` / `dominantState` /
      `tabSession`（chat 用 `data.sessionId`，terminal 用 `data.ptySessionId`）。
- [x] 6.3 `shared/components/SessionStatusIcon.tsx`：状态→视觉唯一表（穷举用例）。
- [x] 6.4 用例：三个 selector + 图标映射（每个状态都有确定输出、无会话不渲染）。

## P2 三个投影（AC8）

> 视觉契约：[`prototype.html`](./prototype.html)。7.2 / 7.3 的成品要与它对齐
> （状态→视觉一张表、单元角标取 dominantState、派生标题、无会话不画点）。

- [x] 7.1 tab 标题：`features/editor/utils/tabTitle.ts::resolveTabTitle`；`TabItem` 改用派生值。
- [x] 7.2 侧栏单元图标：`SessionRow` 增 `status?: SessionState`；`ProjectGitSection` /
      `WorktreeRowList` 用 `dominantState(sessionsOfUnit(key))` 传入。
- [x] 7.3 侧栏单元子列表：`shared/components/SessionList.tsx`（**agent 图标** + 标题 + 状态 +
      相对时间；点击激活对应 tab），单元行默认折叠、展开渲染（≤20 条 + 查看全部）。
      图标复用既有 `getAgentIconSrc` / `AgentIcon`（`DEFAULT_AGENT_ICON = cli.svg` 已是兜底）——
      **不要**为会话行另建 agent→图标 映射表（那是第二份真相）。
- [x] 7.4 用例：`resolveTabTitle` 优先级（注册表 > tab 兜底）、空会话不渲染状态点。
- [x] 7.5 与 `prototype.html` 逐项对齐（5 状态视觉 / 角标规则 / 派生标题），
      差异要么改实现、要么改原型并在此记录理由 —— 不允许"实现与原型各说一套"。
      `TitleSource` **不渲染**任何徽标（原型已按评审去掉），只参与 `should_upgrade`。

## P2 标题升级（AC8）
- [x] 8.1 terminal：`term.onTitleChange` → `set_title(Native)`（xterm.js 已提供，当前未接）。
      走**薄命令**（`set_live_session_title`）而非新事件通道 —— 理由见「实施记录 · 8.1」。
      **后续**：前端的上报后来因 `π` 污染被撤（`liveSessionsApi.ts` 注释），来源本身保留；
      恢复条件与判据见 §25。
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
- [x] 9.2 若加静态判据（`SessionState` 赋值只允许在 `live_sessions/`），同步护栏 + 台账。
- [x] 9.3 spec 同步：`agent-chat-transports.md`（新增「会话状态与标题的唯一来源」一节）、
      `frontend/state-management.md`（注册表快照 vs 视图派生）、`persistence-and-cache.md`（写穿策略）。
- [x] 9.4 收尾只跑一次 `pnpm check:quick`；AC1–AC9 勾验；`add_session.py`；**不主动提交**。

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

---

## 12. 会话的「出现时机」修订（2026-10-31 第三轮反馈）

前两轮把「没有真标题」表达成「侧栏只画图标」，实测仍不对：**打开 agent tab 的那一刻会话就该
不存在于侧栏**，而不是先出现一个只有图标的条目。

规则改成：**没有名字的会话不是一条会话**。

| 位置 | 会话无名字（`titleSource === 'placeholder'` 或标题空白） | 会话有名字后 |
| --- | --- | --- |
| 侧栏会话子列表 | **不列出**（`isNamedSession` 在 `sessionsByUnit` 里过滤） | 出现，带图标 + 标题 + 时间 + 状态点 |
| 单元角标 | 不画（角标与子列表同源，都取自过滤后的分组） | 画 `dominantState` |
| tab 标题 | 回退 `tab.title` = **agent 名**（初版行为）/ 空白终端 `Terminal N` | 渲染期换成会话标题 |

顺带回滚上一轮的「tab 标题去 agent 名」：那轮把 agent 名从 tab 标题里删掉，实测不符合预期 ——
agent 名正是「会话起名前」唯一能辨认的信息。`agentName` 参数在 `taskTerminal` /
`handleActionMenuAgentTerminal` / `useFileEditorState` 处全部恢复；`setTabAgent` 也恢复成
「换 agent 同时换回该 agent 的默认标题」（会话级标题仍由注册表在渲染期覆盖）。

后端不动：无名条目仍登记在注册表里（OSC 标题 / 首条 prompt 一到就要能升级），只是视图不列出来。
已知取舍：完全不设 OSC 标题的纯 shell 终端不会出现在侧栏 —— 它确实没有可辨认的名字。

---

## 13. 「会话何时出现」= 用户输入过（第四轮反馈，对齐 Codex 桌面会话流程）

第三轮的判据（有标题就列）仍然不够：agent CLI（claude / codex / pi 一类）**一启动就发 OSC
标题**，于是「有标题」在用户还没敲字时已经成立，侧栏照样立刻冒出条目。

改成与 Codex 桌面端一致的流程——**打开窗口不算，用户输入才算**：

| 阶段 | 侧栏 | tab 标题 |
| --- | --- | --- |
| 打开 agent tab（CLI 已发 OSC 标题） | 不列 | agent 名 |
| 用户敲完第一条输入 | 列出（标题 = 首条输入 / CLI 标题） | 会话标题 |

实现分两半：

1. **`SessionEntry.has_user_input`**（wire 字段 `has_user_input`）——「用户是否已经在这个会话里输入过」。
   置位点只有两处：首条终端输入、首次 `agent_stream`（真回合）。`agent_chat_open` 的静默建连
   与 PTY 创建都不置位（`mark_user_input_is_idempotent_and_drops_unknown_sessions`）。
2. **终端首条输入即标题**（`wiring::pty::FirstInputLine`）—— 没有它终端永远没有标题可显示。
   累积到回车才结算、`ESC [ …` 整段丢弃、空回车不算、只取第一条非空行、超长截断；
   取到后 `on_first_input` 同时 `set_title(Prompt)` + `mark_user_input`（一次 notify）。
   CLI 之后的 OSC 标题按 `Native > Prompt` 正常接管。

前端列出判据 = `has_user_input && isNamedSession`（`isListedSession`），过滤仍在 `sessionsByUnit` 一处。

---

## 14. 标题改由 hook 上报驱动（`NEEKO_SESSION_ID` 精确归因）

第四轮之前，终端标题只有两个来源：CLI 自报的 OSC、`FirstInputLine` 解析键盘字节。前者依赖
CLI 实现且格式随意，后者是猜。而 `agent/hooks` 域**早就有**更好的素材：
`HookEvent.title` 是 CLI 自己的会话名（pi `getSessionName` / claude `session_title`）或首条
用户消息，模板侧已判好优先级，服务端 `topic()` 再过滤占位标题 —— 正是 Codex 那类桌面端
显示在会话列表里的东西。

### 归因机制选型（第一性原理）

要解决的不是「怎么传 id」，而是「一条由 CLI 后代进程发出的报告，如何证明属于哪条会话」。
进程树是 `我们的 shell(pid 已知) → agent CLI → hook shim`，三者只有根是我们认识的：

| 机制 | 能否穿过任意深度 | 继承污染 | 成本 |
| --- | --- | --- | --- |
| **env（per-child）** | **能，自动复制** | 会（嵌套 agent） | 0 |
| pid / 祖先链 | 要查进程表 2+ 跳 | 不会 | Node 只有 1 跳 `ppid`；Windows 要 CIM |
| cwd 匹配 | —（是线索不是身份） | — | 0，但同项目多会话必串 |

选 env：它是**唯一随进程树自动传播、零查询成本**的身份载体。`CommandBuilder::env` 是
每子进程一份（不是 `std::env::set_var` 的进程全局），多会话**不存在覆盖问题**。

### 落地

- `live_sessions::SESSION_ID_ENV`（`NEEKO_SESSION_ID`）单一常量；三处注入：
  本地 `CommandBuilder::env` / WSL 的 `bash -c "export …"`（WSL 不透传宿主 env）/
  SSH 的 channel shell 前缀（与已有 `export COLORTERM` 同一行）。
- `live_sessions::wiring::hooks` —— 新的生产者：`hints.neeko_session_id` 精确命中 →
  `set_title(Native, topic)` + 语义事件（`turn_completed` / `approval_requested` /
  `input_requested` / `session_failed`）⇒ `mark_user_input()`。
- `agent/hooks/ingest/dispatch.rs` 只加一次转发（投影逻辑住在消费方，符合该模块头
  「新增消费者时不要改采集侧、不要塞进 dispatch」）。
- 边界：**不按 cwd 猜**（同项目多会话是常态，猜错是可见的错标题）；未知会话 fail-closed；
  嵌套 agent 归到父会话可接受；重复上报幂等（`turn_completed` 每轮都到）。
- `FirstInputLine` 降级为兜底：`Prompt < Native`，hook/OSC 标题一到就永久接管。
- 模板契约：`templates/tests.rs::embedded_templates_read_the_session_id_env_key` 断言每个
  受管模板都读 `process.env.<SESSION_ID_ENV>`（任一侧改名 → 测试红，避免归因静默失效）。

## 15. hook 未生效时的提示 + 重新安装

> **2026-11-03 变更：本节已作废（用户定案）** —— 侧栏那条常驻提示被判定为噪声，
> `CliHookHint` / `useCliHookHealth` / `hookRowsNeedingAttention` 与其测试已整体删除，
> 「hook 未生效」的可见性回到设置页（`CliHooksSection` 的安装状态 + 重新安装）。
> 判据契约的新落点见 `.trellis/spec/frontend/state-management.md`。下文保留为历史记录。

标题走 hook 之后多了一条**静默失效**路径：hook 没装 / 装旧了 / CLI 侧还没确认信任，
上报不来，用户只会看到「标题不跟随 CLI」，没有任何线索指向原因。

- **判据与设置页同源**：`shared/utils/agentHookSources.ts` 承载 `installableHookRows` /
  `readSourceOverrides` / `isHookSourceEnabled` / `hookRowsNeedingAttention`，设置页与侧栏
  共用一份（复制一份必然漂移：提示说未安装、设置页说已安装是最难自证的一类 bug）。
- **提示出现在后果发生的地方**：`features/project/components/CliHookHint`（侧栏底部）。
  设置页是「我去改配置」的地方，而这个问题的表现就在侧栏标题上。
- **四道降噪**：自供源不提示 / 本机没装该 CLI（`path === ''`）不提示 / 用户关掉该 CLI 或主开关
  不提示 / 探测失败静默降级。健康时渲染 `null` —— 侧栏不留常驻横幅。
- **重新安装**：`useCliHookHealth.reinstall()` → `agent_hooks_apply(true, 本机检测到且未关闭的集合)`
  → 重新探测。失败回执（`status === 'failed'`）显示在提示里，不静默吞掉。
- 用例：`agentHookSources.test.ts`（四道降噪逐条）、`useCliHookHealth.test.ts`（6 个，
  含主开关关闭 / 探测失败 / 失败回执）、`CliHookHint.test.tsx`（4 个，含「装好后提示消失」）。

## 16. 「首条输入」的判据移回前端（一创建 tab 就冒会话的根因）

第 13/14 轮把「首条输入」的实现放在后端：`spawn_writer_listener`（本地）与 SSH 的 input
listener 解析 `terminal-input-{id}` 的字节流。真机表现为**一创建 tab 侧栏就出现一条会话**。

根因：这条通道同时承载两类写入 ——

1. `TerminalViewBase` 在创建会话后**自动**写入 `pi --approve\r`（agent tab 的自动启动）；
2. 用户在 `term.onData` 里敲的按键。

后端拿到的是同一串字节，把 (1) 当成了「用户首条输入」⇒ 立刻 `has_user_input` + 标题
（标题还会是 `pi --approve` 这种垃圾串）。

修法：**判据只放在能区分写入来源的那一层**。

- 前端 `features/terminal/utils/inputTitle.ts::createFirstLineCapture` 只在 `sendInput`
  （= `onData`）路径累积；自动启动走的是 `emit(...)` 直写，不经过它。
- 结算出的首行经新命令 `report_live_session_input(session_id, text)` 上报；后端
  `apply_reported_input` 一次做两件事：`set_title(Prompt)` + `mark_user_input()`，空白文本直接
  丢弃（不写标题、不置 has_user_input）。
- 后端删除 `FirstInputLine` / `on_first_input` 及两处 listener 接线（`services.rs` /
  `remote.rs`）与 5 个相关用例；规则搬到前端（`inputTitle.test.ts` 6 个用例），后端补
  `reported_input` 4 个用例（含「`Native` 胜过 `Prompt`」「空白不置 has_user_input」）。

这条同时说明了一个通用判据：**只有知道「谁写的」的那一层，才能判定「这是不是用户行为」**。

## 17. 可见时机 = 一轮跑完（**已被 §18 推翻，保留为复盘**）

> 这一轮把「可见」绑在「一轮跑完」上，真机验证是错的（发完消息什么都不出现）。§18 已回退。
> 保留本节是为了记住两条被证伪的假设：① 「Codex 是跑完才建会话」（实测不是）；
> ② 「输出静默能区分 banner 与跑完」——不能，只有「有没有用户输入」能区分。

前几轮把「可见」绑在「用户输入过」上，结果仍是**发送即出现**。真机反馈：应该在 agent
**跑完一轮**之后才出现，与 Codex 桌面端一致。

拆成两个字段，因为它们在时间上不同：

| 字段 | 含义 | 置位点 |
| --- | --- | --- |
| `user_input_seen` | 标题素材就绪（用户发出过输入） | 终端首条输入行；chat 的 `agent_stream` |
| `has_user_input` | **侧栏可见 / tab 用会话标题** | 一轮跑完：chat `TurnEnd`、终端输出静默、CLI hook `turn_completed` |

- `mark_user_input` 不 bump（视图无变化，不刷 IPC）；`apply(TurnFinished)` 在
  `user_input_seen && !engaged && !is_terminal()` 时翻转可见性并 bump。
  迟到的 `TurnEnd` 落在终止态上仍被吸收，不会让失败的会话突然出现。
- chat 的三种启动形态收成 `ChatRegistrationKind::{Turn, Resume, Silent}`（一个 bool 会让
  「发了消息」与「跑完一轮」混为一谈）：`Turn` = 不可见 + 有素材；`Resume` = 已有历史 ⇒ 直接可见；
  `Silent` = 都否。
- **续聊不重新登记**（`register_or_mark`：`contains` ⇒ 只 `mark_user_input`）：否则每发一条
  消息都会重置 `has_user_input`（会话在侧栏闪一下）并把标题改成最新那句。
- 前端 `resolveTabTitle` 以 `has_user_input` 为门：发送那一刻 tab 仍显示 agent 名，跑完才一起变。
- 用例：`session_becomes_visible_only_when_a_turn_finishes` /
  `silence_without_user_input_never_reveals_the_session` / `mark_user_input_does_not_bump_the_version` /
  `follow_up_turn_keeps_the_first_title_and_visibility`（Rust）、`tabTitle` 的
  「engaged=false ⇒ 仍显示 tab 标题」（前端）。

## 18. 回到「发送即出现」+ 收紧子列表缩进（第五轮反馈）

第 17 轮把可见性绑在「一轮跑完」上，实测反馈：**发完消息什么都不出现**，要等 agent 跑完才
冒出来 —— 与预期相反。正常流程是「用户输入 → 立刻拿到标题 → 立刻建侧栏条目」。

- `SessionEntry` 回到单一 `has_user_input`，语义改为「用户已经发出过输入」；
  `apply` 不再翻转可见性（删掉 `Applied` 结构与 `TurnFinished` 分支里的翻转），
  `mark_user_input` 删除（与 `mark_user_input` 合并）。
- `report_live_session_input` ⇒ 标题 + `mark_user_input`（发送即出现）。
- `ChatRegistrationKind::has_user_input()`：`Turn` / `Resume` ⇒ true，`Silent` ⇒ false。
- `register_or_mark`：续聊（`contains`）**什么都不做**（既不重登记也不改标题）。
- 前端 `resolveTabTitle` 的 `has_user_input` 门保持不变 —— 它现在等价于「用户发过输入就换标题」。

视觉：会话子列表缩进从 `ml-[3.25rem]`（52px，离左缘太远）改成 `ml-7`（28px），
行内 `pl-2 pr-1.5`。缩进仍能表达从属关系，但不再把会话行推到面板中间。

## 19. 命名：`engaged` → `has_user_input`

`engaged` 在英文里是「订婚 / 忙于」的意思，与「用户发过输入」没有自然联系；它还同时承载
「侧栏可见」与「标题有效」两个含义，读代码的人必须先查一遍。按朴素命名统一改名：

| 位置 | 旧 | 新 |
| --- | --- | --- |
| `SessionEntry` 字段 / wire 字段 | `engaged` / `engaged` | `has_user_input` / `hasUserInput` |
| 构造器 | `with_engaged` | `with_user_input` |
| 注册表入口 | `mark_engaged` | `mark_user_input` |
| chat 启动形态 | `ChatRegistrationKind::engaged()` | `has_user_input()` |

不选 `visible` / `listed`：那是视图关注点，塞进数据层会让「已读 / 置顶」之类的下一次需求
又造一个同名字段。行为零变化（纯重命名 + 断言文案同步）。

## 20. 标题在「用户回车」时立即生成 + 停用 OSC 标题（第六轮反馈）

两条真机反馈，各指向一个具体缺陷：

### 20.1 「要会话结束才出现标题」

不是可见性判据的问题（第 18 轮已回到「发送即出现」），而是**依赖了一条新加的命令**：
前端调 `report_live_session_input`，而失败被 `.catch(() => {})` 吞掉 —— 运行中的构建只要
没重建 Rust（或缺这条命令），标题就永远只从 hook 的 `turn_completed` 来，表现为「跑完才出现」。

修法：**合并进既有命令**，不再新增通道。

- `set_live_session_title(session_id, title, source)` —— `source = 'prompt'`（用户首条输入）
  ⇒ 同时 `mark_user_input`（侧栏立刻列出）+ `set_title(Prompt)`；`source = 'native'` 只升级标题。
- 前端失败不再静默：`console.warn('[Terminal] 会话标题上报失败:', err)` —— 这条通道漏了会
  表现为「输入后侧栏一直不出现」，必须有可见线索。
- 删除 `report_live_session_input` 命令与其注册（多一个命令名在多版本并存时只会多一个静默失败点）。

### 20.2 标题开头有 `π`

`π` 是 `pi` CLI 把自己的 logo 设成终端标题（OSC 0/2）。它以 `Native` 级别覆盖了用户刚输入
的 `Prompt` 标题 —— 所以侧栏显示 `π …`。

修法：**OSC 不再是标题来源**。会话名必须来自真实内容：用户输入（`prompt`，回车即生效）或
CLI 自己命名的会话（hook 的 `title`，`native`）。随之删除 `features/terminal/utils/terminalTitle.ts`
与其 6 个用例、`TerminalViewBase` 的 `onSessionTitleChange` 通道（`TerminalViewBase.tsx`
从 553 → 529 行，低于基线，ratchet 满足）。

### 20.3 标题乱码 `10;rgb:3838/3a3a/4242…`（`onData` 不全是用户输入）

xterm 会把它**自己**对终端查询的应答从 `onData` 发出去：CLI 查前景色 → 终端回
`ESC ]10;rgb:3838/3a3a/4242 ST`（OSC 10）；查光标位置 → `ESC [12;40R`（DSR）。
第一版捕获器只处理 `ESC [ …`（CSI），把 `ESC ]` 之后的 payload 当成了正文，于是
「首条输入行」攒出 `10;rgb:…`，回车一结算就变成了会话标题（tab 与侧栏同时显示）。

修法：**含 `ESC` 的整块输入整块丢弃**。判据站得住：用户打字与粘贴都不会带 ESC，
方向键 / 功能键的转义序列也不该参与命名。顺带删掉原来的 CSI 状态机
（`pendingEscape` / `inCsi`），捕获器只剩「丢 ESC 块 + 攒到回车」。
用例：`inputTitle.test.ts` 新增 OSC 10 / DSR / 「应答不污染缓冲」三条。

## 21. 新会话自动展开 + 每页 10 条分页

- `SessionRow` 新增 `childCount`：条数**增长**即 `setExpanded(true)`。基线取 0（面板重挂载时
  「本来就有会话」也算出现）；条数不变则尊重用户手动折叠，不会被快照刷新弹开。
- `SessionList` 从「折叠 / 全部展开」二态改为**分页**：每页 10 条，`显示更多（还有 N 条）`
  每次再加一页；条数增长时回到第一页（新会话在后端排在最前，不重置就看不到它）。
- 三个装配点传入 `childCount`：`ProjectGitSection`（主仓）、`WorktreeRowList`（linked worktree）、
  `ConnectionProjectCard`（WSL / SSH 主仓）。
- 用例：`SessionRow.test.tsx` 增「新会话自动展开」「条数不变尊重手动折叠」；
  `SessionList.test.tsx` 改「每页 10 条」「显示更多每次一页」「新会话回到第一页」。

## 22. 侧栏选中态：选中只在最具体的一层

问题：会话被选中时父级（单元行）也亮，形成「同色套同色」；单元行内的图标方块还叠了
第二层 `--bg-selected`。同一事实被强调两遍，读者分不清哪个是「当前」。

按「一个轴只有一个当前项 + 表现层级用不同通道」重做：

| 元素 | 之前 | 现在 |
| --- | --- | --- |
| 会话行（当前） | `bg-bg-selected` | `row-current`：强调色 12% 淡底 + 左侧 2px 色条（原型口径） |
| 单元行（当前，且其内有当前会话） | `bg-bg-selected` | **不填充**（只保留文字语气） |
| 单元行（当前，无当前会话，如文件 tab） | `bg-bg-selected` | 不变 |
| 图标方块（当前） | 再叠一层 `--bg-selected` | 只有尺寸圆角 |

- 判据：`selectUnitsWithActiveSession`（纯函数，只看 tab 身份，不看 live 快照）+
  `useUnitsWithActiveSession`（选择器返回**排序拼接的字符串**再切 `Set`，否则每次 store
  变更都因新引用重渲染侧栏）。
- `row-current` 写成 `@utility`（`styles/base/tailwind.css`）而不是 `components/*.css`：
  只服务一个状态、够不上「组件域」门槛（该目录要求 ≥20 行），而 Tailwind 任意值会让类名
  退化成 `shadow-[inset_2px_0_0_0_var(--accent-blue)]`。
- 用例：`editorTabSelectors.test.ts` 5 个（终端 / chat / 未铸造 id / 文件 tab / 多单元排序），
  `SessionRow.test.tsx` 2 个（父行三态、图标方块无内联背景），`SessionList.test.tsx` 1 个。

## 23. 斜杠命令不是标题

实测（真机）：用户敲 `/model`，在 pi 的自动补全菜单里按回车 —— 侧栏与会话 tab 的标题都变成
`/mo`。两个独立成因，一个共同判据：

1. **捕获时机**：补全展开发生在 CLI 内部，上游字节里从没有过完整行；我们的捕获器在第一次
   回车时结算到 `/mo`。这个「前缀」既不是用户完整输入，也无从辨认。
2. **语义**：即使捕获到 `/model`，斜杠命令也是**对工具的操作**，不是「这次会话要谈的事」，
   当标题没有检索价值。

修复落在**后端唯一裁决点** `Registry::upgrade_title`：`source == Prompt &&
!title::is_title_material(text)` → 拒绝命名，但 `has_user_input` 照置（用户确实提交了，
活动态与权威状态门必须变）。于是 slash-command-only 的会话保持无名 → 侧栏不列（
`isListedSession`）、tab 回落到占位（agent 名 / `Terminal N`）；之后第一条真正的消息才命名。

`title::is_title_material` = 含至少一个字母/数字（`char::is_alphanumeric`，中文算）
**且**不是命令。命令判据取最保守形状：行首 `/` + 单个命令词（字母开头、正文无内部 `/`），
可带参数 —— 于是 `/model`、`/mo` 是命令，`/Users/tomgs/repo`、`修复 /api 的 500` 仍是内容。
只对 `Prompt` 生效（`Native` / `User` 即使以 `/` 开头也是用户真实意图）。

- 用例：`title.rs` 3 个（命令 / 路径与散文 / 纯符号）、`commands.rs` 1 个
  （`slash_command_does_not_become_the_title`：不命名但活动态变，后续消息才命名）、
  `inputTitle.test.ts` 1 个（前端**原样上报**，钉住「判据只在后端」）。
- 文档：`.trellis/spec/backend/agent-chat-transports.md`「斜杠命令与纯符号不是标题」。

## 24. Codex 状态：读 CLI 自报的 OSC 7501

真机反馈：codex 的「Worked for 20s」已经结束，侧栏仍是绿色运行中；进入 tab 也不灭。

### 排查（有证据，不是猜）

1. `~/.codex/config.toml` 里 `notify` 指向我们的 shim，`~/.neeko/neeko.log` 里确有
   `POST /hook/codex -> 204`，但**注册表没收到权威事件**：`hints.neeko_session_id` 为空。
2. 用 `script` 起真实 codex TUI（临时 `CODEX_HOME`，不动用户配置）实测：TUI 会拉起
   `app-server` **daemon**，`notify` 由 daemon 执行 —— daemon 的 env 里没有
   `NEEKO_SESSION_ID`（`ps eww` 证明：`PWD=/`，无 NEEKO_*）。归因失败 ⇒ 权威门从未置位。
3. 同一份抓包暴露了真正的第一级事实：TUI 在输出流里自报
   `ESC ] 7501 ; state=working|idle:app=codex ST`。同时存在 `ESC ] 0 ; ⠋ codex` 标题
   （仍不参与命名）与 OSC 10/11 查询。
4. 因此静默推断永远等不到 1.5s 静默（codex 完成后仍周期性重绘）⇒ 一直 Running。

### 修法

- `agent/cli_status.rs`（新）：**数据表** `CHANNELS`（目前只有 codex：OSC 7501 /
  `state=working` / `state=idle`）+ 流式 `StatusScanner`（跨 chunk、一块多次转换取最后一次、
  未知值忽略、载荷上限 96 字节、ST/BEL 两种终止符）。解析器不认识任何具体 CLI。
- `wiring/pty.rs`：`OutputActivity::new(channel)` / `observe(bytes)`；
  `poll` 先应用自报（`apply` 直接信号），**自报出现过就停用静默推断**（`cli_seen`）；
  没通道的 agent 行为完全不变。
- `terminal/services.rs`（本地 / WSL）与 `terminal/remote.rs`（SSH）都改成
  `OutputActivity::new(live.and_then(|l| l.status_channel()))` + `observe(bytes)` ——
  远端同样生效，判据只有一份。
- 用例 14 个：`cli_status` 9 个（真实字节形态、逐字节分块、BEL、多序列、干扰 OSC、未知值、
  超长载荷、截断序列、无通道 agent）、`wiring::pty` 5 个（无通道时重绘仍读 Running（旧 bug 形态）、
  自报覆盖推断、进入 tab 的重绘不改状态、poll 应用与幂等、非声明 agent 不吃裸字节）。

## 25. 标题准入判据：先收敛写路径，再加判据（`design.md` §11）

### 25.1 顺序不能反过来

上一版把「加 `admit`」当第一步，结果是它必须同时挂在 `registry::upgrade_title` 和
`title::pick` 上 —— 因为 `SessionEntry::new` 收的是 `pick` 的成品，是**唯一绕过
`upgrade_title` 的写路径**（`registry.rs:86` 的 `register_if_absent`）。

在一个已经有两份判据的系统里再造第三份，就是这次要修的病本身。所以顺序是：

> **先消掉第二条写路径（25.2），再加唯一准入判据（25.3），其余顺带收敛（25.4 / 25.5）。**

分类标准：**移除这一层，行为不变、只是变慢 ⇒ 优化；移除后出错 ⇒ 判据。**
25.2–25.5 是判据，25.6 是优化（措辞修正，零代码）。

### 25.2 D1 · 单写路径（第一个做，收益最大）

- [x] 25.2.1 `SessionEntry::new` 去掉 `title: (TitleSource, String)` 参数，恒置
      `(TitleSource::Placeholder, String::new())`（`entry.rs:110`）。
- [x] 25.2.2 `ChatRegistration` 改成一个 `titles()` 返回**升序候选**（`Prompt` 在前、
      `Native` 在后），`register_or_engage` 在 `register_if_absent` 之后依次
      `registry.report(sid, Some((source, text)), false)`，让 `should_upgrade` 自己选强的。
- [x] 25.2.3 删除 `title::pick` 与其 4 个用例；`entry.rs:117` 的文档注释、
      `view.rs:160` 的注释同步改（提到 `pick` 的地方全部改为 `admit` / `should_upgrade`）。
- [x] 25.2.4 **必须与 25.3 同一个 commit** —— 分开做会留下「`pick` 也学会了 `admit`」的中间态。

### 25.3 D2 · `admit` 取代 `is_title_material`

- [x] 25.3.1 `title.rs`：`is_title_material` → `admit(source, raw, agent_id) -> Option<String>`，
      按 `TitleSource` **穷举 match**（新 variant 编译期强制处理）；`is_command_line` 降为私有。
- [x] 25.3.2 `registry::upgrade_title`：`let Some(title) = title::admit(...) else { return false }`，
      删掉 `if source == TitleSource::Prompt` 分支（`registry.rs:422`）。
- [x] 25.3.3 `commands::apply_title` 的 `_ if title.trim().is_empty() => false` 分支删除
      （空白已由 `admit` 判负）。
- [x] 25.3.4 `Native` 四条子判据按**不确定性升序**实现：剥装饰 → 字符数 ≥ 2 → 状态词 /
      `Terminal N` / cwd → 身份回显（最后做，见 `design.md` §11.4 末段）。

### 25.4 D4 · `Placeholder ⟹ 空标题` 的连锁收敛

- [x] 25.4.1 `registry::has_real_title`（`registry.rs:438`）退化为 `!entry.title.is_empty()`。
- [x] 25.4.2 `liveSessionSelectors.ts:62` 的 `isNamedSession` 退化为 `title.trim().length > 0`；
      `resolveTabTitle`（`tabTitle.ts`）改为复用 **`isListedSession`**（不是 `isNamedSession`）——
      「什么时候用注册表标题」与「什么时候把会话列进侧栏」是同一条判据，复用更外层那个
      才不会漏掉 `hasUserInput`。
- [x] 25.4.3 删除 `SessionList.tsx:104` 的 `titleSource === 'placeholder'` 分支与其注释
      （不可达：`isListedSession` 已挡住），`SessionList.tsx:19` 的说明同步改。
- [x] 25.4.4 用例：`set_live_session_title(source = placeholder, title = "x")` ⇒ 不写入
      （堵上「IPC 可控 source」这个当前敞着的洞）。

### 25.5 D5 · 预算前缀合并进 `admit`

- [x] 25.5.1 `truncate` 改为 `budgeted(text)` 零分配前缀切片后再折叠/截断
      （`char_indices().nth(BUDGET)`，**不要** `chars().take().collect()`）。
- [x] 25.5.2 `truncate` 降为私有（对外只剩 `admit` + `should_upgrade`）；
      `view.rs:109` 若只是测试引用，改断言口径。

### 25.6 D3 · 传输优化（不是判据，措辞修正，零代码）

- [x] 25.6.1 前端恢复 `Native` 上报（`TerminalViewBase.tsx` 的 `term.onTitleChange`）：
      只做两件**无语义**的事 —— 与上次原文逐字相同不发、首次 `reportUserInput` 之前不发。
      不剥装饰、不过滤、不判负。
- [x] 25.6.2 删掉 `liveSessionsApi.ts` 里「为什么不再回传 OSC 标题」那段注释（前提已不成立），
      改写成「判据只在后端；前端只做传输去重」。
- [x] 25.6.3 **回滚点**：25.6 整体独立于 25.2–25.5。真机再出噪声先摘 25.6（回到 §20.2 的行为），
      后端准入判据保留 —— 它同时给 hook `topic` 与 `set_title` 服务。

### 25.7 用例（AC10 / AC11）

- `title.rs`：每个 `TitleSource` 一条 ——
  - `Placeholder` 永远 `None`（含非空文本）；
  - `User` 只要非空就通过，不套清理；
  - `Prompt`：斜杠命令 / 纯符号 / 剥完为空的客套句 → `None`；真主题 → 通过；
  - `Native`：`π`、`✳ Claude ready`、`ready`、`idle (2m)`、`Terminal 3`、`/Users/tomgs/repo`、
    `claude-code`（身份回显）→ `None`；`✳ Fix login bug`、`修复登录竞态` → 通过；
  - 扫描预算：`"a".repeat(BUDGET) + "尾部标记"` 的结果**不含**尾部标记。
- `registry/tests.rs`：`Prompt` 命名后 `set_title(Native, "✳ Claude ready")` ⇒ `title` /
  `title_source` **均不变**（证明准入在 `should_upgrade` 之前）。
- `chat.rs`：登记候选升序 apply 后取到 `Native`（topic）而不是 `Prompt`；两条都判负时留空占位。
- `commands.rs`：`set_live_session_title(source = native, "π")` 返回 `false` 且条目不写。

### 25.8 验证 / 真机 / 触发条件

- 静态：`cargo test --lib live_sessions` → 收尾 `pnpm check:quick`（只跑一次）。
- 真机（并入 AC8）：开 pi 会话，首条输入后标题是**那条输入**而不是 `π`；开 Claude Code 会话，
  确认 OSC 的 `✳ <任务>` 能成为标题、idle 的 `✳ Claude ready` 不会把标题改回去。
- **升级触发条件**（`design.md` §11.9）：真机出现 ≥2 例 `admit` 漏判（标题被某个固定短串
  占住且不恢复）⇒ 才考虑给 OSC 独立等级；1 例按 25.3.4 补一条子判据。

### 25.9 实施记录（已完成 25.2–25.7）

改动文件：`title.rs`（重写）、`entry.rs`、`registry.rs`、`wiring/{chat,pty,hooks}.rs`、
`commands.rs`、`view.rs`、`cursor.rs`、`mod.rs`、`liveSessionSelectors.ts`、`tabTitle.ts`、
`SessionList.tsx`、`TerminalViewBase.tsx`、`liveSessionsApi.ts`、新增
`features/terminal/utils/sessionTitleReporter.ts`（+ 7 用例）。

**落地时与原计划的偏差**（都不是口味问题，各有一条硬约束）：

1. **上报闸门连 IPC 一起收进 `sessionTitleReporter.ts`**（原计划写在组件体内）。
   两条理由：`check_component_size` 对 `TerminalViewBase.tsx` 的 ratchet 是 542 行、
   只许缩小；而「OSC → 注册表」这条通道的所有者本来就该是同一个模块 —— 调用点各写一份
   `.catch(console.warn)` 是同一事实的多份表达。组件侧只剩一行 `installSessionTitleReporting`。
2. **`report_first` 签名改成 `&[(TitleSource, &str)]`**（原计划只改 `ChatRegistration`）。
   否则「登记时按升序 apply」与「Engage 时取最强」会成为两套候选处理；升序 apply 在两条
   路径上复用同一个 `for`，`pick` 才真的可以删掉。
3. **`registry_with` 测试夹具改走 `set_title`**（原计划未提）。夹具直接塞字段能造出
   `admit` 不会放行的状态，那样测的就不是生产路径了。
4. **`terminal_entry` 夹具的 `Placeholder + "pi"` 被删**：它违反新不变量
   （`Placeholder ⇒ 空标题`）。这正是 D4 要消灭的那类「生产不可能出现的状态」。
5. **`native_title_never_overrides_a_user_title` 的 Native 值从 `"claude"` 改为
   `"a cli topic"`**：`claude` 现在是 `claude-code` 的身份回显，会被**准入**拒掉 ——
   用例会因错误的理由变绿，测不到它名字说的「覆盖序」。
6. **前置门的实现是前端本地状态**（`markUserInput`），不读注册表：它是传输优化，
   读注册表就等于把优化耦合到快照时序上。

**测试口径**：`title.rs` 15 个（4 个来源穷举 + 覆盖序 + 预算前缀 + 多字节边界）、
`registry/tests.rs` 与 `commands.rs` 各补「判负不改写」「`Placeholder` 经 IPC 也不写」，
`sessionTitleReporter.test.ts` 7 个（闸门两件事 + IPC 接线 + dispose）。

**已知遗留**：`cargo test --lib` 当前 84 个失败全部来自工作区里 `migrations.rs` 的
`LATEST_VERSION: 13 → 17`（14–17 的迁移未登记），与本任务无关；`live_sessions` 112 个全绿。

## 26. 点击会话行支持恢复（A：重建）

真机反馈：侧栏里点某条会话**没反应**。

### 26.1 根因：`!tab` 是一条静默死分支

`useActivateSession` 原来的三步是 `sessionTab()` → `if (!tab) return` → `activateTab()`。
第二步没有任何日志、也没有兜底 —— 映射键（terminal 的 `ptySessionId` / chat 的 `sessionId`）
一旦缺失，点击就静默失效。而侧栏**照常列出**这条会话：分组只用 `workspaceKey`，
不需要那个键。于是「列表里有、点了没反应」。

### 26.2 三级降级（`utils/sessionActivationPlan.ts`，纯函数）

| 情况 | 计划 | 动作 |
| --- | --- | --- |
| 映射键命中 | `activate` | 激活（绝大多数点击） |
| 键丢了，且**唯一**一条同 agent 的孤儿 terminal tab | `bind` | 把会话 id 补写回那条 tab，再激活 |
| 其余 | `recreate` | 按会话重建 tab |

- **为什么 bind 先于 recreate**：不认领的话那条 tab 永远点不开，而且每次点击都会再建一条新的，
  孤儿越积越多。`bind` 顺带把存量 tab 永久修好。
- **为什么只在唯一命中时 bind**：多个候选说明无从判断哪条才是这条会话，猜错会把身份写到
  别人的 tab 上（那个 tab 之后再也点不开自己）。宁可重建。
- **只认 terminal**：chat 的空 `sessionId` 是「用户刚打开还没发消息」的正常形态，认领给一条
  历史会话是真正的身份串线。

### 26.3 重建（`recreate`）

- terminal：新建 `data: { kind: 'terminal', agentId }` 的 tab，`TerminalViewBase` 会用
  `agentId` 自动拉起该 agent；配额（`MAX_TERMINAL_TABS`）满则放弃。
- chat：新建 `agent-chat` tab（只带 `agentId`，不带旧会话标题）。
- 标题用中性占位（`Terminal N` / `Agent Chat`），**不贴旧会话名** —— 这是一条新 tab，
  贴上旧名字会让人以为对话被接上了。真标题到手后由 `resolveTabTitle` 渲染期覆盖。

### 26.4 用例

`sessionActivationPlan.test.ts` 9 个：键命中 / 孤儿认领 / 多孤儿拒绝 / agent 不匹配拒绝 /
已绑别的会话拒绝 / 无 tab 重建 / chat 不认领空 tab / chat 键命中 / terminal 不认领 chat tab。

### 26.5 未覆盖：真正的「续写同一会话」

重建出来的 terminal 是**新会话**，不是 resume。要复用 history 的 resume，需要
`ResumeCursor` 之外的**agent 原生会话 id**：

- 唯一现成来源是 hook 的 `HookEvent.agent_session_id`（`agent/hooks/ingest/event.rs:39`）；
- 落点：`SessionEntry` 增 `native_session_id`，由 `wiring::hooks::project` 填充，
  随 `SessionView` 下发；
- 命令层新增 `live_session_resume_command(session_id)`：conversation id 由
  `{agent_id}:{native_id}` 组成（`parse_conversation_id`），可直接复用
  `ConversationManager::get_resume_command`；
- 前端重建 terminal 时用 `resolveAgent(agentId).command` + 返回的 args 拼 `taskCommand`，
  与 `ConversationsPanelWrapper.handleResumeConversation` 同形。

代价是跨栈 6 处改动（wire 契约 + 前端类型 + 序列化用例），且只覆盖装了 hook 模板的 agent。
**当前不做**，等「重建后想接着聊」被真实需要时再上。

### 26.6 补：点不动是「只切了 tab，没切单元」

§26.2 的三级降级解决的是「找不到 tab」，但真机第二次反馈**仍然点不动** —— 因为
`useActivateSession` 只做了两件事：`setActiveWorkspace` + `activateTab`。

而「切到某个单元」在三个侧栏里各有**一份正确的序列**：

| 侧栏 | 序列 |
| --- | --- |
| worktree 行 | `handleOpenWorktreeTerminal`：跨项目 `setActiveProjectId` + 后端 `setActiveProject` → `activateWorkspace` → `markWorkspaceOpened` → `saveWorktreeState` → `setViewTerminal` |
| local 行 | `onSelectProject`：`setActiveProjectId` + 后端 `setActiveProject` |
| WSL/SSH | `handleOpenWorktreeTerminal`（同上） |

`setActiveWorkspace` 只是上表**中间一步**。跨项目点击时 `activeProjectId` 没变 ⇒ 视图仍渲染
旧项目的 tab 空间，`activateTab` 写进了用户没在看的地方 —— 表现就是「点了没反应」。
而行本身仍然高亮（`activeSession` 是按**该单元自己的** `activeTabId` 算的），所以从截图看不出
「你点的是一条不在前台的单元」。

**修法：不在这里重写第三份序列，而是让调用方注入**（低耦合 + 零漂移）：

- `WorktreeRowList.renderUnitSessions` 的签名变成 `(workspaceKey, revealUnit) => ReactNode`，
  `revealUnit` 就是本行现成的 `onOpenWorktreeTerminal(wt.path, wt.branch)`；
- `UnitSessionList` 增 `onRevealUnit?: () => void`，点击时**先 reveal 再 activate**
  （反过来的话中间一帧是白屏：tab 已切、视图未切）；
- `ProjectGitSection` / `ConnectionProjectCard` 的 local 行传 `onSelectProject(project.id)`。

用例：`UnitSessionList.test.tsx` 增「先 onRevealUnit 再 activate」的顺序断言。

### 26.7 补：重建要「续写」而不是「重开」

§26.6 之后点击能开 tab 了，但开出来的是**新会话**。要复用 history 的 resume，缺的是
**agent 原生会话 id** —— `ResumeCursor` 存的是 neeko 自己的 `session_id`，对 CLI 无意义。

链路（跨栈，四层各一句）：

| 层 | 改动 |
| --- | --- |
| `entry.rs` | `SessionEntry.native_session_id: Option<String>`（**不进 wire 契约**：视图不显示、不派生） |
| `registry.rs` | `record_native_session_id`（只写一次、未知会话不建条目、**不 bump 版本**）+ `entry(id)` 快照读 |
| `wiring/hooks.rs` | `project()` 里顺手记 `event.agent_session_id` —— 唯一来源 |
| `conversation/manager.rs` | `resume_command_for_native(agent, native_id, cwd)`：**不经过扫描缓存**（否则「必须先去 Histor 打开一次才能恢复」是死入口） |
| `live_sessions/commands.rs` | `live_session_resume_command(session_id) -> Option<Vec<String>>` |
| 前端 | `useActivateSession` 重建 terminal 时 `taskCommand = <agent.command> <agent.args…> <resume args…>` |

为什么 `taskCommand` 必须是**完整命令行**：`TerminalViewBase` 一旦看到它就跳过自动拉起
agent 直接执行（`if (tabAgentId && !taskCommand)`）。

**能力的真实边界**（三条都退回「新建同 agent 终端」，不猜）：
会话没有 agent（纯 shell）、agent 没装 hook（拿不到 native id）、adapter 不支持原生恢复
（`resume_command` 返回 `None`，例如需要 transcript 绝对路径的 Reasonix）。

用例：`registry/tests.rs` 1 个（写一次 / trim / 未知会话 / 不 bump）、
`conversation/manager.rs` 1 个（无扫描缓存也能取到 / 未注册 agent 返回 None）、
`UnitSessionList.test.tsx` +2（有参数 ⇒ 带 `taskCommand`；无参数 ⇒ 不带）。

## 27. 关 tab 不再摘掉侧栏那一行

真机反馈：关掉 tab，侧栏里那条会话就没了 —— 于是「点击恢复」根本没有入口。

### 27.1 「关 tab」与「会话结束」是两件事

`TerminalRouter::close_session` 原来先 `unregister_and_notify` 再关 PTY，注释写的是
「会话已不在，侧栏不得留幽灵行」。但它把两种语义压成了一种：

| 触发 | 之前的动作 | 现在的动作 |
| --- | --- | --- |
| 用户关 tab | 注销 | `close_and_notify`：`apply(Stopped)`，**不注销** |
| 进程自己退出 | `apply(exit_signal)` + 注销 | 不变 |
| 销毁单元 / 清 tab 空间 | 注销 | 不变 |

于是侧栏那一行留着（状态点变 stopped），点击就走 §26 的恢复链路。

### 27.2 `on_exit` 必须认得「这次退出是主动关闭的尾巴」

只改 `close_session` 不够：它先标 `Stopped`，PTY 随后退出又会走 `exit_and_notify` →
`unregister`，行照样消失。所以 `on_exit` 加一条前置判据：

> 条目已经是 `Stopped` ⇒ 这是主动关闭的尾巴，只确认状态、不注销。

不需要新字段：`Stopped` 本身就是那个标记（`close_and_notify` 是唯一能在 PTY 还活着时把它
写成 `Stopped` 的地方）。

### 27.3 恢复成功后旧条目让位

留着条目的直接后果：点回来之后，新会话是**另一条** id，侧栏会同时挂着「已停止」与「新会话」
两行。所以重建成功后调 `forget_live_session(sessionId)` 摘掉旧条目。

**只对终止态生效**：活着的会话被这条命令摘掉就是「侧栏少了正在跑的会话」，那不该由一次
点击造成。

### 27.4 用例

- `wiring/pty.rs` +2：`closing_a_tab_keeps_the_session_as_stopped`（标 Stopped / 幂等）、
  `exit_after_an_explicit_close_does_not_unregister`（**回归钉子**：尾巴不得摘条目）。
- `UnitSessionList.test.tsx`：重建后断言 `forgetLiveSession('pty-1')` 被调用。

### 27.5 已知代价

关 tab 的条目留到本次运行结束（注册表是内存态）。它是**恢复点**而不是垃圾；单元被删除时
也不会被回收，只是不再渲染（没有单元行就没有子列表）。要回收就得给 `close_terminal_session`
加一个「销毁」标志，当前不值得 —— 条目是几十字节的内存对象。

### 27.6 补：恢复后那一行不能消失

§27.3 用 `forget_live_session` 让旧条目退场，结果真机反馈「点击恢复后列表消失了」。
成因是**只做了退场，没做继承**：

新 PTY 注册出来的是空条目（`title = ""`、`title_source = Placeholder`、
`has_user_input = false`），而 `isListedSession` 要求 `hasUserInput && 有名字` ⇒
**它不会被列出**。旧条目被摘掉、新条目又列不出来，中间就是一片空白 —— 要等用户敲进新终端
的第一条输入才恢复。

修法：把「退场」换成「**继承 + 退场**」，一条命令做完（`adopt_live_session`）：

| 不继承 | 不退场 |
| --- | --- |
| 新条目列不出来 ⇒ 那一行消失 | 侧栏同时挂着「已停止」与「新会话」两行 |

`Registry::adopt(from, into)` 三条判据：

1. `from` 必须是**终止态** —— 把活着的会话合并掉，等于点一次丢一条正在跑的会话；
2. 只搬 `into` **缺**的字段（标题 / `has_user_input` / `native_session_id`），不覆盖它
   已经拿到的更新事实；
3. `from == into` 直接拒绝。

前端用 tab 上的 `resumeFromSessionId` 携带来源，`TerminalView.handleSessionCreated` 在
PTY 创建成功后消费一次。**不清理这个字段**：`adopt` 对已消失的 `from` 是 no-op（幂等），
而 `updateTab` 的 merge 把 `undefined` 读作「保持原值」，本来也清不掉。

用例：`registry/tests.rs` +2（继承 + 退场 + 幂等；活着的 from 被拒）、
`UnitSessionList.test.tsx` 改为断言 `resumeFromSessionId` 落在 tab 上。

## 28. 关 tab 时「会话还在跑」：后台运行 / 退出 / 取消

### 28.1 为什么不能直接关

原来的关 tab 一律 `close_terminal_session`：正在干活的 agent 被顺手杀掉。三条关闭路径
（TabBar X / 菜单 Close Tab / Cmd+W）都汇到 `closeTabWithConfirmation`，所以这件事只需要
在**那一个**编排点做。

### 28.2 后端：分离态是前提，不是优化

关掉界面但进程继续跑，就没有消费者了。若照常背压，512KB 的 drain 写满 → PTY 写入被堵死
→ 后台 agent 冻住。所以 `SessionDrain` 增 `detached`：

- 分离态 `push` **永远接收**，超出 `DETACHED_TAIL_CAPACITY`（256KB）时丢**最旧**的字节；
- 一次多丢一些（削到半容量）避免每次 push 做 O(n) 前移；
- 接回界面时关掉分离态，恢复正常背压。

命令 `detach_terminal_session(session_id, detached)` 兼任**存活探针**：drain 不存在
⇒ 会话已结束 ⇒ 返回 `false`。drain 的存活就是 PTY 的存活，不必再加一条 `ping`。

### 28.3 前端：三条关闭路径共用一个确认宿主

`closeConfirmStore` 从「只服务未保存文件」扩成两种请求（`unsaved-file` / `running-terminal`），
**共用同一个浮层 id、同一份 `hostMounted` 守卫、同一个 resolver 槽位** —— 各自再写一套的话，
「无宿主时必须立即 cancel，否则调用方永久挂起」那条守卫会漏掉其中一套，表现为关闭静默失效。

| 选择 | 动作 |
| --- | --- |
| 后台运行 | `detachTerminalSession(id, true)` → `closeEditorTab(..., { keepSession: true })` |
| 退出进程 | `closeEditorTab(...)`（正常关会话） |
| 取消 | 什么都不做 |

`keepSession` 从 `closeEditorTab` → `cleanupTerminalsForTab` → `destroyTerminalsForTab`
→ `destroyCache` 一路透传到 `closeSession` 那一行：**只拆界面，不结束进程**。

### 28.4 接回：`attachSessionId`

「后台运行」之后再点那一行，不能走 `--resume`（那会起一个**新**进程）。所以：

- 会话还活着（`isLiveSession`）⇒ 新 tab 带 `attachSessionId: session.sessionId`；
- `TerminalViewBase` 见到它就跳过 `createSession`，改走 `attachLiveSession`
  （关分离态 + 补一次 `resize`），探不到就照常新建；
- **接回时必须跳过 auto-launch**：否则会把 agent 再启动一次灌进正在跑的会话。

为什么是 `attachSessionId` 而不是复用 `ptySessionId`：后者每次新建会话后都会变，
放进 effect 依赖会让「会话一建好就整段重建一次」。

### 28.5 用例

- `drain.rs` +1：`detached_drain_never_backpressures_and_keeps_only_the_tail`（回归钉子）。
- `closeConfirmStore.test.ts` 与三个既有用例：pending 形状改为带 `kind` 的判别联合。
- `terminalCloseConfirm.test.ts` 新增 5 个：弹框 / 后台运行 / 退出 / 会话已结束不问 / 注册表
  里没有这条会话。
- `TerminalCloseConfirmDialog.test.tsx` 新增 2 个：三个选项都在且点名会话 / 每个按钮只回调
  自己那一个动作。
- `UnitSessionList.test.tsx`：新增「会话还活着 ⇒ 新 tab 带 `attachSessionId` 且不调 resume」；
  其余重建用例改用 `state: 'stopped'` 的会话（活着的走接回）。

### 28.6 修正：agent 干完了就不该弹框

§28.2 用 `isLiveSession`（进程活着）当弹框判据，把 `ready` 也算进去了 —— 于是**每个干完活的
tab 都问一次**，用户学到的教训是「无脑点退出」。

「进程活着」与「有活要丢」是两个问题，拆成两个谓词：

| 谓词 | 为真 | 用途 |
| --- | --- | --- |
| `isLiveSession` | `running` / `awaitingApproval` / **`ready`** | 点会话行时**接回**那条活着的 PTY |
| `isBusySession` | `running` / `awaitingApproval` | 关 tab 时**要不要弹框** |

- `ready` ⇒ 不弹框，直接走「退出进程」那条路（`closeEditorTab` 正常关会话）；
- `awaitingApproval` ⇒ 仍然弹：那一轮还没完，丢掉就是丢未完成的工作。

用例：`liveSessionSelectors.test.ts` +2（两个谓词对五种状态的取值）、
`terminalCloseConfirm.test.ts` +2（`ready` 不弹框且不切分离态 / `awaitingApproval` 仍然弹）。

---

## 29. 修复轮（全量复审后按第一性原理收敛）

复审结论：功能正确，但若不对下面几处做收敛，后续每加一个字段 / 一个 CLI / 一条关闭路径都要
改三处，而漏改的表现全是**静默失效**。修复遵循「单一事实一个写入点 + 差异落数据 + 复用既有端口」。

### 29.1 Block：DB 版本号被误带入

`common/db/migrations.rs` 的 `LATEST_VERSION` 被改成 17，但 `migrate_step` 只处理 `0..=11`
与 `12`，`_ => bail!`。后果是**任何**库（全新 / 已存在）在启动时迁移失败，`fresh_database_
migrates_to_latest` 必红。与本期无关，回滚为 13。
（教训：`check:quick` 不跑 `cargo test`，这条只能由 CI / 真机启动拦住。）

### 29.2 标题判据拆模块 + CLI 差异落数据

- `title.rs`（353 行、4 个来源的策略 + 文本工具）→ `title/{mod,judge,text,prompt,native}.rs`；
  `mod.rs` 只有 `mod` + `pub use`（红线 9），每个文件一件事。
- `native.rs` 的判据从 `matches!` 联合体 / 内联词表改为**常量表**：`BRAND_GLYPHS`、
  `SPINNER_RANGES`、`WORK_PREFIXES`、`STATUS_WORDS`、`STATUS_PHRASES`、`ID_SUFFIXES`。
  新增 CLI = 加一行数据，判据函数不改（与 `cli_status::CHANNELS` 同一条原则）。
- 长度上界的对外暴露改为仅测试构建（生产代码经 `text` 直接取），避免 `unused_imports`。

### 29.3 自报状态信箱：读侧去锁、状态去重

`agent::cli_status::StatusMailbox` 承接「扫描 + 发布」：扫描器只在**写侧**（唯一写者），
结果经 `AtomicU8` 发布；`poll` 侧 `take_pending` / `has_reported` 全为原子读。
`OutputActivity` 回到「时间戳 + 可选信箱」的组装角色 —— 删掉 `CliProbe` 与 `cli_seen`
（后者是前者的派生态，两份状态迟早漂移）。

### 29.4 「关 tab 后台运行」只留一个 owner

编排层不再自己 `detachTerminalSession`：一个 tab 可拆多 pane、各自一条 PTY，
只有 `terminalCache.destroyCache(keepSession)` 能枚举**全部** session id。
`store/closeTab.ts` 只负责决策，分离态由缓存层按 pane 切。

### 29.5 tab 创建/关闭编排各归其位

| 关注点 | 落点 |
| --- | --- |
| 「问用户」 | `editor/store/closeConfirmStore.ts`（zustand + resolver，泛型 `suspend<A>` 消灭两处 `as`） |
| 「按答案做事」 | `editor/store/closeTab.ts`（无状态编排；`store/` 是 editor 域对其它域放行的直导路径） |
| 终端 tab 的造法与配额 | `terminal/api/taskTerminal.ts::createTerminalTabIn`（显式收 `WorkspaceSession`，键从 tab 自身推导） |
| 按会话重建 tab | `live-sessions/utils/sessionTabFactory.ts`（接回 / 续写 / 新建 chat 三分支） |

`useActivateSession` 回到纯编排（判据 → 切视图 → 激活/补键/重建），不再手造 `Tab`、
不再留第二份 `10`、不再自己拼 argv。

### 29.6 argv 组装唯一实现

`shared/utils/agentCommand.ts`：`quoteShellArg`（安全集不加引号）/ `quoteShellValue`
（prompt 恒加引号，沿用既有契约）/ `shellJoin` / `buildResumeTaskCommand` / `buildAgentCommand`。
Histor 面板与侧栏「点回来」共用 `buildResumeTaskCommand`；自动拉起 agent 的终端输入改用
`buildAgentCommand`。参数含空白不再被拆成两个。

### 29.7 去重键归一（spinner 帧不再逐帧 IPC）

`sessionTitleReporter` 的去重从「逐字比较」改为「归一后比较」（去掉非字母数字、折叠空白）：
CLI 每帧重绘只换字形（`⣋ fix bug` → `⣙ fix bug`）时不再发 IPC；文字真的变了仍然发。
判据仍在后端 —— 归一**只喂去重槽位**。

### 29.8 其它

- `editorStore.mergeTabData` 的 terminal 分支改为字段表驱动（`Record<Exclude<keyof TerminalTabData,
  'kind'>, true>`），**加字段忘登记 = 编译错误**（原来是静默 no-op）。
- `adopt` 走 `upgrade_title` 继承标题：`entry.rs` 声明的「标题只在 upgrade_title 一处写入」
  重新成立；活着的会话仍不得被合并。
- `title::is_title_material` 的残留引用（`inputTitle.ts` / 测试）改为 `title::admit`。
- 去掉挂在 `#[tauri::command]` 上无效的 `#[must_use]`（`detach_terminal_session` 的保留 ——
  clippy 的 `must_use_candidate` 要求）。
- `terminalTabCleanup.test.ts` 新增「每个 pane 都切分离态」用例；`closeTab.test.ts` 改为
  决策矩阵（8 例）；`sessionTitleReporter.test.ts` 新增 spinner 帧去重用例。

**验证**：`cargo test --lib` 2556 passed / `pnpm check:quick` 25 条护栏全绿（含 clippy -D warnings）。

### 29.9 第二轮收敛（复审复核后的四类副本）

| 副本 | 收成 |
| --- | --- |
| 终端配额 `10`（store 字面量 / terminal 端口常量 / `app/hooks` 本地副本） | `shared/utils/terminalTabTitle.ts::MAX_TERMINAL_TABS`，三处同源（store 不能依赖 features，所以常量必须在 shared） |
| agent-chat tab 造法（侧栏 / Action Menu / 项目引导页 / Histor 恢复） | `agent-chat/api/openChatTab.ts::openAgentChatTab`（`api/` 是防火墙放行的直导面，且不引入 UI 依赖）+ 4 例直测 |
| `mergeTabData` 的 `agent-chat` 逐字段 presence 合并 | 与 terminal 合并进 `mergeByFields` + `MergeRule`（`keep` / `clear`），字段表是唯一登记点（加字段忘登记 = 编译错误） |
| 跨线程自报信箱（落在契约层 `agent::cli_status`） | `live_sessions/wiring/status_mailbox.rs`（契约层回到纯解析、零线程；探针本域持有移交件） |

顺带收回无消费者的公开面：`shellJoin`（模块私有）、`createTerminalTabIn` / `MAX_TERMINAL_TABS` /
`generateTerminalTabId`（从 terminal 门面移除，调用方直接取 api / shared）；
`installSessionTitleReporting` / `installUserInputReporting` 合并为 `installTerminalReporting`
（两条通道同装同卸，组件侧只持一个 `dispose`）。
`title/mod.rs` 的测试期条件导出改为直接声明 `pub const MAX_TITLE_CHARS`（公开面在两种构建下一致）。

**验证**：`cargo test --lib` 2556 passed；前端全量 `vitest run` 704 文件 / 6492 用例；`pnpm check:quick` 25/25。

## 29. 完成度盘点（2026-11-02）

### 29.1 代码与用例：全部落地

| 层 | 证据 |
| --- | --- |
| 纯层 | `state::reduce` 穷举 5 状态 × 9 信号（`reduce_covers_every_state_signal_pair`）；`title::admit` 按来源穷举 |
| 注册表 | `live_sessions::registry` 28 个用例（重复 id / 迟到信号 / 未变不 bump / 排序 / 长轮询） |
| 两个生产者 | `wiring::{chat,pty,hooks}` 41 个用例 |
| IPC | 5 条命令全部注册（`lib.rs:131-135`）+ 2 条终端命令（`:125-126`） |
| 前端 | 79 个用例（selectors / SessionList / SessionStatusIcon / tabTitle / bridge / activation / close-confirm） |
| 门禁 | `cargo test --lib` 2556 passed；`pnpm check:quick` 25/25 |

### 29.2 本轮核对时发现并修掉的一处漂移

`prototype.html` 的 `.session[aria-current="true"]` 还带着 `box-shadow: inset 2px 0 0` ——
那是 §22 记录、后来按反馈从实现里删掉的左侧色条。按 §7.5 自己的规矩（「差异要么改实现、
要么改原型并在此记录理由」）同步删掉，两边现在只有一个通道（强调色淡底）。

### 29.3 仍未完成的项（都需要真人 + 真机）

| 项 | 为什么不能由代码证明 |
| --- | --- |
| AC8 真机视觉 | 「图标随状态变化 / 会话行密度 / 五状态视觉」只能看，不能断言（jsdom 里没有真实布局） |
| 4.3 退出码两态真机 | 单测覆盖了映射；真跑一次 `exit` 与 `false` 才算验收 |
| 9.2 静态判据（`SessionState` 赋值只允许在 `live_sessions/`） | 判据本身没实现。**当前事实上成立**（只有注释提到它，没有赋值点），但守住它的是纪律而不是护栏 |

§29.3 这三项不阻塞「功能可用」：前两项是验收动作，第三项是加固。

## 30. 删除会话连 tab 一起关

侧栏行尾菜单的「Delete」原来只做后端的事（结束进程 + 摘条目）：tab 还开着，里面是一个
已经死掉的终端面板 —— 会话没了却留下它的视图，只是噪声。

顺序在**前端**定，而且是唯一能避免告警的地方：

1. `closeEditorTab(workspaceKey, tabId)` —— 走既有的关闭入口，进程正常结束；
2. `delete_live_session(sessionId)` —— 此时 `owns_terminal_session` 已为假，只剩 `unregister`。

反过来（先删条目）会怎样：tab 的关闭路径仍会去 `close_session` 一个已不存在的进程，
后端只能记一条 `unknown session` 告警。

`closeEditorTab` 在前端手上（`@/features/terminal` 门面），不需要为「删除」新开一条命令。
没有关联 tab 的会话（后台运行中 / tab 已关）走同一条路径，只是第 1 步是 no-op。

用例：`useSessionRowActions.test.ts` +3（有关联 tab ⇒ 关掉它再删 / 无 tab 只删 / 取消则
两者都不动）。

## 31. 复审收敛轮（按第一性原理重排归属）

复审结论：功能可用，但四处「唯一入口」在实现里被绕开了 —— 每处都表现为「下一个调用方
照抄一遍，然后静默失效」。本轮按「单一事实一个写入点 / 差异落数据 / 组合根只编排」重排。

### 31.1 Block：DB 版本号（启动即坏）

`LATEST_VERSION: 17` 而 `migrate_step` 只处理 `0..=11` 与 `12`，`_ => bail!`。实测
`fresh_database_migrates_to_latest` 直接红：**任何**库启动迁移失败。回滚为 `13`，
并删掉 `assert_eq!(v, 13)`（它与上一行的 `LATEST_VERSION` 自相矛盾，版本链一增长必红）。

§29.1 早就写了「回滚为 13」—— 文档说修了、代码没修，是最坏的一种漂移。

### 31.2 通知收尾上提：`notify_if_changed`

「变了才通知」原来在 `pty` 里写了两遍、组合根又写了一遍。抽成
`live_sessions::events::notify_if_changed(app, version, changed)`：`app` 为 `None`
（退出清理 / 测试）时只做转移不发事件。五个入口（`pty::register` / `poll` /
`exit_and_notify` / `chat::register_and_notify` / `lifecycle::*`）共用它。

### 31.3 `close_*` / `unregister_*` 搬出 `wiring::pty`

它们是「注册表 + 事件」的知识，与 PTY 无关。放在 `pty` 里时 chat 侧只能
`use ...::wiring::pty::unregister_and_notify` —— 一个 chat 命令依赖终端模块。新落点
`live_sessions::lifecycle`：只做转移（关 tab / 注销），一行进程控制都没有。

`pty::exit_and_notify` 留在原地：进程**自己**退出要「落终止态 + 注销 + 认主动关闭的尾巴」，
那是 PTY 退出路径的语义，不是外部要求它停。

### 31.4 删除的编排落到组合根，探测与派发合成一步

- `TerminalRouter::close_session` 改为返回 `bool`（是否由本路由处理）：探测（`take_owner`）
  与派发在**同一个**临界区，`false` 是正常路径而不是「unknown session」告警。于是
  `owns_terminal_session` + `close_session` 的 TOCTOU 窗口消失，也不再需要两次加锁。
- 新模块 `app::session_lifecycle`：`delete_session(registry, router, chat, app, id)` 是唯一
  编排点，命令 `delete_live_session` 只拆参数（红线 6）。依赖注入 → 3 个用例直测
  （未知 id 只摘条目且幂等 / chat 走 Cancel+unregister / 终端走 router 关闭后摘条目）。
- `app/mod.rs` 边界表补一行「删除会话：跨两个生产者的终止编排」，
  `app/commands.rs` 文件头收窄为「进程自身的生命周期」—— 契约与内容对齐。

### 31.5 前端：动作层与绑定层分家

`utils/sessionRowActions.ts`（无 React，可直测）+ `hooks/useSessionRowActions.ts`（只
`useCallback` 包一层）。「删除一条会话」的顺序不变量（先关 tab 再删条目）只有一处实现，
未来的批量删除 / 命令面板不会各自再写一遍。失败上报改走 `reportFrontendError`
（统一错误面），不再只落 `console.warn`。

### 31.6 键盘拖拽：声明与实现一致

`ProjectGroup` 收 `listeners` 却不收 `attributes`，而 `ProjectsPanel` 仍注册
`KeyboardSensor` —— 传感器永远不触发（死配置），同时项目头的 Enter/Space 折叠与
dnd-kit 的激活键是同一组键。结论：**项目列表只支持指针拖拽**，
`KeyboardSensor` 同 diff 移除；`dragHandleProps` 收窄为 `DraggableSyntheticListeners`
（`HTMLAttributes` 能塞 `children` / 任意 `on*`，一个误传就能覆写整行行为）。

### 31.7 菜单项按能力渲染

`hasToolbar = Boolean(onRename || onDelete)` 但两项都渲染 ⇒ 只传 `onDelete` 时「Rename」
仍出现、点下去静默无反应。改为按项渲染（`SessionRowMenu` 的两个 prop 变可选），
并补 3 个用例钉住。

### 31.8 语义修正：会话行是 listitem

行外壳带 `role="listitem"`、容器 `role="list"`。选中底色画在外壳上（工具栏是按钮的兄弟
节点，只给按钮会让高亮在 `⋯` 前断掉），而屏幕阅读器把「标题 + 操作」读成一个列表项。
顺带消掉 `data-testid="session-row"`（多行列表里 `getByTestId` 必然抛）。

---

## 32. 第五轮修订（2026-11-05）：侧栏列表持久化 + 重命名输入框统一

> 只持久化列表，不恢复 agent；点击才恢复。`src-tauri/src/common/db/migrations.rs` 的未提交
> 改动不属本任务，不碰（它的 4 个迁移用例红是既有状态，不归本轮修复）。

### 32.1 后端（TDD，先红后绿）
- [ ] 32.1.1 先红：`live_sessions/cursor.rs`
  - `from_entry`：chat / terminal（含纯 shell）**都**投影；`!has_user_input` ⇒ `None`（不落盘）；
  - `into_entry`：持久化行 → `SessionEntry`，状态固定 `Stopped`；标题 / kind / 地址 / native id /
    时间戳 round-trip 一致。
- [ ] 32.1.2 先红：`agent/chat/session_store.rs`
  - 新列：`kind` / `project_id` / `worktree_path` / `title` / `title_source` / `has_user_input` /
    `native_session_id`；`created_at` → `started_at`，`last_activity` → `updated_at`；
  - 幂等扩列（`PRAGMA table_info` + `ALTER TABLE`，不加 `user_version` 门禁）；
  - `SessionStore` 新面：`list_restorable()` / `delete_cursor()`；`save_cursor` upsert 仍保留
    `model` / `runtime_mode`（既有不变量）；
  - 旧 schema 用例：先建旧表 + 插一行 → 新 store 打开后列存在、旧行不崩、不被 `list_restorable` 返回。
- [ ] 32.1.3 `Registry`
  - 写穿：`report` / `report_first` / `report_user_input` / `report_authoritative` / `set_title` /
    `record_native_session_id`（仅 `has_user_input`）；`adopt` 删旧行 + 写新行；
  - `restore_from_store()`：一次插表 + 单次 bump，**不** emit（前端挂载即 hydrate）；
  - `begin_shutdown()`（AtomicBool）+ `unregister` 抑制删除；
  - `app::boot::on_setup` 调恢复；`shutdown_background_and_exit` 第一行置标志。
- [ ] 32.1.4 用例：列出的会话落盘 / 未列出不落盘 / 改名 / native id / `unregister` 删除 /
      shutdown 不删 / 恢复为 `Stopped` / `adopt` 迁移行 / 重复恢复不产生重复条目。
- 验证：`cargo test --lib live_sessions::` + `cargo test --lib agent::chat::session_store`
  （`common::db::migrations` 的既有红不属本轮）。

### 32.2 前端（TDD）
- [ ] 32.2.1 先红：`SessionList` 改名用例改 `userEvent.type` 连打多字（当前实现只剩最后一字）；
      新增 `InlineRenameInput` 用例：挂载即 focus + select。
- [ ] 32.2.2 `InlineRenameInput` → `ui/Input size="sm"`，组件内 focus + select；删 `inputRef` prop。
  - 侧栏行 / worktree 行 / TagGroupRail 三处共用；继承 IME 空格守卫 + `noAutocorrectProps`。
- [ ] 32.2.3 `SessionList` 删 effect / ref；`useWorktreeRowState` 删 focus effect 与 `renameInputRef`；
      `WorktreeRowList` / `ConnectionWorktreeList` 同步；TagGroupRail 改名改走 `InlineRenameInput`，
      新建输入改走 `ui/Input`。
- [ ] 32.2.4 视觉回归：行高 / 字号 / focus ring 与 `prototype.html` 对齐；测试不再断言裸 input 类名。

### 32.3 文档
- [ ] 32.3.1 更新 `.trellis/spec/backend/persistence-and-cache.md` §4b：
      标题 / 可见性落盘、反向投影存在且固定为 `Stopped`、terminal 行也落盘、退出抑制。
- [ ] 32.3.2 `agent-chat-transports.md`：若「会话结束 / 删除」描述受影响则同步。

### 32.4 验证与回滚
- 验证：`cargo test --lib live_sessions::` + 相关 `agent::chat` 用例 + 相关 vitest；
  收尾跑一次 `pnpm check:quick`。
- 回滚：后端「启动恢复调用」与「退出抑制」两行独立可摘（摘掉即回到内存态）；
  前端输入框统一可单独回滚（组件 API 变更同 diff 完成）。
