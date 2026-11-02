# 会话标题、状态与侧栏会话列表（Live Sessions）

## Goal

会话的**标题**与**生命周期状态**从视图（`tab.title` / `tab.data.status`）上移到后端
**live-sessions 注册表**：事件层是唯一的状态写者，标题按来源优先级单调升级；tab 标题、
侧栏单元图标、侧栏单元会话列表三处都只是同一快照的纯投影。

## Background（现场事实，均为代码证据）

- Agent Chat tab 标题是常量 `'Agent Chat'`（`ProjectView.tsx:104` / `usePaneActions.ts:87`）；
  CLI tab 标题 = `agent.name`（`useTerminalTabs.ts:73`）—— 都不是会话标题。
- `TerminalTabData.status: 'Idle'|'Running'|'Failed'` 存在但**全仓没有读者**（`shared/types/tab.ts:22`），
  唯一写入点是**已挂载**的 `TerminalViewBase`（`:281`，只在自动启动 agent 命令时写一次 `Running`）。
  ⇒ 图标"固定"不是因为没做映射，而是因为状态本身没人写、没人读。
- 后端已有状态机**形状**：`SessionStatus { Ready, Running, AwaitingApproval, Closed }` +
  `ResumeCursor { session_id, agent_id, cwd, turn_count, last_activity }` + `list_active()`
  （`agent/chat/session_store.rs:14,25`），但 `AgentChatManager::update_status()` **零调用者**、
  `list_active()` **无命令暴露**（`agent/chat/manager.rs:181,184`）。
- 侧栏 `local` / `worktree` 是**每个单元一行**（`ProjectGitSection.tsx:50` / `WorktreeRowList.tsx:70`），
  图标静态 `TerminalIcon` / `FolderGitIcon`，没有子项。
- 事件侧：`AGENT_CHAT_EVENT` 只有**每-tab**监听者（`useAgentChat.ts:213`）；tab 卸载后事件无人消费
  ⇒ 没有全局状态源。
- 标题素材其实**已经在请求里**：`StreamRequest.topic`（恢复会话时前端传入的 agent 原生标题）+
  `StreamRequest.prompt`（首轮 prompt 兜底），且 `spawn_session_pipeline` 同时握着
  `req.topic` / `req.prompt` / `req.workspace` / `app_handle`，并已在该处为通知做逐事件投影
  （`agent/chat/commands.rs:359-430`）。
- `SessionHandle` 已带 `workspace`（地址），按单元分组的数据已具备；上一任务落地的
  `UnitScope`（`common/git/unit_scope.rs`）提供「路径归属哪个单元」的唯一判据。
- terminal tab **不保存** PTY session id（`TerminalTabData` 无 `sessionId`），侧栏与 tab 之间缺映射键。

## Requirements

### R1 后端注册表是唯一事实（P0）
- R1.1 新域 `live_sessions`：`Registry` 持有 `session_id → SessionEntry`
  （`kind` / `agent_id` / `workspace` / `state` / `title` + `title_source` / `started_at` /
  `updated_at` / `turn_count`）。
- R1.2 **状态只能经信号改变**：`apply(session_id, Signal) -> bool`，转移规则集中在纯函数
  `state::reduce`（表驱动、穷举、100% 直测）。视图层无写权限。
- R1.3 已终止（`Failed` / `Stopped`）的会话**不被迟到信号复活**（事故形态：点停止后仍显示运行中）。
- R1.4 未知会话的迟到信号丢弃并 `log::debug!`，绝不为它凭空建条目。

### R2 chat 是第一个生产者（P0）
- R2.1 接线点是既有唯一汇聚处 `spawn_session_pipeline`（`agent/chat/commands.rs`）：
  注册 + 逐事件投影 + 结束时注销，**不新增事件通道**。
- R2.2 映射：`SessionStart`/`ContextInit` → `Created`；`TurnStart` → `TurnStarted`；
  `RequestApproval` → `ApprovalRequested`；`UserInput` → `ApprovalResolved`；
  `TurnEnd` → `TurnFinished`；`Error` → `Failed`；`SessionDone` → `Exited`。其余 ≤ `None`。
- R2.3 状态抖动（审批往返）不得刷爆 IPC：只在状态**真的变了**时 bump 版本号。

### R3 PTY 是第二个生产者（P1）
- R3.1 `create_terminal_session` 增 `agent_id: Option<String>`（前端创建时就知道是哪个 agent；
  **禁止**从命令行字符串反推 —— 同 `inprocess` 字段的教训）并在 PTY 创建成功后注册。
- R3.2 child 退出：代码 0 / 无 → `Exited`，非 0 → `Failed`，随后注销。
- R3.3 `TerminalTabData` 增 `ptySessionId?: string`（侧栏 ↔ tab 的唯一映射键），
  并**删除**无人读的 `status` 字段（视图不再持有状态副本）。

