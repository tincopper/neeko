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

### 第五轮修订（持久化侧栏会话列表，2026-11-05）

**问题**（真机实测）：应用退出后侧栏会话子列表整片消失。注册表是纯内存事实，写穿只覆盖
`status` / `turn_count` / `last_activity`，标题、可见性、kind、单元地址、原生会话 id 都不落盘；
启动时 `Registry::new` 为空表。

**R7（P0）——只持久化「侧栏列表」这一层事实，不恢复运行中的 agent：**

- **R7.1 落盘时机**：会话**进入侧栏**时开始持久化（`has_user_input = true`），之后标题升级 /
  用户改名 / `native_session_id` 回填都要更新；`unregister`（用户删除 / 进程结束）删除记录。
- **R7.2 启动恢复**：把持久化记录回填注册表，状态一律为 `Stopped`（没有进程在跑）；**不**自动建 tab、
  **不**自动启动 agent、**不**自动恢复对话。前端初次 hydrate 就能看到这些行（无需新命令 / 事件）。
- **R7.3 点击才恢复**：沿用 `useActivateSession` 现有路径 —— terminal 有 `native_session_id` 就
  `--resume`，否则新建同 agent 终端；chat 打开一条新的 chat tab（会话级恢复仍在 Histor 面板，
  chat 侧没有原生 session id，见 `implement.md` §8.2）。

  **已知取舍（不阻塞本轮）**：
  - chat 恢复行点击后不会 `adopt` 旧行（chat tab 没有 `resumeFromSessionId` 通道），旧行会作为
    历史保留，需用户手动删除；
  - 「关 tab」= `Stopped` 且保留条目（既有语义），因此这类行也会跨重启存活、不会自动清理；
    本轮不做保留策略（全量保留，侧栏分页），清理阈值需要产品另行决定。
- **R7.4 退出不得删库**：`shutdown_background_and_exit` 先置「关闭中」标志，`close_all_sessions`
  触发的 `unregister` 只摘内存条目、不删持久化记录（否则退出 = 清空列表）。崩溃 / 强杀天然满足。
- **R7.5 恢复记录必须能定位单元**：落盘 `project_id` + `worktree_path`（不存拼好的 key：后端没有
  `from_key` 解析器），前端仍按 `workspaceKey` 等值分组。
- **R7.6 兼容存量**：`agent_sessions.db` 是私有迁移链（无 `user_version`），扩列必须幂等；
  旧行缺字段时给默认值，`project_id` 为空 / 无标题的旧行不恢复（无法定位单元 / 不可见）。

**R8（P0）——「当前会话」是全局唯一事实（第 34 轮回归）：**

- **R8.1 高亮只属于当前单元**：会话行的选中态（`row-current`）只能出现在**当前激活项目 + 当前激活单元**下。切换项目 / 切换 worktree 后，旧单元的会话行必须立即熄灭 —— 不能出现多个项目下各亮一行「当前」。
- **R8.2 父子两层同源**：父行让出选中底（`childActive`）与子行高亮必须由同一份「当前前台会话」派生，禁止「父行让出、子行不亮」或「父行不让、子行却亮」。
- **R8.3 局部状态 ≠ 全局事实**：每个 tab 空间保存自己的前台 tab（`editorLayout[tabKey].activeTabId`）是**恢复语义**（切回来要接上），不得直接当作全局「当前」。区分两者的派生点只有一个：`workspaceStore` 的 `useActiveWorkspaceKey(activeProjectId)` / `activeWorkspaceKeyOf()`。
- **R8.4 dock 一致性**：停靠到 dock 宿主的会话仍是「正在展示的会话」，切换项目时一并熄灭，不高亮、不让出父行选中底。

**不在本轮范围**：多面板同时展示两个不同 Workspace（当前热集合恒为 1 元素）；跨项目的「最近访问」视觉提示（产品未定义）。

### 第五轮验收补充

- [x] AC12 单测：注册表在 `has_user_input` 置位 / 标题变化 / native id 回填时写穿；未列出的会话不落盘；
      `unregister` 删除行；`begin_shutdown` 后 `unregister` 不删行。
- [x] AC13 单测：`cursor::from_entry` 对 chat / terminal（含纯 shell）都投影出记录；反向 `into_entry`
      固定把状态还原为 `Stopped`，标题 / kind / 地址 / native id / 时间戳往返一致。
- [x] AC14 单测：`SqliteSessionStore` 在旧 schema 上幂等扩列；`list_restorable` 只返回可定位且有名字的行。
- [ ] AC15 真机：列出若干 chat / terminal 会话 → 退出 → 重启，侧栏行仍在、标题不变、
      单元归属正确、行状态为 stopped；点 terminal 行能 `--resume`（有 native id 时）；
      删除一条后重启不再出现。

### 第六轮验收补充（R8 回归）

- [x] AC16 单测：`selectActiveSessionRefs` 只返回**指定单元**的前台会话 refs（含 dock 宿主前台）；
      传入另一个单元的 key 时返回那个单元的，传 `null` 返回空。
- [x] AC17 单测：切换 `activeProjectId` 后，旧单元的 `useUnitsWithActiveSession` 不再命中，
      `UnitSessionList` 不再把 `activeSession` 传给旧单元的 `SessionList`。
- [ ] AC18 真机：两个项目各点一个会话行 → 切到另一个项目，旧项目下的 `row-current` 消失，
      侧栏只剩当前项目的「当前」提示。

### 第七轮验收补充（R9 标题源隔离，2026-11-06）

- **R9.1 输入流不是标题源**：终端 xterm `onData` 与 OSC `onTitleChange` 不得写入 live-sessions
  标题；原始按键只上报活动态 / 清权威门，OSC 只作展示态（本轮直接丢弃）。
- **R9.2 生产者白名单**：标题只能来自用户改名、CLI hook `topic`、conversation 缓存中的
  provider title、chat 注册时的真实 prompt；`Registry::upgrade_title` 仍是唯一写入点。
- **R9.3 TUI 控件输入隔离**：`/model` 面板过滤词（如 `deep`）不得进入任何标题写入路径；
  已有标题不被后续输入或 OSC 改写。
- **R9.4 兼容性**：关闭终端标题即时命名后，CLI 会话在 hook topic / conversation title 到达前
  保持占位；不新增 LLM 生成、不新增轮询磁盘扫描。
- **R9.5 可见性 ≠ 命名（第 36 轮回归修复）**：删掉「首条输入即命名」后，侧栏必须仍然列出
  已输入的终端会话（无 hook 的 CLI 永远等不到标题）；无名行画成占位行。持久化读门与 SQL
  粗筛同步去掉 `title != ''`。
- [x] AC19 单测/集成：`/model\r` + `deep\r` + OSC `deep` 不触发任何标题 IPC；
      hook `topic` 与 conversation 缓存标题可写入 `Native`；`User` 改名不被自动源覆盖。
      单测覆盖见 `sessionTitleReporter.test.ts`（零标题 IPC）、`commands.rs::isolated_title_sources`
      （改名恒 User / 活动不命名）、`hooks.rs`（回落 / topic 优先 / User 保护），
      以及 `conversation/manager.rs::cached_title_for_native`。
- [ ] AC20 真机：在 CLI `/model` 里过滤 `deep` 后，侧栏 / tab 标题不变成 `deep`；
      首轮真实 prompt 或 hook 标题到达后显示该标题。（需真人 + 真机，Phase 2.2 收尾）
- [x] AC21 单测：`isListedSession` 只要求 `hasUserInput`；`resolveTabTitle` 要求
      `isListedSession && isNamedSession`；`ResumeCursor::is_restorable` 不再拒绝无名行，
      只拒绝无单元与 `Placeholder` 却带标题；`restore_from_store` 回填无名行。

### 第八轮验收补充（R10 子 agent 会话不得污染父会话，2026-11-06 真机反馈）

现象：agent 执行子 agent 期间，侧栏把会话显示成「已完成」，实际还在跑。

- **R10.1 子会话不上报**：hook 模板必须按 `sessionManager.getHeader().parentSession` 判定
  会话来源，in-process 子 agent 会话的事件（完成 / 审批 / 输入请求 / 会话身份）**整条不上报**。
  判据落在模板而不是后端：后端只看到两个 id，无法区分「子会话借父会话的 env」与「同一会话
  的正常上报」。
- **R10.2 完成腿只认稳定终点**：pi 用 `agent_settled`（旧版回落 `agent_end`），OMP 用
  `agent_end.willContinue === true` 作非终态判据。`agent_end` 在重试 / 压缩 / 队列续跑时会
  先发一次，只认它就会在子 agent 还在跑时把父会话判成已完成。
- **R10.3 门只有一个注册点**：`pi.on` 在每个模板只允许出现一次（`onStatus` 包装器内部）。
  逐个 handler 加门时，漏一处 = 静默污染父会话（无报错、无日志）。
- **R10.4 不污染父行身份**：子会话不得写入父行的 `native_session_id`（first-writer-wins，
  指到子会话 transcript 会让「点击恢复」恢复错会话）与标题（子 agent 的 prompt）。
- [x] AC22 单测：`templates_gate_child_sessions_at_a_single_registration_point` —— 两个模板
      都有 `isChildSession` / `getHeader` / `parentSession` / `onStatus`，`pi.on(` 出现次数 == 1，
      `session_start` / `agent_end` / `tool_call`（pi 另有 `ui_prompt_start`）都经 `onStatus` 注册，
      完成腿让位判据与 OMP 的 `willContinue` 判据都在。
      变异验证 6/6 会红（含两处「初版 0 红 → 改连续形态判据」的记录，见 `implement.md` §39.3）。