### R4 标题派生（P0/P1 两段）
- R4.1 纯函数 `title::{admit, should_upgrade}`：来源质量 `Placeholder < Prompt < Native < User`，
  **单调升级**（同级可覆盖，弱级永不覆盖强级），按**字符**截断（中文不切半个字）。
  `admit` 是**唯一准入判据**（`design.md` §11.4）；旧 `is_title_material` 是它 `Prompt` 分支的
  特例，已泛化，不另立函数。
- R4.2 chat 注册时：`topic`（Native）> `prompt`（Prompt）> agent 名（Placeholder），无新捕获路径。
- R4.3 CLI terminal：OSC 0/2 标题（`term.onTitleChange`）或 conversation 扫描反查 → `Native`；
  都没有则为 Placeholder（agent 名）。
- R4.4 标题**不写回** tab store；渲染期由 `resolveTabTitle(tab, session)` 派生（避免第二份真相）。

### R5 快照接口（P1）
- R5.1 命令 `list_live_sessions(workspace: Option<WorkspaceSession>)`：传地址 ⇒ 只返回该单元
  （`UnitScope` 唯一判据，禁止自拼前缀）；不传 ⇒ 全部。
- R5.2 长轮询 `wait_live_sessions(since, timeout_ms)`：版本未变则挂起（复用 `terminal_drain_wait`
  的 credit-pull 模式），版本变化立即返回 —— 不推送全量快照（macOS WebKit 上推送=每次 eval 克隆）。
- R5.3 事件名 `SESSIONS_EVENT` 双端各一条常量（红线 5），前端经 `shared/events.ts` 引用。

### R6 三个投影（P1/P2）
- R6.1 tab 标题：`resolveTabTitle` 取注册表标题，兜底 `tab.title`（创建期/用户改名）。
- R6.2 侧栏单元图标：`dominantState(sessions)`（`AwaitingApproval > Running > Failed > Ready > Stopped`），
  状态→视觉只有一张表（`SessionStatusIcon`）。
- R6.3 侧栏单元子列表：单元行下方列出该单元的会话（**agent 图标** + 标题 + 状态 + 相对时间；
  agent 图标取该会话的 `agent_id`，纯 shell / 未知 agent 回落 `cli.svg`），
  点击激活对应 tab（chat 用 `data.sessionId`，terminal 用 `data.ptySessionId`）。
- R6.4 无会话的单元不渲染状态点（不是"灰点"）。

## Constraints

- 红线 3（阻塞 I/O 隔离）/ 5（事件名常量化）/ 6（命令层极薄）/ 10（无 `kind ==` 分支）/ 12（地址唯一）。
- 复用而非新建：`SessionStore` + `ResumeCursor`（写穿落盘）、`AGENT_CHAT_EVENT`（chat 信号源）、
  `UnitScope`（分组）、`terminal_drain_wait` 的 credit-pull、`SessionRow` / `SessionChips`（侧栏视觉）。
- **不推断**：不实现「静默 N 秒 ⇒ Idle」（agent 思考时同样静默，猜就是假数据）；terminal 存续期间
  如实显示 `Running`。
- 单文件 ≤300 行；纯函数层（`state.rs` / `title/`）100% 直测。

## Acceptance Criteria

- [x] AC1 单测：`reduce` 覆盖全部 `(state, signal)` 组合，含「终止后不复活」「审批往返回到 Ready」。
- [x] AC2 单测：`title::admit` 取强来源、忽略空白、`User` 不被自动来源覆盖、按字符截断。
- [x] AC3 单测：`Registry` 重复 id 只 warn 不崩、迟到信号被丢弃、`apply` 在状态未变时返回 `false`（不 bump）。
- [x] AC4 chat 接线：`TurnStart → Running`、`RequestApproval → AwaitingApproval`、`Error` 锁死、
      会话结束后 `unregister`（单测用假 session，不起真进程）。
- [x] AC5 PTY 接线：注册含 `workspace` 与 `agent_id`；退出码 0/非 0 分别 `Stopped`/`Failed`（单测 + 真机各一次）。
- [x] AC6 IPC：`list_live_sessions(workspace)` 只返回该单元会话（单测，两个单元交叉验证）；
      `wait_live_sessions` 版本未变时在超时后返回且不空转（单测）。
- [x] AC7 前端：`sessionsByUnit` / `dominantState` / `resolveTabTitle` 纯函数单测；
      `SessionStatusIcon` 对每个状态有确定视觉（穷举测试）。
- [ ] AC8 真机：在 worktree 单元里开 Agent Chat（首条 prompt 作为标题）与一个 CLI tab，
      侧栏该单元下出现两条会话，图标随状态变化（运行/审批/结束），tab 标题不再是常量。
      视觉对齐 [`prototype.html`](./prototype.html)（同目录，状态→视觉唯一表 / 单元角标 / 派生标题）。
- [x] AC9 `cargo test --lib` / clippy / fmt / `pnpm check:quick` 绿。

## Out of scope

- 多窗口会话聚合（当前单窗口）。
- 外部（非 Neeko 终端）CLI 会话的实时观测 —— hooks 域目前只有通知，没有活跃注册表。
- 会话列表的跨单元拖拽 / 批量操作。
- 为标题新增第二张表（`conversation` 已是标题权威）。