- [x] AC23 行为验证（真实模板正文 + 桩 `pi` / 桩 `fetch`）：子会话四类事件 0 条上报；
      父会话 `agent_settled` 恰好 1 条且 id 为父会话自己的；`agent_settled` 后的 `agent_end`
      0 条；旧版 pi 的 `agent_end` 回落仍报 1 条；OMP `willContinue === true` 0 条。
- [ ] AC24 真机：让 agent 执行一个耗时子 agent（**前台与后台两种形态都要**），侧栏状态必须
      保持「运行中」直到子 agent 真正结束；结束后 `native_session_id` 与标题不得被子会话的
      prompt 覆盖。（需真人 + 真机）

### 第九轮验收补充（R11 后台子 agent 不得让父会话误报完成，2026-11-06 真机二次反馈）

上一轮（R10）修的是「子会话冒充父会话」。同一个症状还有第二个独立成因：主 agent 用
`run_in_background: true` 派孩子时只负责交任务，打印完 agent id 就结束回合 ⇒ pi **正常**发
`agent_settled` ⇒ 模板照常报完成 ⇒ 后端置位权威门 ⇒ 子 agent 的 spinner 帧再也推不动状态。

- **R11.1 花名册**：模板必须订阅 `pi.events` 的 `subagents:started` / `subagents:completed` /
  `subagents:failed`（实测自 `@tintinweb/pi-subagents@0.23.1`，载荷含 `id`），按 id 维护
  「在跑的孩子」集合。
- **R11.2 拖住完成**：`agent_settled` 时有孩子在跑 ⇒ 不上报 `turn_completed`，改为暂存，
  孩子全部结束后补发。反过来必须补发：否则会话永久停在 `Running`。
- **R11.3 空闲期孩子**：会话已判完成之后才起来的子 agent（定时任务 / ctrl+b 转后台）必须补发
  `turn_started`，否则后端权威门让会话永久停在 `Ready`（字节推断再也推不动）。
- **R11.4 新回合作废旧完成**：`agent_start` 必须作废暂存的完成，否则孩子清空时会把**正在跑**
  的新回合判成完成（症状与本次 bug 同形）。
- **R11.5 `turn_started` 只驱动状态**：不得进 `agent::chat::notify::event_keys`（那张表与
  `NotificationClass` 一一对应，设置页按它生成清单，加进去就是永远不弹的死开关）。
- [x] AC25 单测：`templates_hold_completion_while_background_children_run`（三条通道订阅 /
      拖住判据 / 花名册删除 / `turn_started` 补发，锚点引用 Rust 侧常量本身）；
      `turn_started_is_a_state_signal_not_a_notification`。
- [x] AC26 单测：`turn_started_reopens_a_settled_session_against_output_activity` ——
      完成后再开工必须回到 `Running`，且门保持置位（这期间 spinner 字节不得推回 `Ready`）。
- [x] AC27 行为验证（真实模板正文 + 桩 `pi.events` / 桩 `fetch`）：前台子 agent 恰好 1 条；
      **后台子 agent 在父会话 settle 后 0 条**、孩子结束后 1 条；空闲期孩子先
      `turn_started` 再完成；孩子未清空时用户发新消息则孩子结束不报、新回合自己报；
      同一 id 重复 `started` 不重复计数；旧版 pi 的 `agent_end` 回落仍报 1 条。
- [x] AC28 变异验证：删拖住分支 / 花名册只加不减 / 删 `turn_started` 补发 → 三条全部会红；
      「`agent_start` 作废」由行为场景覆盖（`contains` 表达不了时机），已如实标注。

---

## 归档状态（2026-11-06）

代码、单测、spec 全部完成并已提交（`10580b80` / `846d7a44` / `5e903233`）。
**5 条人工验收仍开着**，归档时如实保留未勾选 —— 归档表示「实现与自动化证据齐备」，
不表示「真机全部验收通过」：

| AC | 待人工确认的内容 |
| --- | --- |
| AC8 | worktree 单元里开 Agent Chat（首条 prompt 作标题）与 CLI tab |
| AC15 | 列出若干 chat / terminal 会话 → 退出 → 重启，侧栏行与标题仍在 |
| AC18 | 两个项目各点一个会话行 → 切换项目后 `row-current` 只归属当前项目 |
| AC20 | CLI `/model` 里过滤 `deep` 后，侧栏 / tab 标题不变成 `deep` |
| AC24 | 耗时子 agent（**前台与后台两种形态**），侧栏必须保持运行中直到真正结束 |

AC20 / AC24 是本次两轮修复的直接验收项。若真机复测再暴露问题，**不要新开任务**：
重建一个同名任务或在原 `implement.md` 的口径下继续，两轮的成因分析（§39 / §40）与
变异记录是继续排查的起点。

另一件与本任务无关但受其影响的收尾动作：`agent_sessions.db` 里被污染的
`native_session_id` 不会自愈，必须在**应用关闭时**清理（SQL 见 `implement.md` §39.5）。