## Open questions（已定默认，实施时不再重开）

1. **运行时枚举 vs 持久化枚举**：不复用 `SessionStatus`，新建 `SessionState`（多 `Failed`/`Stopped`），
   单向投影到 `ResumeCursor.status` —— 否则加一个 UI 状态就要改数据库 schema 语义。
2. **域位置**：`src-tauri/src/live_sessions/`（不塞进 `agent::chat`：它只是两个生产者之一；
   不并入 `src/session/`：那是项目配置持久化）。
3. **CLI 标题失败策略**：拿不到就停在 Placeholder（agent 名），不猜。

---

## 需求修订（2026-10-31，真机实测反馈）

四条实测反馈改写了 R4 / R6 的两处细节（原方案在纸面上自洽，落地后不可用）：

1. **没有真标题就不显示名字**（R4 修订，经两轮反馈收敛）。
   实测：终端会话的占位标题取的是 `agent_id`，侧栏与 tab 显示 `pi` —— 与上下文无关，且与图标重复。
   中途试过「占位 = 单元展示名（项目名 / worktree 目录名）」，被否：**会话行已经挂在单元行下面，
   再写项目名是冗余**。最终规则：后端占位标题留空串，视图分派 —— 侧栏只画图标，tab 用
   `Terminal N`（`nextTerminalTitle`）。agent 名同样不得进 tab 标题（同一类问题一并清掉）。
2. **终端必须有状态流转**（R2 修订）。原方案规定「进程活着 = Running，不推断 Idle」，
   实测结果是终端永远停在 Running，跑完也不动。改为输出活动判据：有输出 ⇒ Running，
   静默 ≥ 1.5s ⇒ Ready（`wiring::pty::OutputActivity`，取舍写在 `agent-chat-transports.md`）。
3. **chat 不能只认 `TurnStart`**（R2 补充）。`pi` 传输从不发 `TurnStart`，只认它会让 pi 会话
   整轮停在 Ready。回合内容事件同样映射为 `TurnStarted`。
4. **侧栏会话子列表不画左侧竖线**（R6.3 视觉修订）。层级只靠缩进；窄侧栏里那条线是持续噪声。

验收补充：会话跑完一轮后，tab 前导点与侧栏行状态点都必须从 running 变到 ready；
CLI 终端静默 1.5s 后同样落到 ready。

### 第三轮修订（出现时机）

会话进侧栏的时机不是「PTY / 静默会话创建成功」，而是**它有了名字**：`titleSource` 升到
`prompt` / `native` / `user` 且标题非空。打开 agent tab 但还没输入时，侧栏不该出现条目；
tab 标题在这段时间用 agent 名（初版行为），会话有标题后同步换成会话标题。

### 第四轮修订（标题准入判据，2026-11-01）

**R4 修订：Native 来源恢复；判据从「提取」改为「拒绝」。**

`liveSessionsApi.ts` 记着一次事故：OSC 标题把 `π`（pi 的状态栏字形）当成会话名，因为是
`Native` 级别而覆盖了用户首条输入，于是**整条 OSC 来源被删除**。这个诊断是错的 ——
出问题的不是来源，是**没有准入判据**：`is_title_material` 是为 `Prompt` 写的（拒绝斜杠命令
与纯符号），而状态栏形态恰好**含字母**（`π` 是希腊字母、`✳ Claude ready` 含单词），
`char::is_alphanumeric` 全部放行。

新增 R4.5（P0）：**噪声永远不进入注册表 —— 判据在写入之前，不在写入之后。**

- 唯一准入判据 `title::admit(source, raw, agent_id) -> Option<String>`（`design.md` §11）；
- 单调升级会把任何**已进入**注册表的噪声粘住（弱级永不覆盖强级），因此准入是唯一正确的拦截点；
- 判负时注册表**什么都不做**（不写空串），已有标题保持 —— 于是 `✳ Fix login bug` 之后
  再来的 `✳ Claude ready` 不会把标题改回状态栏。

R4.3 随之解除「不做 OSC」的限制：Native 恢复为可用来源（provider 自己做的语义浓缩，
质量高于 Prompt），但受 §11.7 的**传输优化**约束 —— 名字只在用户开始用它之后才收集
（那是少发 IPC 的优化，**不是判据**：删掉它行为不变，只是变慢）。

### 第四轮验收补充

- [x] AC10 单测：`title::admit` 对每个 `TitleSource` 穷举 —— 状态栏形态（`π` / `✳ Claude ready` /
      `ready` / `Terminal 2` / cwd 路径 / `claude-code`）判负；真主题（`✳ Fix login bug` /
      `修复登录竞态`）通过。
- [x] AC11 单测：判负**不改写**已有标题 —— `Prompt` 命名后收到噪声 `Native`，`title` 与
      `title_source` 都保持原值（证明准入发生在 `should_upgrade` 之前）。
