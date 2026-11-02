# Agent Chat 传输层对照

> 本仓 `AgentAdapter` 目前有四条真实可用的传输。本文记录**它们各自的协议事实与陷阱**，
> 以及新增一条传输时必须同时改到的四处落点。
>
> ACP 的模型选择细节见 [`agent-acp-model-selection.md`](./agent-acp-model-selection.md)，
> 本文不重复。

## 0.1 执行地址（workspace）是 chat 会话的一等身份（2026-10-30）

一次 agent 会话的真值依赖是 `(agent 传输, 执行地址, prompt, …)`。执行地址 = `WorkspaceSession`
（`{projectId, worktreePath}`，`null` = 主 checkout），它决定 **agent 进程的 cwd**，而 worktree 单元
与主仓是**两个**执行上下文（git 语义下 1+N）。

| 边界 | 契约 |
| --- | --- |
| `StreamRequest` | `workspace: WorkspaceSession` **必填**（无 `Option`、无回退主仓）；**没有独立 `projectId`** —— 项目身份是地址的分量（`workspace.projectId`），两个并列字段可独立错配 |
| 解析 | 唯一入口 `AppStateWrapper::resolve_workspace_target_with_env` → `repo.root()`；`project_name()` 只给显示名，**不提供 cwd / env**（env 与 cwd 同一次解析产出） |
| 会话身份 | `SessionHandle.workspace` + `owns(sid, agent, workspace)`：同项目两个单元是两条会话（cwd 不同，复用会把 turn 投进错配进程）。不另存 `project_id` |
| 上下文 | `AgentContext.cwd`（执行根，**不是**项目 id）+ `AgentContext.workspace`（必填地址） |
| 事件回显 | `ContextManifest.workspace_key: String` + `cwd`。地址**只以 key 字符串**出现在 wire 上（与 `git.ts` / `file.ts` 同形），分量经 `WorkspaceSession.fromKeyOrId` 唯一 codec 取。项目级调用（`agent_chat_context`）用 `WorkspaceSession::main(id)` 回显主 checkout 的 key —— 地址是**总存在的**，不存在「没有地址」这种状态 |
| 持久化 | `ResumeCursor.cwd` = 解析后的执行根（不是项目 id）—— 原生 resume 要求 cwd == 会话 origin |
| 防复发 | 护栏 `check_workspace_session_addressing`：判据 **E**（命令体按 project 取 cwd/根必须入台账说明理由）、判据 **F**（生产代码禁写 `WorkspaceSession { .. }` 字面量，项目级通道用 `WorkspaceSession::main`）、判据 **G**（地址不得可选：`Option<WorkspaceSession>` 必须入台账说明理由 —— A2/D 的判据是必填形态，看不见 `Option` 这种「没传就退回按 project 取根」的合法路径） |

**为什么不给 `Option` 兼容**：回退主仓会把「必然 cwd 错配的会话」变成正常路径；pi / opencode 的
原生 resume 还要求 cwd == 会话 origin（跨目录直接被拒），错误会被推迟到用户点恢复时才炸。
**为什么不加裸 `project_path: Option<String>`**：那会绕开 worktree 归属校验，并给下一处同类缺陷留门。
**为什么地址在 wire 上只有一个 key 字符串**：分量化的 `{projectId, worktreePath}` 与散参同形，
两段可独立缺失/错配（护栏列为「可拆分」失真）；key 只有一个表示，且与 git / file 事件一致。

## 0.2 会话状态与标题的唯一来源（2026-10-31）

`src-tauri/src/live_sessions/` 是**会话状态与标题的唯一写者**；tab 标题、侧栏单元角标、侧栏
会话子列表三处都只是同一份快照的纯投影。

**为什么必须上移到后端**（三条都是代码事实，不是整洁性偏好）：

| 症状 | 根因 |
| --- | --- |
| 侧栏图标永远一样 | `TerminalTabData.status` 全仓**没有读者**，唯一写入点是已挂载的 `TerminalViewBase` 自动启动 agent 时写一次 `Running` —— 状态本身没人写、没人读 |
| tab 标题说不出会话在干什么 | Agent Chat tab 标题是常量 `'Agent Chat'`，CLI tab 是 `agent.name`，都不是会话标题 |
| 视图一关状态就断 | `AGENT_CHAT_EVENT` 只有**每-tab**监听者，tab 卸载后事件无人消费 ⇒ 没有全局状态源 |

### 状态只能经信号改变

状态写入按来源分成三个明确入口（外加 `register` / `unregister` 两个生命周期动作）：

- `apply(signal)`：chat 事件与终止等直接信号；
- `apply_activity(signal)`：PTY 输出推断；权威门开启时忽略 `TurnStarted` / `TurnFinished`；
- `report_authoritative(title, signal)`：CLI hook 的完成 / 审批 / 失败，一次加锁完成
  标题、可见性、状态与权威门。

转移规则集中在纯函数 `state::reduce` 的穷举表里
（`reduce_covers_every_state_signal_pair`）。两条硬规则由事故形态定义：

1. **终止态（`Failed` / `Stopped`）吸收一切迟到信号** —— pi 实测 `Error` 之后还会来 `TurnEnd`，
   把它们当普通状态处理就会复活「点停止后仍显示运行中」（`terminal_states_absorb_every_late_signal`
   / `terminal_state_absorbs_late_signals`）。
2. **`Ready + ApprovalResolved` 是噪声**，返回 `None` 而不是把空闲会话推进到 `Running`
   （`ready_approval_resolved_is_noise`；审批往返本身回 `Running`：`approval_round_trip_returns_to_running`）。

`apply` 返回「状态是否真的变了」，**只有 `true` 才 bump 版本号**：审批往返这类抖动否则会
高频刷 IPC（`apply_bumps_only_on_real_transitions` / `apply_without_state_change_does_not_bump`）。
未知会话的迟到信号丢弃并 `log::debug!`，**绝不为它凭空建条目** —— 凭空建条目等于侧栏多出
一条没人创建的会话（`apply_on_unknown_session_is_dropped_and_creates_nothing`）。

### 三类状态来源，一条投影

| 生产者 | 接线点 | 原生事实 |
| --- | --- | --- |
| chat | `agent::chat::commands::spawn_session_pipeline`（会话注册 + **16ms 合帧 emit 闭包内**逐事件投影 + bridge 结束后注销） | `StreamEvent` → `Signal`（`wiring::chat::signal_of`） |
| PTY / WSL | `services::spawn_pty_pipeline`（进程句柄入表之后、watcher 线程启动之前）+ 退出 watcher → `wiring::pty::exit_and_notify` | 输出流动 = `TurnStarted`，静默 ≥ `IDLE_AFTER` = `TurnFinished`；退出码 `0`/无 = `Exited`，非 0 = `Failed` |
| SSH | `RemoteTerminalManager::create_session`（表项就绪之后、io 线程启动之前）+ io 循环的 250ms tick → `OutputActivity::poll` + io 线程收尾 → `exit_and_notify` | 同上（远端无可靠退出码，一律 `Exited`） |
| CLI hook | `live_sessions::wiring::hooks::project` | `turn_completed` / `approval_requested` / `input_requested` / `session_failed` → 权威 `Signal`；纯信息事件只更新标题 |

**不新增事件通道**：注册表是既有 chat 事件流与 PTY 生命周期的第二个消费者。
`agent_id` 与 `workspace` 都是**显式入参**（`create_terminal_session` 的 `agent_id`、
`SessionHandle.workspace`），不从命令行字符串反推（同 `ChatLaunch::inprocess` 的教训）。

#### 终端状态：CLI 自报优先，字节静默兜底（2026-11-02 修订）

状态事实按质量分三级，**用强的那一级，弱的不许覆盖它**：

| 级别 | 来源 | 接线 |
| --- | --- | --- |
| 1 | **CLI 在输出流里自报**（`agent::cli_status`，OSC 声明表） | reader / SSH io 线程 `observe(bytes)` → `poll` 应用 |
| 2 | CLI hook（`wiring::hooks`） | `report_authoritative`，见上文权威门 |
| 3 | **字节静默推断**（`IDLE_AFTER` = 1.5s） | `poll` 里的兜底分支 |

第 1 级的实测契约（Codex 0.166.0，`script` 起的真实 TUI，非 `exec`）：

```text
ESC ] 7501 ; state=working:app=codex ESC \     # 一轮开始
ESC ] 7501 ; state=idle:app=codex    ESC \     # 一轮结束
```

为什么必须有第 1 级：**Codex 完成后仍会周期性重绘**（光标 / 状态行），静默永远攒不到 1.5s，
于是「任务已结束」一直显示绿色运行中（2026-11-02 真机反馈）。同一轮排查还确认了 hook 为什么
不可靠：Codex 0.166 的 TUI 只是 `app-server` daemon 的客户端，`notify` 由 **daemon** 拉起，
`NEEKO_SESSION_ID` 不在它的 env 里 ⇒ 归因失败 ⇒ 权威门从未置位。

规则（`wiring::pty::OutputActivity` + `wiring::status_mailbox::StatusMailbox`）：

- reader / SSH io 线程每写一块输出就 `observe(bytes)`：打点 + 扫一遍自报通道；
  扫描器只在**写侧**（一个写者，无竞争），扫描结果经原子信箱发布 ——
  取的一方（`poll`）完全不持锁，`has_reported` 由同一份状态派生，不另存布尔量；
  信箱在 `wiring/` 而不在 `agent::cli_status`：后者是**契约**层（数据表 + 解析器，零线程），
  信箱是运行时编排，且只有终端活动探针消费它；
- watcher（100ms）与 io 循环（250ms）调 `poll()`：先应用「CLI 自报的最后一档」
  （走 `apply` 直接信号，不受权威门约束 —— 门是用来挡推断的）；**一旦出现过自报，
  该会话彻底停用静默推断**，之后的字节重绘不再改状态；
- 没有自报通道的 agent（除 Codex 外目前全部）行为不变：有输出 ⇒ `TurnStarted`（`Running`），
  静默 ≥ `IDLE_AFTER` ⇒ `TurnFinished`（`Ready`）；`poll` 幂等，不 bump 不发事件；
- **权威门**（级别 2 → 3）：CLI hook 报完成 / 审批后，`apply_activity` 的
  `TurnStarted` / `TurnFinished` 一律忽略，直到用户真正提交输入。
- 自报是**机会性升级**：CLI 版本不再发那个 OSC 时不会锁死状态（推断仍在跑），
  数据表（`CHANNELS`）也只认声明过的 agent，别的 CLI 输出里偶然出现的同样字节不算状态。

**必须诚实标注的代价**：模型长时间无输出的思考会被读成「就绪」，`sleep 30` 这类无输出命令同理。
阈值取「大于命令之间的间隔、小于人愿意等的反馈延迟」，这是「完全没有信号」与「宁可粗略也要有
反馈」之间的取舍，不是精确状态机。终端 `AwaitingApproval` 只在 CLI hook 已安装且生效时可达；
没有 hook 的纯 shell 仍只能观察字节活动。

#### chat 侧的同一条坑：`TurnStart` 不是每个传输都发

`pi` 传输**从不产出** `StreamEvent::TurnStart`（`pi_rpc/session.rs` 的翻译表里没有那个臂）。
只认 `TurnStart` 的话，pi 会话整轮对话都停在 `Ready` —— 与终端同一个症状：状态点永远不动。
因此 `wiring::chat::signal_of` 把**回合内容**（`TextDelta` / `ReasoningDelta` / `ToolStart` /
`ToolOutput` / `ToolEnd` / `CommandRun` / `TodoUpdated` / `FileDiff`）也映射到 `TurnStarted`：
首个内容事件 ⇒ `Running`，`TurnEnd` ⇒ `Ready`。`Running + TurnStarted` 幂等，ACP 同时发
`TurnStart` 不会多翻一次（`content_events_drive_running_without_turn_start`）。

#### 顺序不变量：登记早于信号

登记必须在**退出信号的生产者启动之前**完成。反过来（先 exit 后 register）的形态是：

1. 进程秒退（`sh -c "exit 1"`、agent 命令不存在）→ watcher / io 线程发出退出信号；
2. `Registry::apply` 对**未知会话**丢弃该信号（它绝不为未知会话建条目，见
   `on_exit_for_unknown_session_is_a_no_op`）；
3. 随后才登记出来的条目永远停在 `Running` —— 没有第二个信号能清理它，用户看到一条点不动的
   幽灵行。

因此登记点落在**进程创建处**（`spawn_pty_pipeline` 在 `spawn_watcher_thread` 之前、
`RemoteTerminalManager::create_session` 在起 io 线程之前），而不是 `create_session` 返回之后。
chat 侧同一条规则：先 `register` 再起事件泵。

#### 通知只此一份

「改状态 + 只有真变了才 `emit_changed`」的收尾收在 `live_sessions::notify_if_changed`
（`events.rs`）：`app` 为 `None`（退出清理 / 测试）时只做转移不发事件。

调用它的入口只有五处，各自负责一类**转移**：

| 入口 | 归属 | 转移 |
| --- | --- | --- |
| `pty::LiveTerminal::register` | 生产者 | 登记 |
| `pty::OutputActivity::poll` | 生产者 | 活动推断 |
| `pty::exit_and_notify` | 生产者 | 进程自己退出（落终止态 + 注销） |
| `lifecycle::close_and_notify` | 注册表域 | 关 tab（只标 `Stopped`，**保留**条目） |
| `lifecycle::unregister_and_notify` / `delete_and_notify` | 注册表域 | 注销 / 删除 |
| `chat::register_and_notify` | 生产者 | chat 登记 / 续聊 |

**为什么 `close_*` / `unregister_*` 不在 `wiring::pty`**：它们是「注册表 + 事件」的知识，
与 PTY 无关。放在 `pty` 里时，chat 侧与组合根要复用只能
`use ...::wiring::pty::unregister_and_notify` —— 一个 chat 命令依赖终端模块，第一条例外出现时
「通知只此一份」就只剩注释。现在它们住在 `live_sessions::lifecycle`，生产者只负责
「把原生事实变成信号」和「怎么结束自己的进程」。

分散到各调用点的话，第 N 个生产者忘写通知的表现是「侧栏不刷新、无报错、无日志」——
属于最难定位的一类。

#### 关 tab ≠ 会话消失（`close_and_notify`）

「关掉 tab」与「会话结束」是两件事，注册表必须分开表达：

| 触发 | 动作 | 侧栏 |
| --- | --- | --- |
| 用户关 tab（`TerminalRouter::close_session`） | `lifecycle::close_and_notify`：只 `apply(Stopped)`，**不注销** | 那一行留着，状态点变 stopped，点击可恢复 |
| 进程自己退出（`pty::exit_and_notify`） | `apply(exit_signal)` + `unregister` | 行消失 |
| 销毁单元 / 清 tab 空间（`lifecycle::unregister_and_notify`） | 注销 | 行消失 |
| 用户删除侧栏行（`app::session_lifecycle::delete_live_session`） | 结束进程（按归属分派）→ `lifecycle::delete_and_notify` | 行消失 |

`on_exit` 因此多一条前置判据：**条目已经是 `Stopped` 就说明这次退出是主动关闭的尾巴**，
只确认状态、不注销。少了这条，关 tab 仍会少一行（`close_session` 先标状态，PTY 随后退出
又把它摘掉）—— 正是用户看到的「关了 tab 会话就没了」。

**删除**（侧栏行尾菜单）是另一件事：结束进程 → 摘掉条目 → **连 tab 一起关掉**。
它跨终端与 chat 两个生产者，所以编排在组合根（`app::session_lifecycle::delete_session`）：

- **归属探测而不是 `kind` 分支**：`TerminalRouter::close_session` 返回「是否由我处理」
  （探测与派发在同一个临界区，`false` 是正常路径而不是告警），未命中再问
  `AgentChatManager`。「怎么停」永远只有生产者那一份实现。
- **先停进程，再摘条目**：反过来会让注册表已摘而进程还在跑，之后再没有入口能定位到它。

**视图侧的顺序在前端定**（`features/live-sessions/utils/sessionRowActions.ts`）：
先 `closeEditorTab`（走既有的关闭入口，进程正常结束），再 `deleteLiveSession`
（此时只剩一次 `unregister`）。反过来先删条目，tab 的关闭路径会再去关一个已不存在的进程。
后端命令的文档把这条**前置条件**写明了 —— 前端是唯一满足它的地方，也是唯一的调用方。

恢复成功后由新会话**继承**那一行：`adopt_live_session(from, into)` 把旧条目的标题 /
`has_user_input` / 原生 id 搬进新条目，旧条目退场。两半都不可省：

- **不继承** ⇒ 新条目是空的 `Placeholder` + `has_user_input = false`，`isListedSession`
  不列它 ⇒ 用户看到「点了恢复，那一行反而消失了」（要等敲第一条输入才回来）；
- **不退场** ⇒ 侧栏同时挂着「已停止」与「新会话」两行。

`adopt` 只接受**终止态**的 `from`：把还活着的会话合并掉，等于让用户点一次就丢一条正在跑的
会话。前端由 tab 上的 `resumeFromSessionId` 携带来源，`TerminalView` 在 PTY 创建成功后
消费一次（幂等：`from` 已消失时是 no-op，所以不需要清理这个字段）。

代价（诚实标注）：关 tab 的条目留到本次运行结束（注册表是内存态）。它是**恢复点**，不是
垃圾；单元被删除时它也不会被回收，只是不再被渲染（没有单元行就没有子列表）。

#### 三种关闭选择：后台运行 / 退出进程 / 取消

会话**正在干活**时关 tab 不是「关 tab」，而是三条不同后果（`ready` 不算 —— 见下）：

| 选择 | 后端 | 前端 | 侧栏 |
| --- | --- | --- | --- |
| 后台运行 | `detach_terminal_session(id, true)`：drain 转分离态 | 拆缓存但**不 closeSession** | 行留着，状态继续变（Running / AwaitingApproval …） |
| 退出进程 | `close_terminal_session` → `close_and_notify`（标 `Stopped`） | 拆缓存 + 关会话 | 行留着（可点回来续写） |
| 取消 | — | — | — |

**分离态（detached）是这套东西的前提**，不是优化：分离后没有消费者，若照常背压，
512KB 的 drain 很快写满 → PTY 写入被堵死 → 后台 agent 冻在那里。所以分离态的 drain
**永远接收、丢最旧的字节、只留尾部**（`DETACHED_TAIL_CAPACITY = 256KB`），一次多丢一些
避免每次 push 都做 O(n) 前移。

接回时 `detach_terminal_session(id, false)` 做两件事：关掉分离态（恢复背压）、顺便当
**存活探针**（drain 不存在 ⇒ 会话已结束 ⇒ 返回 `false`，前端改走新建）。drain 的存活
**就是** PTY 的存活，所以不需要再加一条 `ping` 命令。尺寸也要补一次 `resize`：
分离期间窗口可能被缩放过。

判据落点：谁能弹这个框由 `closeTabWithConfirmation` 判（tab 是 terminal、有
`ptySessionId`、注册表里那条会话 `isBusySession`）—— **三条关闭路径（TabBar X / 菜单 /
Cmd+W）因此自动一致**，不需要各自实现一遍。

**「进程活着」与「有活要丢」是两个问题**，故意是两个谓词：

| 谓词 | 为真 | 用途 |
| --- | --- | --- |
| `isLiveSession` | `running` / `awaitingApproval` / **`ready`** | 点会话行时**接回**那条活着的 PTY |
| `isBusySession` | `running` / `awaitingApproval` | 关 tab 时**要不要弹框** |

`ready` 的会话进程还活着（接回是对的），但 agent 已经干完了 —— 那时关 tab 就是普通的关 tab，
弹一个「它还在跑」的框是在说假话（2026-11-02 反馈）。用 `isLiveSession` 当弹框判据会让每个
干完活的 tab 都问一次，用户学到的教训是「无脑点退出」。

#### 终端的 `Failed` 在 UI 不可见（已知取舍）

`on_exit` 对**自然退出**仍是 `apply(exit_signal)` + 立刻 `unregister`：条目在同一次调用里
消失，于是非零退出的终端**不会**在侧栏留下红色失败点（chat 侧可见：`Error` 后条目保留到
bridge 结束）。要让它可见，就得像关 tab 那样保留条目 —— 那是产品决策，不是缺陷修复。

### 标题：准入 + 单调升级，唯一写路径

标题系统只有**两个正交判据**（`title/` 模块：`judge` / `text` / `prompt` / `native`，一个文件一件事），
缺一即失效：

- `title::admit(source, raw, agent_id) -> Option<String>` —— **准入**：这条候选配不配当标题
  （否定式，按来源分派）；
- `title::should_upgrade(current, incoming)` —— **覆盖序**：来源质量
  `Placeholder < Prompt < Native < User`（就是 `TitleSource` 的 `Ord`，
  `title_source_order_encodes_quality` 钉住）。同级可覆盖（同一来源后到的那份可能更完整），
  **弱级永不覆盖强级**，`User` 一旦设置任何自动来源都改不动它。

**为什么准入必须在写入之前**：单调升级会把任何**已进入**注册表的噪声**粘住** —— 一条
`Native` 噪声写入后，后续正确的 `Prompt` 再也改不回来。所以准入是唯一正确的拦截点。

**唯一写路径**：`SessionEntry::new` **不接收标题**（恒为空的 `Placeholder`），标题只能经
`Registry` 的 `upgrade_title` 写入。留一个 title 参数就是一条绕过准入的旁路 —— 而登记路径
一旦绕过，`admit` 就必须有两份实现。所以 chat 的标题素材是**按质量升序依次上报**
（`Prompt` 在前、`Native` 在后），由 `should_upgrade` 自己选强的；不再有 `pick`
（「取最强候选」就是序关系在空条目上的特例）。

| 来源 | 何时可得 | 素材 |
| --- | --- | --- |
| `User` | 用户改名 | tab 改名（本期不做入口，优先级先占位） |
| `Native` | hook 主题 / 恢复会话 / OSC 0/2 | `HookEvent.topic()`；`StreamRequest.topic`；`term.onTitleChange` |
| `Prompt` | chat 首轮 / 终端用户提交 | `StreamRequest.prompt`；`createUserInputActivityReporter` |
| `Placeholder` | 创建即知 | **空串**（不编名字，见下节） |

#### 准入判据（`title::admit`）

| 来源 | 判据 | 判负的例子 |
| --- | --- | --- |
| `Placeholder` | 永远 `None` | `pi` / `Terminal 1` |
| `User` | 非空白即可（不套任何清理） | 空白串 |
| `Prompt` | 含字母/数字、非斜杠命令、剥掉客套包装后仍非空 | `/model`、`/mo`、`@`、`Can you please` |
| `Native` | 剥装饰后非空、≥ 2 字符、含字母数字、非身份回显 / 状态词 / `Terminal N` / cwd | `π`、`✳ Claude ready`、`ready`、`Terminal 2`、`/Users/tomgs/repo`、`claude-code` |

`Native` 的四条子判据按不确定性升序：剥装饰（`✳ ✦ ⏲ ◇ ✋ ▲` / braille / 四分圆 / `. ` `* `）
→ 字符数 ≥ 2（`π` 是希腊字母，`is_alphanumeric` 挡不住它）→ 状态词 / `Terminal N` / cwd 形态
→ 身份回显（与 `agent_id` 归一后比较，`claude-code` ≡ `Claude Code`；漏判只是降级成固定短串）。

**CLI 差异落在数据**（`title/native.rs` 的常量表）：`BRAND_GLYPHS`（品牌装饰字形）、
`SPINNER_RANGES`（braille / 四分圆）、`WORK_PREFIXES`（`. ` `* `）、`STATUS_WORDS` /
`STATUS_PHRASES`、`ID_SUFFIXES`。新增一个 CLI 是**加一行数据**，判据函数不改 ——
与 `cli_status::CHANNELS` 同一条原则（红线 15 的通用形态）。

**身份判据的输入是 `agent_id` 而不是 `AgentConfig`**：`agent_id` 已在 `SessionEntry` 上，
纯函数层不新增对 agents 域的依赖。

#### 斜杠命令与纯符号**不是**标题（`admit` 的 `Prompt` 分支）

`Prompt` 的素材是「用户原样敲的字」，但**不是所有敲的字都是这次会话的主题**。判据只有
一处：`upgrade_title` 里的 `title::admit` → 拒绝命名（`has_user_input` 照样置位 ——
用户确实提交了，活动态与状态门必须变）。

实测事故（2026-10-31）：用户敲 `/model`，在 pi 的自动补全菜单里按回车 —— 我们捕获到的是
**半截命令** `/mo`（补全展开发生在 CLI 内部，上游字节里没有完整行），侧栏与 tab 标题都变成
这个既不是用户完整输入、也无从辨认的字符串。更根本的问题是：斜杠命令是**对工具的操作**，
不是「这次会话要谈的事」，当标题毫无检索价值。

判据取最保守的两条（`title/prompt.rs`，用例钉住）：

| 输入 | 结论 | 理由 |
| --- | --- | --- |
| `/model`、`/mo`、`/model Hy3 · routing group`、`  /init` | 命令 | 行首 `/` + 单个命令词（字母开头，正文无内部 `/`），可带参数 |
| `/Users/tomgs/repo`、`/usr/bin/env`、`//注释` | 内容 | 命令词里有内部 `/`，那是路径 |
| `修复 /api 的 500`、`查看 /model 的实现` | 内容 | 不在行首 |
| `@`、`>`、`?`、`。。。（纯符号）` | 拒绝 | 没有字母/数字（`char::is_alphanumeric`，中文算） |
| `Can you please fix the parser` | 内容（剥成 `fix the parser`） | 祈使包装对检索零贡献 |

只对 `Prompt` 生效：`Native`（CLI 自报主题）与 `User`（用户主动改名）即使以 `/` 开头也是
用户的真实意图。被拒的素材**不占用**「首条命名」这一步 —— 之后第一条真正的消息才能命名
（`report_user_input` 只在 `!has_real_title` 时写标题）。

#### 点击会话行恢复：原生 id 只在后端

侧栏会话行点下去可能**没有可用的 tab**（映射键丢失 / tab 已被回收）。此时按会话重建，
terminal 优先**续写**而不是重开：

```
SessionEntry.native_session_id  ← 只由 wiring::hooks 从 HookEvent.agent_session_id 写入
        │
        ▼
live_session_resume_command(session_id)   ← 前端点击时调一次
        │  ConversationManager::resume_command_for_native(agent, native_id, cwd)
        ▼
["--resume", "<native id>"]  ⇒ 前端拼 `<agent.command> <agent.args…> <args…>` 成 taskCommand
                                     （唯一实现：`shared/utils/agentCommand.ts` 的
                                      `buildResumeTaskCommand`，逐 token 加引号）
```

四条判据都写死了，缺一条就退回「新建同 agent 终端」，不猜：

1. **原生 id 只来自 hook**。neeko 自己的 `session_id` 对 CLI 毫无意义，拼不出 `--resume`；
   没装 hook 的 agent 永远拿不到它 —— 这是能力的真实边界，不是缺陷。
2. **不进 wire 契约**：`native_session_id` 是后端内部字段（视图不显示、不派生），
   `record_native_session_id` 因此**不 bump 版本**（否则侧栏为一个看不见的字段重渲染）。
3. **不经过 conversation 扫描缓存**（`resume_command_for_native`）：要求用户先去 Histor
   打开一次才能恢复，是死入口。
4. **`taskCommand` 是完整命令行**：一旦设置，`TerminalViewBase` 会跳过自动拉起 agent
   直接执行它（`if (tabAgentId && !taskCommand)`）。

#### OSC 标题来源：恢复，因为判据补上了

`term.onTitleChange`（OSC 0/2）曾因 `π`（pi 的品牌字形）覆盖用户首条输入而**整条来源被删**。
真正的成因是当时**没有准入判据**：`is_title_material` 是为 `Prompt` 写的，而状态栏形态恰好
**含字母**（`π` 是希腊字母、`✳ Claude ready` 含单词），全部放行。删来源的代价被低估了 ——
Claude Code / Codex 会把**任务标题**写进 OSC（`✳ Fix login bug`），那是 provider 自己做的
语义浓缩，质量高于 `Prompt`（原始按键）。

现在的分工是**判据 vs 传输优化**（判断标准：移除这一层，行为不变、只是变慢 ⇒ 优化）：

| 层 | 职责 | 删掉的后果 |
| --- | --- | --- |
| `title::admit`（后端） | 判据 | **出错** |
| 逐字去重（前端） | 同一串不发两次 | 变慢 |
| 首次提交前不发（前端） | 少发启动期噪声（cwd / 品牌名） | 变慢 |

前端**不做**任何过滤：`createUserInputActivityReporter` 原样上报每次提交，
`onTitleChange` 原样上报每次标题 —— judgement 只在后端一处（双端各判一次就是两套判据）。

**没有真标题时占位是空串**（不是 agent 名、也不是项目名）。理由（2026-10-31 两轮实测反馈）：

1. **agent 名不是标题**：占位曾取 `agent_id`，侧栏与 tab 显示 `pi` —— 与上下文无关的字符串，
   且与行首的 agent 品牌图标重复一遍；
2. **项目名也是冗余的**：会话行本身就挂在单元行下面，再写一遍项目名只是噪声。

空标题是**「这条会话还没有名字」的唯一表示**，由视图解释成「先不列出来」，不是后端兜底一个假名字：

- 侧栏**不列出**无名会话，也不列出「还没人用过」的会话：前端 `isListedSession`
  （`has_user_input` && 有标题）在 `sessionsByUnit` 里过滤，单元角标同源。
- tab 回退到自己的占位标题（绑 agent 的 tab 是 agent 名，空白终端是 `Terminal N`），
  会话有真标题后于渲染期换成它。

`has_user_input`（＝侧栏可见、tab 用会话标题）的置位点是**用户发出输入**，不是「打开 tab」：

| 生产者 | 「用户发过东西」的信号 |
| --- | --- |
| chat | `agent_stream` 的第一条消息（登记时即 `has_user_input`） |
| 终端 / WSL / SSH | 前端上报的每次用户提交（`set_live_session_title`，`source = prompt`）；首次非空行同时命名 |
| 任意 CLI | hook 上报（`turn_completed` 等语义事件） |

发送那一刻标题就已经拿到，用户就该在侧栏看到这条会话 —— **不等 agent 跑完**。
（曾经按「一轮跑完才可见」实现，实测反馈是「发完消息什么都不出现」，与 Codex 桌面端的
心智不符：它也是发出第一条消息就建会话。）

`agent_chat_open` 的静默建连、终端 PTY 的创建都不置位（打开 tab ≠ 在用）；
`agent_chat_resume` 恢复的是**已有历史**的对话，直接可见。

# 五个写入原语（`Registry`），生产者只决定「何时写」

| 原语 | 语义 | 谁用 |
| --- | --- | --- |
| `report(title, engage)` | 一次加锁内（可选）升级标题 +（可选）置位；真变化才 bump | CLI 纯信息事件（当前 `engage = false`） |
| `report_user_input(title)` | 首次无真标题时写入 `Prompt`；每次提交清权威门、置位并回 `Running` | 终端 / WSL / SSH 用户提交 |
| `report_authoritative(title, signal)` | 合并标题、可见性、权威状态转移与输出推断门 | CLI hook |
| `report_first(titles)` | 未置位 ⇒ 置位 + 按**升序**写候选；已置位但无真标题 ⇒ 只补标题；已有真标题 ⇒ 什么都不做 | chat 的首次 Engage（含 `Silent → Turn`） |
| `set_title(source, text)` | 只升级标题，不碰可见性 | `set_live_session_title`（OSC / 显式上报） |

准入（`admit`）+ 覆盖序（`should_upgrade`）+ 同值不写只有 `upgrade_title` 一份实现 ——
它是标题的**唯一写路径**（`SessionEntry::new` 不接收标题）。

`register_or_engage` 是 chat 的**唯一**登记入口，读两次 `kind`：

1. **未登记** ⇒ `register_if_absent` 之后按升序依次 `report` 候选（`Prompt` 再 `Native`）；
2. **已登记** ⇒ `Silent` 什么都不做；`Turn` / `Resume` 走 `report_first` ——
   这是 `agent_chat_open` → `agent_stream` 续聊主链路的**唯一**可见性来源
   （那条分支命中 `manager.owns` 后提前返回，不进 `spawn_session_pipeline`）。

续聊因此不重登记、不改名、不 bump：会话名取第一次 Engage 的素材。
缺少第 2 条时，用户「选了 agent 再发第一条消息」的会话永远不出现在侧栏（2026-10-31 实测回归）。

（`placeholder_title_is_empty_until_the_cli_names_itself` /
`plain_shell_terminal_also_has_no_placeholder_name` 钉住后端不编名字。）

#### hook 上报是最权威的标题源（`NEEKO_SESSION_ID` 精确归因）

CLI 的 hook 上报（`agent/hooks/ingest/event.rs::HookEvent`）里带着 **`title`** —— 模板
（`agent/hooks/templates/`）已经判好优先级：CLI 自己的会话名（pi 的 `getSessionName`、
claude 的 `session_title`）→ 首条用户消息；服务端 `HookEvent::topic()` 再过滤占位
（opencode 的 `New session - <ISO>`）。这正是 Codex 那类桌面端显示在会话列表里的东西，
因此投影为 [`TitleSource::Native`]（`live_sessions::wiring::hooks`）。

**归因只认 `hints.neeko_session_id`**：会话 id 由 PTY 子进程的 env 下发 ——

| 传输 | 注入方式 |
| --- | --- |
| 本地 PTY | `CommandBuilder::env(SESSION_ID_ENV, id)`（**每子进程一份**） |
| WSL | `bash -c "export NEEKO_SESSION_ID=…; export COLORTERM=…; exec ${SHELL:-bash} -l"`（WSL 不透传宿主 env） |
| SSH | 同一条 channel 的 shell 前缀：`export NEEKO_SESSION_ID=…; export COLORTERM=…; cd …` |

**为什么是 env 而不是 pid/祖先链或 cwd**：进程树是 `我们的 shell → agent CLI → hook shim`，
只有根是我们知道的；祖先链要跨 2+ 跳并查进程表（Node 只有 1 跳 `ppid`，Windows 要起 CIM），
cwd 在同一项目多会话时必然串号。env 是**唯一随进程树自动传播、零查询成本**的身份载体。
**禁止 `std::env::set_var`**（进程全局，多会话互相覆盖，`common/executor/env_defaults.rs` 已否决）。

两条边界：① 嵌套 agent 会把父会话 id 报上来 —— 可接受（那个 nest 确实在父会话的进程树里），
且会话注销后的迟到上报由注册表的 fail-closed 丢弃；② **不按 cwd 猜**：同一项目多会话是常态，
猜错的表现是「另一个会话的标题被改写」，而标题是用户直接读的文字 —— 宁可空着（`has_user_input`
这类可回收的低代价判断才允许粗归因）。

#### 终端会话的标题：首条**用户**输入（判据必须在前端）

终端会话的标题只有一个来源：**用户敲的第一行**。它在用户回车那一刻就写进注册表
（`set_live_session_title(source = prompt)`），侧栏与 tab 标题**立即**出现，不等 agent 跑完。

**为什么判据在前端**：`terminal-input-{id}` 同时承载两类写入 ——

1. 我们**自动启动 agent 的那行命令**（`TerminalViewBase` 创建会话后立即写入 `pi --approve\r`）；
2. 用户在 `term.onData` 里敲的按键。

而 `onData` **也不全是用户输入**：xterm 会把它**自己**对终端查询的应答从这里发出去 ——
CLI 查前景色时回 `ESC ] 10 ; rgb:3838/3a3a/4242 ST`（OSC 10），查光标位置时回
`ESC [ 12 ; 40 R`（DSR）。这些字节没有任何用户敲的字，混进来就会变成标题：实测侧栏出现
`10;rgb:3838/3a3a/424211,…` 这种乱码。判据是 **ESC 转义序列整段丢弃**（用户打字与
转义键同理不需要参与命名）；序列可能跨 `onData` 分块，必须保留不完整尾部而不是把尾段
当正文。唯一例外是 bracketed paste：xterm 会把用户粘贴内容包在
`ESC[200~ … ESC[201~` 中，标记必须剥离、内容仍按用户输入处理，且要支持跨 `onData`
分块与结束标记后的同块按键。

后端收到的是同一串字节，**无从区分**。早期实现把解析放在后端，结果一创建 tab 就把自动启动
命令当成首条用户输入 ⇒ 侧栏立刻冒出一条标题为 `pi --approve` 的会话。现在：前端
`features/terminal/utils/inputTitle.ts::createUserInputActivityReporter` 只在 `sendInput`
（= `onData`）路径解析。每次提交经 `set_live_session_title(source = 'prompt')` 上报：
首次非空行写标题并标记 `has_user_input`，后续提交只清除 hook 权威门；单个数据块最多发一次
活动 IPC，避免大段粘贴形成 IPC 风暴。

规则：除 bracketed paste 外的 ESC 序列整段丢弃（支持跨块）、粘贴起始/结束标记剥离后
按用户输入处理、累积到回车才结算、控制字符不进标题、空回车不写标题但算一次用户提交、
标题只取第一条非空行、超长截断
（`inputTitle.test.ts` 覆盖 OSC 10 / DSR 应答、跨块粘贴与同块尾随按键；后端
`reported_input` 用例钉住
「`Native`/`User` 胜过 `Prompt`」「后续提交不改名」「空白 Prompt 清门但不命名」）。

#### OSC 0/2 标题**不再是标题来源**（2026-10-31）

`term.onTitleChange` 拿到的多是 CLI 的**状态栏**：`pi` 会把自己的 logo `π` 设成终端标题，
`claude` 用旋转符表示「正在想」。它是 `Native` 级别，会覆盖用户的首条输入 —— 侧栏因此出现
一个 `π` 开头的会话名（实测反馈）。会话名必须来自真实内容：

- 用户输入（`prompt`）—— 回车即生效；
- CLI **自己命名的会话**（hook 上报的 `title`，`native`）—— 见上一节。

`terminalTitle.ts`（OSC 订阅 + 去重）已随此决定删除；`set_live_session_title` 的
`source` 参数保留，`native` 仍供 hook 侧使用。

`TitleSource` **不进 UI**：界面只表达结果（有真标题 / 占位），排名徽标是内部判据。
标题也**不写回 tab store** —— 渲染期由 `resolveTabTitle(tab, session)` 派生，否则会出现
第二份真相（用户改名后 tab 显示旧值）。

### 快照是 credit-pull，不是推送

`SESSIONS_EVENT`（`live-sessions://changed`，两端各一条常量）**只载荷版本号**；前端凭它 /
`wait_live_sessions` 的返回值再拉一次 `list_live_sessions`。原因与终端 drain 同源：macOS WebKit
上每次事件送达 = 一次 `evaluateJavaScript` 且无条件克隆完成值，推送全量快照会让 RSS 只增不减。
长轮询复用同一信用拉取形态：版本未变就挂起（`wait_times_out_without_spinning`），变则立即返回
（`wait_wakes_up_on_state_change` / `wait_returns_immediately_when_the_version_already_moved`）。
**快照是全量的，单元分组只在前端**：`list_live_sessions()` 不带地址参数，按
`workspaceKey` 等值的分组由前端 `sessionsByUnit`（纯函数）+ `useSessionsByUnit`（一次 O(n) 分组
供所有行共用）完成。曾经的 `workspace: Option<WorkspaceSession>` 参数没有任何调用方，却让后端多出
一套与前端并行的「单元归属」判据（`UnitScope::owns` 按 cwd 最深根 vs 前端按 key 等值）——
两套判据迟早对不上（`snapshot_returns_every_unit_and_keeps_the_address_key` 钉住「全量」）。

## 1. Scope / Trigger

- **Trigger**：改 `src-tauri/src/agent/chat/adapter/{acp,deepseek}.rs` 或
  `adapter/pi_rpc/`、`adapter/opencode/`；改 `common/agent/chat_launch.rs`；
  给某个 agent 接上 chat 能力；改 `live_sessions/`（§0.2 —— 会话状态与标题的唯一来源）
  或 `terminal/router.rs`（PTY 生产者的登记点）。
- **前提认知**：`ChatLaunch` 是**能力数据**，不是 id 判定的替代品。`adapter_for`
  按 `ChatLaunch::transport()` 分派，任何适配器内部都不得出现 `agent_id ==`
  分支（护栏 `tests/unit/agent_model_dispatch_test.rs`）。

## 2. `ChatLaunch` —— 启动配置只有一个来源

```rust
pub struct ChatLaunch {
    pub program: Option<String>,          // argv[0]；None = 沿用 AgentConfig::command
    pub args: Vec<String>,                // argv[1..]
    pub env: BTreeMap<String, String>,    // 仅 chat 进程
    pub inprocess: bool,                  // 进程内实现，不 spawn 子进程
}
```

**传输不是字段，是派生物**。`ChatLaunch::transport()` 从 `program + args` 的
**完整 token** 流识别：

| 命中的 token | 传输 |
| --- | --- |
| `acp` | `Acp` |
| `serve` | `Serve` |
| `--jsonl` / `stream-json` | `Jsonl` |
| `--mode rpc`（相邻两 token）或裸 `rpc` | `PiRpc` |
| 以上都没有（含空） | `Acp`（默认，唯一通用协议） |

判定顺序即优先级。**必须用完整 token 比较，不得子串匹配** —— `--preserve` 与
`--observe` 都含 "serve"，子串匹配会把它们判成 Serve 传输。

### 2.0 两个必须显式化的边界（不是可推导的）

两个事故都是同一病因：**把「数据」退化成「从其他字段推断」，于是推断规则覆盖了
它本不覆盖的情况**。

#### 2.0.1 序列化往返：判别式只能用旧格式独有的键

`program` / `args` / `env` 全部 `skip_serializing_if` 省略，所以 `{}` 与
`{"args":[…]}` 都是**我们自己的 `Serialize` 输出**。旧判别式用「有没有 `program`」
区分新旧格式 → 这两份输出被判成旧对象而解析失败。

后果是「保存即损坏」：内置 `pi`（`{"args":["--mode","rpc"]}`）与 `mockAgent`（`{}`）
一旦被用户覆盖保存，下次启动就被 `boot::load_custom_agents` 与
`app_state::agent_manager_with_overrides` 当作损坏条目 `warn` + `continue` 静默丢弃。

**现在的唯一判据是 `transport` 键**（只有旧格式 B 会写它）。护栏：
`every_launch_round_trips_through_its_own_output` +
`builtin_launch_shapes_round_trip` + `every_builtin_agent_survives_a_persistence_round_trip`。

> 教训：**“能读旧配置”不是兼容性充要条件，“能读自己写的东西”才是**。后者被破坏时
> 没有任何运行时错误 —— 只有用户配置消失。

#### 2.0.2 进程内实现是显式字段，不从空命令行推断

「没有可执行文件」有两种互不相干的原因：

| 原因 | 想要的行为 |
| --- | --- |
| **设计如此**（`mockAgent`） | 路由到 `AcpAdapter::mock()` |
| **填漏了 / 暂时禁用**（用户清空 `command`） | 报错，而不是偷偷降级 |

按「命令行推为空」推断会把后者静默变成前者，得到一个「能连上但永远不回话」的
会话 —— 正是本类型要消灭的失败模式。所以 `inprocess` 是**字段**：
`AgentConfig::is_inprocess_chat()` 只读它，不读 `chat_cmd_vec()`。

同理，前端表单必须把 `inprocess` 作为独立状态（`chatInprocess`）传递 —— 否则
`mockAgent` 经表单往返会退化成「无 CHAT 能力」（`buildChatLaunch` 对空命令返回 `null`）。

### 2.1 历史包袱：为什么不再是枚举

旧的 `ChatStart` 枚举（`Acp{args}` / `Serve` / `Jsonl` / `Mock` / `PiRpc`）把
「用哪个协议」和「怎么启动它」混在一起，且启动参数还拆在
`AgentConfig::chat_command` / `chat_args` 里。四份来源合并成一个命令行，产生了
三个语义歧义：

1. `chat_command` 一旦设置就**吞掉** `args`（理由：那些参数描述另一个进程）。
2. `Acp.args` 与 `chat_args` 都在 `argv` 尾部，谁先谁后无原则可依。
3. `Serve` 干脆不读配置，**硬编码 `"opencode"`**。

随之而来的是设置页出现一个传输下拉，让用户去声明一个他无法改变的事实：
内置 11 个 agent 里只有 3 个有 chat 能力，其中 **0 个用 ACP**。选错只会得到
跑不起来的配置，且表单给不出任何提示。现在的 UI 是一行启动命令 + 识别结果。

## 3. 四条传输

| 传输 | 适配器 | 协议 | 进程数 | 典型启动命令 |
| --- | --- | --- | --- | --- |
| `Acp` | `AcpAdapter` | JSON-RPC over stdio | 1 | `opencode acp` · `gemini` |
| `Serve` | `ServeAdapter` | HTTP + SSE | 1（serve 本身） | `opencode serve` |
| `Jsonl` | `DeepSeekHarnessAdapter` | 私有 NDJSON over stdio | 1 | `<bin> --jsonl` |
| `PiRpc` | `PiRpcAdapter` | 私有 NDJSON over stdio | 1 | `pi --mode rpc` |

**`Jsonl` 与 `PiRpc` 不共用一个传输标识**：两者都是「私有 NDJSON」，但命令形状与
事件类型完全不同（DeepSeek Harness 是 `{type:...}` 单层；Pi 有 `response` 配对层 +
`assistantMessageEvent` 嵌套）。共用一个标识会让适配器里出现「解码后再按 kind
分支」的二段分派。

### 3.1 进程内实现不是传输

`mockAgent` 的形状是「显式 `inprocess: true` + 无 argv」→ `AgentConfig::is_inprocess_chat()`
判真 → `AcpAdapter::mock()`。判据不是 id 特判，新增内置实现不需要改分派。

它**不能**用「`command` 为空」判定（见 §2.0.2）——那会把「用户清空了 command 的配置」
误路由到 mock。

## 4. 新增一条传输必须改的落点

**从 4 处收敛到 3 处**（2026-10-23 `10-23-agent-chat-registry`）：

| # | 落点 | 形态 | 漏掉的后果 |
| --- | --- | --- | --- |
| 1 | `common/agent/chat_launch.rs` 的 `TRANSPORT_RULES` | 一行 `rule(…)` | 识别不出，永远走默认 ACP |
| 2 | `ChatTransport` 变体 + `ALL` | 枚举两处 | 编译报错（`ALL` 与规则表的等长断言是**编译期**失败） |
| 3 | `agent/chat/adapter/registry.rs` 的 `PROTOCOL_BUILDS` | 一行 `build(…)` | 运行期 panic（见下方「已知代价」） |
| 4 | 前端 `shared/types/agent.ts` 的 `TRANSPORTS` | 一行 | 跨栈护栏红（`id` 序列不符） |

### 4.0.1 为什么是两张表而不是一张

| 表 | 位置 | 关注点 | 能否依赖 adapter |
| --- | --- | --- | --- |
| `TRANSPORT_RULES` | `common/agent/` | **怎么识别**（argv token 规则 + `id`） | 不能 —— 它是 `ChatLaunch` 自身的释义 |
| `PROTOCOL_BUILDS` | `agent/chat/adapter/` | **怎么构造**（哪个 adapter） | 能 —— 它就是 adapter 层的东西 |

合成一张放进 `common/` 会让 `common` 反向依赖 `agent::chat::adapter`，与既有的
`adapter → common` 构成**环**（`common` 对本域的生产依赖此前为零）。分成两张后两边都单向。
代价是「新增传输」从 2 处变 3 处，这个取舍是**有意的**。

### 4.0.2 已知代价：表化**不恢复编译期穷举**

改成 `match` 遍历表后，漏一条表项**不再编译报错**。这是表化的代价，用三道防线抵消：

1. **编译期**：`const _: () = assert!(ChatTransport::ALL.len() == TRANSPORT_RULES.len());`
2. **测试期**：`every_transport_variant_has_a_rule` / `rule_table_has_no_extra_entries` /
   `every_transport_variant_has_a_build` / `both_tables_list_transports_in_the_same_order`
3. **运行期**：`rule_for` / `build_for` 查不到直接 `panic!`，消息指向要改的文件

**不要**在文档或注释里声称「`static` 表 = 集合编译期可见」—— 那是错的（曾写在 design 里，
被评审纠正）。`static` 只让表**内容**编译期可见；枚举 ↔ 表项的映射由 `find` 在运行期完成。

### 4.0.3 `adapter_for` 不得含传输分支

`adapter_for` 体内容忍的只有两条前置早退（无 chat / 被用户关闭），分派一律走
`build_for(launch.transport())`。护栏 `adapter_for_has_no_transport_branches`
读源码断言（跳过注释行，并配平花括号取函数体）。

**为什么这条重要**：加回 `match` 就把「新增传输要改分派处」重新引入，而表化的全部目的
就是消除它。

### 4.0.4 跨栈护栏走机器可读的 `id` 序列

`shared/types/__tests__/transports.test.ts` 读后端 `TRANSPORT_RULES`，断言两端
`id` **有序序列相等**（顺序即优先级）。这取代了旧的「逐 token `expect(rust).toContain('"acp"')`」
—— 那种写法只证明「字符串出现过」，证明不了「两端判据一致」。

规则细节（哪些 token）只归后端所有，前端不重复一份。

### 4.0.5 ACP 帧格式是配置项，不是推断结果

`ChatLaunch::wire_format`（`ContentLength` 缺省 / `Ndjson`）只有 ACP 消费。**禁止**按
可执行文件名在 spawn 路径推断 —— 那条逻辑曾让「把 opencode 改名 / 包一层 wrapper」
静默换错协议（握手无响应、无报错、UI 永远转圈）。护栏
`adapter_never_guesses_the_wire_format_from_the_program_name`。

**迁移期推断与运行时推断的区别**（这是最容易被误读成「bug 回来了」的地方）：

| 层 | 位置 | 处理什么 | 结果去向 |
| --- | --- | --- | --- |
| 反序列化期 | `from_legacy_str` / `from_legacy_object` | 旧格式独有键（裸串 / `transport`） | 立即落盘（下次序列化写出） |
| **装载期** | `AgentConfig::migrate_legacy_chat_wire_format`（`agent/boot.rs` 装载 `customAgents` 时调用，写回配置 JSON，经 `outcome.migrated` 落盘） | 当前形态快照；**command 回落**（旧推断看 `chat_cmd_vec()[0]`，program 缺省时是 command） | 下次保存落盘 |
| 运行期 | **无 —— 禁止恢复** | — | — |

「旧版本写的当前形态」与「新版本写的缺省值」按内容不可区分，区分靠**时机**：serde 层
不做当前形态推断（保 `deserialize(serialize(x)) == x` 往返不变量），装载层只在读持久化
快照时补。显式值（**含 `ContentLength`**）永远短路推断。推断实现只有
`infer_legacy_wire_format` 一份。

前端表达：`ChatLaunchEditor` 对 ACP 传输暴露 Wire Format 选择器；显式
`'content-length'` 落盘是 opencode 命名二进制固定帧格式的唯一方式（否则每次装载都会被
重新推断成 NDJSON）。

## 4b. 环境变量的两层

| 字段 | 作用域 | 消费点 |
| --- | --- | --- |
| `AgentConfig::env` | agent 全局（TUI + chat） | 保留；当前无 TUI spawn 消费点 |
| `ChatLaunch::env` | **仅** chat 进程 | `AgentConfig::chat_env()` |

```
生效环境 = 父进程继承 ∪ AgentConfig.env ∪ ChatLaunch.env   (靠后覆盖靠前)
```

合并**只在 `AgentConfig::chat_env()` 里发生**。四个 adapter 的 spawn 入口各不相同
（`spawn` / `spawn_with` 历史差异），各拼一份必然漂移。

**内部必需变量最后写入**：`OPENCODE_SERVER_PASSWORD` 由 `connection::merged_env`
在用户 env 之后插入，用户改不动 —— 它是内部协议细节，填错只得到 401，而 401 的
根因从 UI 上看不出来。护栏：`connection::merged_env_tests`。

### 4b.1 `!VAR` 引用：凭证不落明文

`ChatLaunch::env` 是本仓第一个真正承载**凭证**的配置字段（`ANTHROPIC_API_KEY` 之类），
而 `~/.neeko/config.json` 是明文 JSON、无加密依赖。

```
CHAT Env 里写 KEY=!ANTHROPIC_API_KEY
```

- `!` 前缀 = 「取父进程同名变量」。配置里只留变量名，**值不落盘**。
- spawn 用 `AgentConfig::resolved_chat_env()`（展开后），序列化用 `chat_env()`（字面量）。
- 引用的变量不存在 → **报错上抛**，不静默传空串：空串会让 agent 收到「已设置但无效」
  的 key，表现是 401，而 401 的根因从 UI 上看不出来。
- `!` 不在开头（`a!b`）是普通值。
- 语法与 `docker-compose` 插值同形，用户零学习成本。

护栏：`env_references_are_resolved_from_the_parent_process`（含缺变量报错）+
`env_reference_literals_survive_serialisation`（断言明文不出现）。

> **已知限制**：非 `!` 的值仍以明文存 `config.json`。完整方案（系统 Keychain /
> Windows Credential Manager）单开任务。

## 4c. exec spawn 只有一个入口

`core::exec::spawn(target, cmd, args, SpawnSpec)` —— 目录 / 环境变量 / 进程组语义
全走 `SpawnSpec`。历史上 `spawn` / `spawn_with` / `spawn_with_env` 三个 facade
只是 `SpawnOptions` 的三种参数组合，造出了「cwd + env 同时要」的语法窟窿
（`pi_rpc` 要 cwd、chat adapter 都要 env）。

`SpawnSpec::kill_tree` **默认 `false`**：显式优于隐式，迫使调用方思考进程组语义。
受管长驻进程（LSP / DAP / chat adapter）应显式 `.kill_tree()`。

## 4. Pi rpc 的协议事实（一手实测 pi 1.3.0）

### 4.1 三条通道

```
① 命令（我们 → pi）   {"type":"prompt","id":"<uuid>","message":"…"}
② 响应（pi → 我们）   {"type":"response","id":"<uuid>","success":bool,"data":…}
③ 事件（pi → 我们）   无 id 的其它 JSON
```

判别只看两条：`type == "response"` **且** 有 `id` → 响应（按 id 配对后**不进事件流**）；
否则 → 事件。

响应若混进事件流，前端会把 `get_state` 的回包当成一条对话事件渲染。有测试锁死
（`response_is_routed_to_pending_and_not_broadcast`），变异验证过。

### 4.2 回合结束判据是 `agent_settled`，**不是** `agent_end`

pi 一次用户 prompt 可能发出**多个** `turn_end` / `agent_end`（自动重试、上下文压缩、
队列续跑各发一次）。用其中任何一个当回合结束，都会让后续输出被当成「回合外」丢掉。

护栏测试 `only_agent_settled_ends_the_turn` 构造了
`agent_start → text → agent_end → auto_compaction_* → text → agent_end → agent_settled`
的完整序列。变异验证：把判据改成 `agent_end` → 该用例变红。

### 4.3 `get_available_models` 返回结构化对象，`provider` 是独立字段

```json
{"models":[{"id":"deepseek-flash","name":"…","provider":"deepseek",
            "contextWindow":…,"reasoning":true,"thinkingLevelMap":{…}}]}
```

实测 198 个模型，每个自带 `provider`。所以 `set_model` 直接传
`{provider: m.provider, modelId: m.id}`，**不需要拆 `provider/model` 复合串**。

> 这一点与 opencode serve 相反（它的 id 是 `provider/model`，需要
> `serve.rs` 的 `model_slug_split`）。**不要把两者混为一谈。**

### 4.4 档位是**动态**的，与当前模型相关

```json
{"levels": ["low","high","max"]}
```

当前模型的 `thinkingLevelMap` 决定哪些可用（值为 `null` = 不支持）。
所以**每次切模型后要重新拉档位**，不能缓存一次用到底。

### 4.5 `extension_ui_request` 在启动时就会来，且不全是审批

实测启动即有 4 条：`notify`（Trellis 上下文）、`setWidget` ×2、`setStatus`。
这些是 **Pi 扩展的 UI 渲染请求**，不是工具审批。

**必须**按 `method` 分派。一律映射成 `RequestApproval` 会让用户每次开 Chat 都看到
一串莫名其妙的审批弹窗。护栏：`extension_ui_request_is_not_an_approval`。

### 4.6 上游失败只藏在 `turn_end` 里（实测 pi 1.4.0）

上游 API 调用失败（key 无效 / 网络 / 模型不存在）时，pi **不发独立的 error 事件**：
`agent_start → turn_start → message_start/end(空 content) → turn_end → agent_end → agent_settled`，
失败信息只在 `turn_end.message.stopReason == "error"`（实测 `big-pickle` 上游失败：
`content: []`、`usage.totalTokens: 0`、telemetry `success:false`）。

把 `turn_end` 归为「静默生命周期事件」= **用户发消息零输出零提示**（2026-10-22
实测事故）。translate 必须检查 `stopReason`：`"error"` 时产出
`StreamEvent::Error`（code `E_TURN_FAILED`），且**消息体取
`turn_end.message.errorMessage` 原文透传**（实测：`403: {"type":"FreeTierError",…}`，
含上游 HTTP 状态码与错误体）—— 只报 provider/model 等于让用户自己翻
`~/.pi/free.log`。`errorMessage` 缺失（旧版 pi）才回落到 provider/model 定位串。
护栏 `turn_end_with_error_stop_reason_must_surface` /
`turn_end_error_message_is_passed_through_verbatim` /
`turn_end_error_without_detail_falls_back_to_model_identity` /
`turn_end_with_normal_stop_reason_produces_no_error`。

pi 侧日志线索：`~/.pi/free.log` 的 `[telemetry]` 行带 `success:false` 与
provider/model —— 排障时先看它，能直接区分「上游失败」与「Neeko 丢事件」。

### 4.6b `agent_settled` 的 `reason` 决定通知，且失败不可被追认为完成

`agent_settled` 是**唯一**的回合终止信号（`turn_end` / `agent_end` 在重试/压缩
时会发多次），因此它的 `reason` 一路 downstream 到通知：

| 载荷 | 正确 reason | 不区分的后果 |
| --- | --- | --- |
| `{aborted: true}`（用户点停止） | `Stopped` | 发「Agent turn completed」通知 —— `notify.rs` 的 `Stopped => return None` 在 pi 上永不可达 |
| `{aborted: false}` | `Completed` | — |
| 字段缺失（旧版 pi） | `Stopped` | 保守取「被叫停」：宁可少一条完成通知，不谎报成功 |

**跨事件事实必须落在会话层，不能放进 `translate`。** 失败与终止是**两条**事件：
`turn_end{stopReason:error}` → `Error`，随后 `agent_settled{aborted:false}` →
`TurnEnd{Completed}`（pi 不认为「上游报错」算 abort）。两条都只看得见自己：

- `translate` 是纯函数（这是它能被密集单测的前提，不能破）；
- `agent_settled` 的载荷里没有「本轮是否报过错」。

于是 `notify.rs` 的两条互斥声明被同时触发（「Agent session failed」+「Agent turn completed」）。
修法：`PiSession::absorb()` 在**入队那个事件边界**维护 `turn_failed`，遇
`Error` 置位、遇 `TurnEnd` 消费并清零（下一轮从干净状态开始）。

护栏：`agent_settled_aborted_maps_to_stopped_not_completed` /
`agent_settled_without_aborted_field_defaults_to_stopped` /
`failed_turn_is_not_reported_as_completed` /
`failure_state_does_not_leak_into_the_next_turn`。

> 写测试时的坑：用例用 `while let Some(ev) = session.next().await` 会**永久阻塞**
> —— 假 pi 不关事件流。一律有界读取（`for _ in 0..N`）。

### 4.7 没有前导人类可读行（实测）

`pi-acp` 的实现里有 `preludeLines` 收集（`JSON.parse` 失败的行存起来），推测是它
spawn 时带参数或旧版本行为。**pi 1.3.0 实测 `非 JSON 行: 0`**。

因此本仓**不做**专门的 prelude 收集链路 —— 只为「解析失败不崩」做最小容错
（`log::warn!` 后跳过，循环继续）。为一条从未触发的路径写收集+展示是没有验证
手段的死重量。真机出现非 JSON 行时再按当时的形状决定。

### 4.8 用量遥测：两条有数据的传输（PiRpc 拉取 / Acp 推送）

上下文用量计量器（前端 `ContextWindowMeter`）的数据源按传输分两类：
PiRpc 靠回合后**拉取**，Acp 靠 agent **推送**；opencode serve 与 DeepSeek
jsonl 协议侧无 token 数据（`Meta` 无生产者 → 前端计量器整体不挂载，给它们接
用量前先复核上游协议是否已变，基线见 10-24 任务 `research/usage-data-sources.md`）。

**PiRpc**：数据只能从 pi 的 `get_session_stats` 命令来 —— assistant message 上的
per-turn `usage` 没有窗口上限，事件流里也没有任何 token 事件。协议事实
（pi docs `rpc-commands.md`，1.4.x 实测文档）：

- `tokens` 是**会话累计**（含 tool 嵌套与 compaction 生成用量），且
  `input` **不含** cacheRead/cacheWrite（`totalTokens = input + output +
  cacheRead + cacheWrite`）；
- `contextUsage` 是**当前上下文占用估计**（compaction/footer 同源）：无模型/
  无窗口信息时整体省略；compaction 后到新 assistant 响应前 `tokens`/`percent`
  为 `null` —— **正常降级，不是错误**；
- `contextUsage.percent` 不复用：前端自算（单一真相，舍入口径不漂移）。

接线契约（`session.rs`）：`translate` 只置 `Translation.settled` 标记（纯函数
不发请求，与 `approval` 同模式）；`PiSession::next()` 把标记转为
`stats_pull_pending`，在**事件空闲窗口**（`pending` 排空、即将阻塞读进程的
下一轮循环顶部）才发 `get_session_stats` —— TurnEnd（必要数据）的交付不串行
等遥测（可选数据），拉取延迟落在回合间空档，对用户不可见。专用
`STATS_TIMEOUT`（2s）短于 `AUX_TIMEOUT`（5s）：用户在空档期发下一条消息时，
新话轮的流式事件要排队等这次 RPC 落幕，2s 框住「旧版 pi 对未知命令不回应」
的最坏延迟。`meta_from_stats`（纯函数）把回包映射为 `Meta` 事件的
`Usage` 扩展字段（`context_tokens` / `context_limit` / `cache_read_tokens` /
`cache_write_tokens`，全 `#[serde(default)]` 向后兼容）。**stats 拉取失败只
`log::debug!` 跳过，不发 Error** —— 遥测缺失不等于回合失败；旧版 pi 没有该
命令时表现为「无计量器」，无害。护栏：`turn_end_is_delivered_without_waiting_for_stats` /
`settled_turn_pulls_session_stats_into_a_meta_event` /
`stats_failure_does_not_surface_an_error_event` /
`meta_from_stats_treats_null_context_fields_as_missing`。

缓存命中率口径（前端派生，协议只传原始计数）：会话累计
`cacheRead / (input + cacheRead + cacheWrite)`，三计数缺任一或分母为 0
即不渲染（禁止假数据）。

**Acp**：RFDS [`session-usage`](https://agentclientprotocol.com/rfds/session-usage)
（Completed 2026-06-05）定义 `session/update` 的 `usage_update` 变体，agent
**主动推送** `{used, size}`（可选 `cost`，本期忽略）—— 旧 agent 不发，
`translate_notification` 的 `_ => None` 兜底天然兼容。接线契约
（`acp.rs`）：`used → context_tokens`、`size → context_limit`，均 required
缺任一忽略；载荷不携带模型名，由 `handle_inbound` 注入
`current_model_from_config` 的当前值。**snapshot 必须按变体名窥探后再取**
（`session_update_kind == "usage_update"` 才取）：`session/update` 同时承载
高频 text delta，无条件 `configs.snapshot()`（Mutex + 全量配置深克隆）是
每条 delta 一次的无谓分配（2026-10-24 trellis-check 实测修复）。协议无
cache 计数（拆分在 draft RFD `end-turn-token-usage`）→ 命中率行降级。
护栏：`usage_update_maps_used_and_size_into_meta` /
`usage_update_without_size_is_ignored` / `usage_update_tolerates_float_counts`
（JSON number 可能由浮点类型产生，`as_u64` 静默失败会丢整条更新）。

## 5. 新增传输的检查清单

1. `ChatLaunch::transport()` 的 token 判定 + `ChatTransport` 变体 + `as_str()` + `adapter_for`
2. 前端 `transportOf()` / `TRANSPORT_LABELS`（没有选项列表 —— 传输是派生物）
3. `pi_rpc/` 式目录拆分（不要单文件 —— `deepseek.rs` 已 900+ 行）
4. `mod.rs` 保持极薄（红线 9）：只 `mod` 声明 + `pub use`
5. 纯函数翻译层（事件 → `StreamEvent`）单独成文件，这样「事件序列」类时序 bug
   才能被密集单测覆盖
6. 进程层用 duplex 管道做测试夹具，**不起真进程**
7. 真机验证（外部二进制存在性不可 mock）

## 6. 常见错误

| 错误 | 后果 |
| --- | --- |
| token 判定写成子串匹配 | `--preserve` / `--observe` 被判成 Serve 传输 |
| `acp` 判定排在 `serve` 之后 | `opencode serve acp` 静默走错传输 |
| 未知传输字符串兜底成 ACP | 拼错的 `"acpp"` 悄悄当 ACP spawn（**已改为报错**） |
| 用 `agent_end` 判回合结束 | 压缩/重试场景提前结束，后续输出丢失 |
| 响应也广播给事件流 | 前端把回包渲染成对话事件 |
| `extension_ui_request` 一律当审批 | 启动时弹出一串无意义审批 |
| 把 `provider` 从模型 id 里拆 | Pi 的 provider 是字段，拆了会得到错误值 |
| 档位列表缓存一次用到底 | 换模型后档位选项与真实能力不符 |
| 为「从不触发的 prelude」写展示链路 | 无验证手段的死重量 |
| 声明 `resume: true` 却不覆写 `resume()` / `supports_chat_resume()` | 前端入口成死入口（红线 14：声明了没人实现 = 静默功能缺失） |
| 恢复参数（`--session`）排在用户 args **之前** | 用户配置的 `--session` / `-c` 后写者胜，**静默劫持恢复目标** |
| 恢复后不校验 `get_state.sessionId` | 部分 UUID 歧义会绑到别的会话，静默污染它 |
| 进程退出只 `log::debug!` 不 settle pending | 在途请求退化成 5s 超时，原因完全错误 |
| 丢弃 stderr | 真实原因（`No session found matching …`）永远看不到 |

## 7. 测试清单

| 位置 | 覆盖 |
| --- | --- |
| `common/agent/types.rs` | `pi-rpc` 解析 / 往返 / 不被兜底吞掉 |
| `pi_rpc/translate.rs` | 文本/推理增量、空 delta 丢弃、**压缩场景序列**、扩展请求不是审批、畸形事件不 panic |
| `pi_rpc/process.rs` | 响应按 id 配对不广播、无 id 广播、非 JSON 行不杀循环、迟到响应丢弃、**进程结束→在途请求快速失败**、stderr 尾部有界 + `append_stderr` / `tail_of` |
| `pi_rpc/adapter.rs` | `extra_args` 顺序（tail 在用户 args 后）、`ensure_bound_to` 三态、`caps.resume == supports_chat_resume()`、`resume()` 覆写存在（假二进制→spawn 类错误） |
| `pi_rpc/session.rs` | 握手失败时错误带 pi stderr 尾部、`resume_id` 来自握手 |
| `capability_probe.rs` | 四条传输的 `resume` 位 ↔ `supports_chat_resume()` 一致；位 true ⇒ `resume()` 非默认实现 |
| `pi_rpc/config.rs` | 模型映射（provider 放 `group`）、缺字段降级 |
| `agent/builtin/tests.rs` | Pi 走 `PiRpc` 传输 + **不得**声明 `model_list_args` |
| `agent/model_discovery.rs` | 表格解析器已删除的反向护栏 `pi_table_output_is_not_parsed_any_more` |
| `chatTransportOptions.test.ts` | 前端选项 ↔ 后端字符串三处同步、分支顺序 |

## 8. 会话配置项：跨传输的契约 vs 传输专属语义

`SessionConfigOption` / `ConfigOptionsState` / `find_model_option` 曾住在
`adapter/acp_config.rs`。这误导性很强 —— Pi 适配器 `use acp_config::…` 读起来像
「Pi 依赖 ACP」，而它实际依赖的完全是协议无关的部分。**位置即依赖声明。**

现在按「是否只有 ACP 成立」切开：

| 文件 | 内容 |
| --- | --- |
| `adapter/session_config.rs` | 数据结构（`SessionConfigOption` 及值/选项类型）、`CATEGORY_*` 常量、定位函数、`ConfigOptionsState` 状态机。**协议无关**，ACP 与 Pi 共用 |
| `adapter/acp_config.rs` | `session/new` 响应解析、`session/set_config_option` 请求体、`ModelSwitch` 三态帧。**只有 ACP 成立**；re-export 前者以保持调用方零改动 |

**判据**：一个函数若对 payload 只做「取字段 / 查表 / 判断相等」，它属
`session_config.rs`；一旦它构造或解析 ACP 的 JSON-RPC 帧，才留在 `acp_config.rs`。

### 8.1 两条传输的配置项来源不同

| 传输 | 来源 | 需要投影？ |
| --- | --- | --- |
| ACP | agent 下发 `configOptions` 数组 | 否 —— 直接 `parse_config_options` |
| Pi rpc | 三份独立查询（`get_available_models` / `get_available_thinking_levels` / `get_state`） | **是** —— `pi_rpc/config.rs::project_config_options` |

Pi 是唯一需要**凭空构造** `SessionConfigOption` 的传输，所以投影集中在
`pi_rpc/config.rs` 的纯函数里，不散落到会话层。

### 8.2 `set_model` 的响应不是全量配置

ACP 的 `set_config_option` 响应携带**全量** `configOptions`，所以状态可以整体替换。
Pi 的 `set_model` 只回**被设置的那个模型对象**，`set_thinking_level` 连 `data` 都没有。

因此 Pi 侧切完必须**重新拉三份查询**再推 `ConfigOptionUpdate`（见
`session.rs::refresh_configs`）。照抄 ACP 的「用响应替换状态」会得到一份残缺配置。

### 8.3 档位是动态的，必须跟着模型重拉

`get_available_thinking_levels` 实测返回 `["low","high","max"]`，而当前模型的
`thinkingLevelMap` 决定哪些可用（不支持档位值为 `null`）。**每次切模型后必须重拉**，
缓存一次用到底会让下拉里的档位与真实能力不符。

### 8.4 能力声明必须诚实

`Capabilities.approvals` 在接通 `extension_ui_request` → `RequestApproval` 之前
必须声明 `false`。声明 `true` 而没实现，前端会等一个永不到来的审批弹窗。

## 9. Pi 的工具调用与审批

### 9.1 三件套按 `toolCallId` 关联

```text
tool_execution_start  { toolCallId, toolName, args }
tool_execution_update { toolCallId, partialResult }
tool_execution_end    { toolCallId, result, isError }
```

没有 `toolCallId` 的事件直接丢弃 —— 发出去只会是孤儿，前端无法更新对应那一行。

**`tool_execution_start` 的 `title` 必须取 `args.command`（bash 的实际命令）**：
只填工具名时工具执行**中**的卡片是空的 —— 前端 `extractCommand` 的输出回显
兜底要等 `tool_execution_end` 才有材料（2026-10-22 实测：光秃秃的 "$ bash"）。
其余工具（read/edit）的 args 字段名不统一（`path` 等），无可提取命令时回落工具名。
护栏 `tool_start_carries_the_command_as_title` /
`tool_start_without_command_arg_falls_back_to_tool_name`。

**`ToolEnd` 的交付顺序是硬约束**：`tool_execution_end` 的 `result` 是最终输出，
必须先 `ToolOutput` 再 `ToolEnd`。反过来会让前端先关掉那一行再收到内容，
表现出来就是「输出丢了」。护栏：`tool_end_delivers_final_output_before_status`。

结果形状不统一（`content[]` / `details.stdout` / `stdout` / 结构化 `diff`），
按**信息量从高到低**取第一个非空的，不要拼接 —— `details.stdout` 往往就是
`stdout` 的副本，拼起来会产生重复内容。

### 9.2 审批：`method` 决定一切，且 pi 没有统一的审批信封

`extension_ui_request` 一个 `type` 承载两种东西：启动时的扩展 UI
（`notify` / `setWidget` / `setStatus`）与真正的用户交互（`select` / `confirm`）。

| 请求 method | 是否审批 | 回写形状 |
| --- | --- | --- |
| `confirm` | ✅ | `{confirmed: bool}`，**拒绝是 `false` 不是 `cancelled`** |
| `select` | ✅ | `{value: "<首项>"}`；拒绝用 `{cancelled: true}` |
| `notify` / `setWidget` / `setStatus` | ❌ | 启动时就来，不是审批 |
| `input` / `editor` | ❌ | 需要文本输入，`RequestApproval` 表达不了 |

`cancelled` 的语义是「用户关掉了弹窗、没做选择」，与「明确拒绝」是两种状态。
把 `confirm` 的拒绝写成 `cancelled` 会让 pi 侧语义偏移（pi-acp 的实现同样回
`confirmed: false`）。

### 9.3 回写 id 必须是 pi 发的那个

`extension_ui_response` 的 `id` 必须回携带 `extension_ui_request.id`。
`PiRpcProcess::send` 曾无条件覆盖 `id` —— 于是每条审批回写都带一个 pi 不认识的
uuid，工具卡在等回答上，表现为「点了允许没反应」。现在只在**缺省时**补 uuid。

### 9.4 slash 命令：`get_commands` 是权威来源，不要扫目录

原计划扫 `~/.pi/agent/prompts/**/*.md` + `<cwd>/.pi/prompts/`。实测 `get_commands`
返回 **157 条**（`source ∈ prompt / skill / extension`），扫目录只能看到 prompt
这一类（3 条），漏掉 skill 与 extension 共 154 条。

执行侧也不需要新命令：`prompt` 里带 `/name` 会被 pi 自己展开（实测触发）。

### 9.4b opencode 的命令列表：`/api/command`（`/api/*` 共享层）

opencode 走 `serve` 传输，命令列表来自 **`GET /api/command`**（实测 2.1.3）：

```jsonc
{"location":{"directory":"…"},
 "data":[{"name":"init","description":"guided AGENTS.md setup"},
         {"name":"trellis/start","description":"…"}]}
```

**两条已实测事实**：

| 事实 | 后果 |
| --- | --- |
| 无前缀的 `/command` 是 `200 text/html`（SPA 回落） | 按 `/command` 拼路径会拿到 HTML，当空列表处理 |
| 命令发现**异步完成**：同一 server 连续请求得到 `0 → 2 → 5` 条 | 查一次拿空就放弃 = 用户永远看到「无命令」 |

#### 1.x 的支持：按共享层实现，由运行时回答

**已实测（1.19.0，见 `10-20-opencode-2x-serve-dual-stack/research/opencode-2x-protocol.md`）**：
`/api/model`、`POST /api/session`、`GET /api/event` **两版共存**；只有 `/api/info`
是 v2 独有（正因如此它才是协议判据）。

**未实测**：`/api/command` 在 1.x 上没有一手取证（取证机只有 2.1.3）。

因此实现选择**共用路径** `/api/command`（同 `models_path` 的先例），而不是按协议
分叉成 `V1 => "/command"`（那是 SPA 回落，必然坏）。

> **判据（可推广）：「不确定某端点是否存在」不能用静态假设表达。**
> 猜 `None` 与猜 `Some` 一样错 —— 前者把功能藏起来（用户失去整个 `/` 入口），
> 后者把报错露出来。正确的是让它**降级成运行时探测**：真没有的版本在请求上
> 失败，由 `useAgentCommands` 的「失败 → 空数组、不打断输入」路径吸收。
>
> 这条是对早先「静态 `false` + 会话期 `capabilities_for(protocol)` 派生」那版
> 的修正：那版把**未取证**当成了**不支持**，代价是 1.x 用户完全没有 `/` 补全。

#### 实现要点

- `ServeProtocol::commands_path(self) -> &'static str` 恒返回 `/api/command`
  （保留 `self` 接收者只为让调用点统一写 `protocol.commands_path()`）
- `ServeAdapter::chat_capabilities().commands = true` —— 单一真值，不再有
  「静态声明 vs 会话期派生」两层
- **有界重试** 8 × 250ms（约 2s）覆盖异步发现；预算用尽仍空 → 空列表
  （真的没命令），端点不可用 → `Err`（让前端走失败降级，不是静默空）
- **必须带 `?directory=`**：项目级命令（`<project>/.opencode/commands/**`）只在
  请求带上项目根时才被纳入。前端 `projectPath` 经
  `list_agent_commands(agentId, directory)` → `list_commands(config, directory)`
  一路下传

**缓存键必须带 directory**：同一 agent 在不同项目下命令集不同，只按 agentId 缓存
会让 A 项目拿到 B 项目的命令（`useAgentCommands` 的 `commandKeyOf`）。

护栏：`opencode/tests.rs` 的 `commands_from_response_*` / `commands_url_*` /
`commands_path_is_shared_by_both_protocols`；`capability_probe.rs` 的契约测试断言
「位 true ⇒ 查询有覆写」（本机装了 opencode 时实测返回 `init` / `review`）。

### 9.5 会话恢复：`sessionId` 有，但文件要发过消息才落盘

`get_state.sessionId` 在握手时就有，可作为 `resume_id()` 返回给
`conversation/adapters/pi.rs::resume_command`（拼成 `pi --session <id>`）。

**边界**：空会话的 id 用 `--session` 启动会得到 `No session found matching '…'` ——
会话文件只在发过消息后写入。`resume_id` 因此是「保存用的句柄」而非立即可用的句柄；
对空会话立即恢复会失败，那是 `conversation` 域该加的防护。

#### 9.5.1 chat 侧恢复：能力位早就是 `true`，缺的是实现（2026-10-30 实测）

`ChatCapabilities.resume` 的契约是「`resume_id` 有真实值 **且** `resume` 可用」
（`capabilities.rs`）。pi 一侧早已两件齐一半：位声明 `true`、`resume_id()` 也实现了，
**但 `AgentAdapter::resume` / `supports_chat_resume` 都没覆写** ——
于是 `agent_chat_supports_resume("pi")` 返 `false`、`agent_chat_resume` 直接 `Err`，
而前端入口当时只看 conversation 侧 `meta.supportsResume`，用户得到的是一个死入口
（「按钮在、点了没反应」）。

一手实测（pi 已装，`pi --mode rpc --session <uuid>`）：

| 场景 | 结果 |
| --- | --- |
| id 存在 | `get_state.sessionId` **相同**、`messageCount: 55` ⇒ 可恢复，非能力缺失 |
| id 不存在 | 进程 **exit 1**，stderr `No session found matching '<id>'`，stdout 零响应 |

#### 9.5.2 两条实现在 `adapter.rs`，四个判据

```rust
extra_args(cmd, tail)           // cmd[1..] + tail —— 恢复参数拼在用户 args **之后**
ensure_bound_to(requested, actual)  // get_state.sessionId 必须等于请求的那个 id
spawn_process(ctx, tail)        // spawn 的唯一入口（create 传 &[]，resume 传 ["--session", id]）
supports_chat_resume() -> caps.resume   // 单一真相，不另写一份
```

**为什么 `--session` 必须排在用户 args 之后**：pi 对重复选项是**后写者胜**
（同 §4.0.5 的 `--mode` 实测）。用户在 `AgentConfig.chat.args` 里写了
`--session <别的 id>` 或 `-c` 时，若适配器的 `--session` 在前面，user args 会**静默
劫持恢复目标**：界面显示 A 会话历史，实际续写 B。

**为什么必须校验绑定**：`--session` 接受**部分 UUID**，匹配有歧义（0 或 1 个候选），
命中多个时 pi 可能取第一个。绑定错会话比失败更糟 —— 用户以为在续写原会话，实际在
污染另一条。校验用的是 pi 自己回报的 `get_state.sessionId`，**不自己扫
`~/.pi/agent/sessions/**` 预判存在性**（那会造出第二份真相，pi 改布局就静默走偏）。
校验失败要 `cancel()` 回收进程，别让一条绑错会话的进程活着。

恢复是**静默**的（`ctx.prompt` 空 → `start_with` 不发首轮，与 `create` 同一条路径）：
历史回放归 conversation 域，塞成 prompt 会双写 + 双倍 token + 污染原生会话。

#### 9.5.3 失败必须「快且可归因」（进程层两条修正）

旧实现把两个已有信号吞掉了，导致恢复失败要等满 `AUX_TIMEOUT`(5s) 且原因错误：

| 缺陷 | 修正 | 判据 |
| --- | --- | --- |
| `spawn` 丢弃 stderr（`_stderr`） | 后台按行累积**有界**尾部（2KB，`STDERR_TAIL_LIMIT`），`stderr_tail()` + `annotate(err)` | `append_stderr` 纯函数：空尾部原样返回，否则 `AppError::Agent("{err} — pi stderr: {tail}")` |
| 读循环结束只 `log::debug!` | 结束即 `ended = true` + `pending.clear()`（drop sender ⇒ 在途 `rx.await` 立刻 `Err`） | 文案 `pi rpc: process ended before responding`，不是超时 |

**`pending.clear()` 需要 `ended` 标志配合**，两者管的窗口不同（都保留，别只留一个）：

| 窗口 | 谁兜住 |
| --- | --- |
| 请求已注册 → 进程随后退出 | `pending.clear()` |
| 进程先退出 / `clear()` 已跑完 → 请求才注册 | `ended` 标志（`request` 写完后检查） |

后一个窗口是真实存在的：pi 在 `--session <不存在>` 上**瞬间** exit 1，握手第一条
请求可能落在 `clear()` 之后 —— 只做 `clear()` 时那条请求会等满 5s，报一句假的
「超时」（AC3 直接不达标）。

stderr 尾部只用于**装饰错误**，不进任何数据通道；`annotate` 只在
`PiSession::start_with` 的握手失败点调用（`handshake()` 抽成自由函数，装饰只写一次）。

**`annotate` 必须是有界等待（`async`）**：进程退出时 stdout 与 stderr **同时** EOF，
但两个读循环是两个独立 task，谁先被调度不确定。stdout 先 EOF 的瞬间取尾部会拿到空串
—— 错误信息**随机**丢掉真实原因，而保留 stderr 的全部目的就是让原因可见。
实现：尾部为空且 `ended` 已置位 → **同步**注册 `Notify`（`notified().enable()`）再查 `done`
→ 最多等 300ms 让 stderr 排空，再取一次尾部。

> 必须用 `enable()` 而不是只创建 future：**只创建不 poll 不算注册**，那时写入方的
> `notify_waiters()` 会打空 —— 尾部其实早写好了却白等满 300ms。写入方的顺序
> （先置 `done`、后 `notify`）+ 这里的「先注册、后查标志」两种交错都不丢唤醒。

护栏：`annotate_waits_for_stderr_to_settle_after_the_process_ends`（删掉等待即红；
构造上先让子任务跑到等待点才喂 stderr，**不用 sleep 赌调度顺序**）。

护栏：`extra_args` 顺序 / `ensure_bound_to` 三态 / `caps.resume ==
supports_chat_resume()` / 「位 true ⇒ `resume()` 非默认实现（不存在的二进制 → spawn 类
错误，而非 `does not support chat resume`）」/ `in_flight_request_fails_fast_…` /
`request_after_the_process_ended_fails_fast` / `append_stderr_*` / `tail_of` 字符边界 /
`stderr_tail_is_bounded` / `handshake_failure_carries_the_pi_stderr_tail`。

#### 9.5.4 进程生命周期 ⊆ 句柄生命周期（`Drop`，2026-10-30）

`PiRpcProcess` 有 `impl Drop` 调 `dispose()`。判据：**持有它的代码消失，子进程就该终止** ——
不靠调用点在每个 `?` 前记得清理。

- 缺陷形态：`PiSession::start_with` 按值拿走 `proc` 后握手 `?` 早退 → `proc` 被 drop，
  而当时没有 `Drop` 实现 ⇒ 每次恢复失败漏一个活着的 pi 进程（只在应用退出时由退出收敛表
  兜底）。`create` / `resume` / 未来的任何新校验路径同构 —— 所以修在类型上，不修在调用点。
- `dispose()` 的 kill **句柄是同步调用的**（`(self.kill_fn)()`）⇒「已请求终止」同步可观测，
  契约用例不必 sleep 赌调度；实际只杀一次由 `killed` 标志保证（`cancel()` 后再 drop 不二次杀）。
- 无 tokio runtime 时 `tokio::spawn` 会 panic（Drop 里 panic = abort），故 `dispose` 走
  `Handle::try_current()`，取不到只 `log::warn` 并交给退出收敛表 —— 留痕优先于静默。
- **反向护栏**（缺了就会「开关一次 tab 杀掉活会话」）：持有句柄期间不得终止。
  用例：`a_held_handle_does_not_kill_the_child_process` /
  `dropping_the_handle_kills_the_child_process` / `dispose_then_drop_kills_exactly_once` /
  `failed_handshake_reclaims_the_spawned_process`（会话层）。

**扩展性护栏**：`capability_probe::resume_contract` 里适配器清单必须是表
（`every_transport()`），并由 `every_transport_list_stays_in_sync_with_the_variant_list`
断言它与 `ChatTransport::ALL` **等长** —— 否则「新增第五条传输」时这条护栏会静默漏掉它，
而漏掉的表现恰好是静默降级。判据：**新增传输只要在枚举里加一个变体，本用例就必须红一次**，
逼作者把它接进表。

> 前端入口显隐**只能**读后端 `agent_chat_supports_resume`。按 agentId 白名单、或把
> conversation 侧 `meta.supportsResume` 当判据，都会造出死入口 —— 那是本节问题的原始形态。
>
> 两条必须分开的轴（2026-10-30 review 修正）：
>
> | 入口 | 判据 |
> | --- | --- |
> | Open in Agent Chat | 有 `nativeSessionId` **且** `agent_chat_supports_resume(agentId)` |
> | Resume（终端原生恢复） | conversation 侧 `meta.supportsResume`（CLI 能 `--resume`） |
>
> 把前者嵌进后者的 gate 是**另一端**的死入口：chat 适配器能重新绑定、但 CLI 没有
> `--resume` 的 agent（例如将来只经 ACP `session/load` 恢复的 CLI）会静默没有入口。
>
> 前端缓存（`chatResumeSupport.ts`）的键是 `agentId + 启动签名（chat / chat_enabled）`：
> 能力只对**同一份配置**静态，用户改完 chat 传输后同一个 id 的答案会变 —— 只按 id 缓存
> 会让入口显隐失真到重启。`useChatResumableAgents` 的依赖用同一份签名（数组身份变不重查、
> 配置变要重查）。

## 10. 新传输的会话配置检查清单（2026-08-24）

> 这一节是 `08-24-agent-config-unify` 的产物。它把「新接一个 agent 会把同一批坑
> 重踩一遍」这件事变可检查 —— 下面 5 条都是**实际发生过**的缺陷，不是假想。

### 10.1 能力位是唯一判据

`AgentAdapter::chat_capabilities()` 返回 `ChatCapabilities { config, approvals, commands, resume }`。

```rust
match caps.config {
    ConfigCapability::SessionConfig => { /* set_config_option + 全量回推 */ }
    ConfigCapability::PerTurn      => { /* 每轮请求参数，无回推 */ }
    ConfigCapability::None         => { /* 无会话配置 */ }
}
```

**强制规则**（每条都对应一次已发生的缺陷）：

1. **`SessionConfig` 是三条承诺的合取**：① 握手带 `config_options` ② 接受
   `SetConfigOption` 并真的下发 ③ 变更后产生 `ConfigOptionUpdate`（全量）。
   缺一条即违约 —— 声明 `true` 而握手不带配置项，前端的控件区会**永远空白**。
2. **`SessionStart.capabilities` 必须由 `chat_capabilities()` 派生**
   （`Capabilities::from_chat_capabilities`），不得在手写的事件构造里逐字段填。
   历史上四个 adapter 全填 `approvals: true`，包括 `deepseek`（495 行里没有
   任何审批实现）—— 前端因此给它渲染了审批面板，而 agent 永远不发
   `RequestApproval`。
3. **默认值不存在**。`chat_capabilities()` 没有默认实现：新增 adapter 必须表态，
   新增**能力字段**时所有既有 adapter 的构造点编译失败。
4. **`commands` 位与 `list_commands` 实现是一回事**（`10-21-mention-slash-palette`）：
   「能不能弹 `/`」由位判定（前端能力位 false 时连 `list_agent_commands` 查询都不发），
   查询本身只承担取数据；PiRpcAdapter 覆写 `list_commands`（短暂 spawn rpc 进程查
   `get_commands` 即弃，spec §9.4）。声明与实现的一致性由
   `capability_probe.rs::commands_contract` 双向钉住 —— 位 false ⇔ 查询返回
   `Unsupported`；位 true ⇔ 有真实现（用不存在二进制验证覆写存在，CI 不起真进程）。
   ACP 的 `available_commands_update` 是**会话内**推送通告，不是会话外查询，
   故 ACP 维持 false；若要接属会话内增量。
5. **`resume` 位与 `resume()` / `supports_chat_resume()` 是一回事**
   （`10-30-pi-chat-resume`，spec §9.5）：位为 `true` ⇒ 必须覆写两个方法，且
   `supports_chat_resume()` 直接返回 `chat_capabilities().resume`（不另写一份）。
   前端入口显隐的唯一数据源是 `agent_chat_supports_resume`（它读
   `supports_chat_resume()`）—— 按 agentId 白名单、只看 conversation 侧
   `meta.supportsResume`、或把后者当前者的外层 gate，都会造出死入口（§10.1 与 §9.5.3
   的两轴表）。一致性由
   `capability_probe.rs::resume_contract` 钉住（四条传输位 ↔ 方法相等 + 位 true ⇒
   非默认实现，用不存在二进制验证，CI 不起真进程）。

### 10.2 五个已知断点与对应护栏

每一条都在 `10-21-pi-rpc-adapter` 里真实发生过，表现都是「看起来实现了、实际没接上」。
**只有静态护栏或真实日志能抓住它们** —— 组件测试全绿也不代表链路通了。

| # | 断点 | 为什么单元测试抓不到 | 护栏 |
| --- | --- | --- | --- |
| 1 | `SessionStart` 不带 `config_options` | 纯函数测了投影，没测「真的推给前端没有」 | `capability_probe::mock_agent_satisfies_its_own_declaration` |
| 2 | `request_channel()` 返回 `None` → 会话从未注册 | 测了 `session.send`，没测 manager 路由 | `exposes_a_request_channel_so_turns_can_be_routed` |
| 3 | `ctx.prompt` 从未被消费 → 首轮消息丢失 | 测了 `send(Turn)`，绕过了 `create` | `create_sends_the_first_prompt_from_the_context` |
| 4 | 静默会话的暂存事件从未被应用 | 两条路径各自实现，只测了其中一条 | `should drain buffered events after the silent session is opened` |
| 5 | 点选模型只改本地 state → 档位不刷新 | 没有「写路径必须下发」的判据 | `should wire the composer to the pushing handler` + `sessionOptionsWiring.test.ts` |
| 6 | 分派/识别规则改了一处而漏另一处 | 各处的表项各自合法，只有「两端一致」时才错 | `every_transport_variant_has_a_rule` / `…has_a_build` / `transports.test.ts` 的 id 序列 |

> 断点 6 是 `10-23-agent-chat-registry` 新增的一类：**它不是「没实现」，而是「实现散在多处」**。
> 收敛成两张表 + 一条跨栈 `id` 序列断言后，漏登一处必然红。

### 10.3 契约探针：声明 vs 行为

`agent/chat/capability_probe.rs::assert_capabilities_hold(adapter, ctx)` 建一个**真会话**，
观察 `SessionStart` 到底带了什么。这是唯一能验证「声明 == 行为」的手段
（照搬根 `AGENTS.md` 红线 14 的判据）。

**MockAgent 优先**（本设计的核心策略）：

- MockAgent 是**进程内**的 ACP 实现，反馈周期毫秒级；真实 adapter 需要外部进程，
  分钟级。
- 契约先在 MockAgent 上改到对，再拿去校验真实 adapter —— 那时失败的一定是
  adapter 而不是契约本身。
- MockAgent 必须**刻意比现实更严格**：模型项 `id` 不叫 `"model"`（钉住按
  `category` 定位）、响应必须全量、`set_config_option` 对未知 id 报错。

### 10.4 前端三态，不是二态

```ts
type SessionConfigPhase = 'unsupported' | 'loading' | 'ready';
```

**「会话未建立」不能渲染成「不支持」**：前者该显示加载态/禁用，后者该隐藏控件。
`useSessionConfigOptions` 的初值是 `loading`，`reset()` 回到 `loading` 而非
`unsupported` —— 否则切换 agent 时控件会先消失再出现。

**模型选择器的判据与配置类控件不同**：

| 控件 | 判据 | 理由 |
| --- | --- | --- |
| 模型选择器 | `capability !== 'none'` | `per_turn`（serve）走每轮请求参数，模型选择仍有意义 |
| 模式 / 档位 / model_config | `supported && phase === 'ready'` | 这些只能走 `set_config_option` |

压成一个布尔会让「serve 能选模型但不能改档位」这个事实无法表达。

### 10.5 禁止的写法

```rust
// ❌ 手填派生字段 —— 两份真相必然漂移
capabilities: Capabilities { approvals: true, command_echo: false, diff: false, resume: true }
```

```tsx
// ❌ 凭数据非空推断能力 —— 无法区分「不支持」与「会话未建立」
{mode && <AgentModeSelector />}
```

```rust
// ❌ 静默吞掉不支持的请求 —— 调用方无法区分「已处理」与「没实现」
_ => Ok(Vec::new())
```

**判据**：控件的可见性必须能追溯到一个能力位；写路径被拒绝时必须有一个测试
说明为什么拒绝（而不是 `if (configId)` 恰好为空）。

### 10.5b 模型列表的权威来源是 agent 协议，不是我们 spawn 的二进制

`model_list_args`（`pi --list-models` 那类）是**我们自己解析表格**得到的列表，
它的 `id` 形状与协议给的**不一致**：

| 来源 | `id` 形状 | 能否直接喂给 `set_config_option` |
| --- | --- | --- |
| `model_list_args`（CLI 表格） | `provider/model`（如 `cline/cohere/north-mini-code:free`） | **否** —— agent 会拒绝 |
| rpc `get_available_models` / ACP `configOptions` | 裸名（`deepseek-flash`） | 是 |

两条来源并存必然漂移。2026-08-24 实测：Pi 同时声明了 `--list-models`，
用户在会话建立前看到的是 `provider/model` 复合串，点选后 `set_model` 报
`Model not found: provider/provider/model`。

**规则**：声明了会话内模型能力的 transport（`ConfigCapability::SessionConfig`）
**不得**再声明 `model_list_args`。模型列表只在会话内取（`SessionScoped`），
会话一建立就由握手填充 —— 静默会话（`agent_chat_open`）让这几乎无延迟。

### 10.5c 互斥判据是 `SessionConfig`，**不是** `shows_controls()`

上面那条「不得并存」的规则**只对 `SessionConfig` 成立**，两个方向不对称：

| 能力 | 会话外目录 id 形状 | CLI 目录能否共存 |
| --- | --- | --- |
| `SessionConfig`（ACP / Pi） | 裸名 | **否** —— 复合串会被 `set_config_option` 拒绝 |
| `PerTurn`（opencode serve） | `provider/model` | **是** —— `model_slug_split` 就按这个形状拆 |

`supports_model_selection()` 是 `shows_controls()`，`PerTurn` 也为真。拿它当互斥
门控会把 serve 的 `models --verbose` 快速路径一并关掉，而 serve 又不是
`SessionConfig` —— 两条路径全被封，**`PerTurn` 传输的模型列表恒空**。

正确门控是 `supports_session_config()`（`uses_session_config()`）。护栏
`session_model_capability_overrides_the_cli_bypass` 断言判据字面值，
`out_of_session_catalog_goes_through_the_adapter` 断言目录经 adapter 取。

### 10.5d 会话外目录的唯一入口是 `AgentAdapter::list_models`

它是**可覆盖**的方法，所以「这个 transport 有没有会话外目录」是局部决策：
solve 覆盖它（`models --verbose`），ACP / Pi 用默认（退到 `model_list_args`）。

2026-10-22 事故：`list_agent_models` 绕过 adapter 直接读 `config.model_list_args`，
后果是双向的：

1. `AgentAdapter::list_models` 与 `ServeAdapter` 的覆盖一起变成**死代码**；
2. opencode 的快速路径（`model_list_args` 为 `None`）永远走不到 —— 模型列表恒空。

**错误分两类，处理不同**：`Err(AppError::Unsupported(_))` = 「我没有会话外目录」
（合法答案，继续走下一步）；其他 `Err` = 命令真的执行失败（**必须上抛**，否则
用户把「装坏了」看成「本来就没有模型」）。

`model_list_args` 仍然保留为**用户可自定义**字段（`AgentForm` 有输入框），
供确实没有协议级模型接口的第三方 CLI 使用。

**裁决必须在消费点做，不能只靠内置定义不填。** 原因：
`~/.neeko/config.json` 的 `agentOverrides` 是用户编辑时的**整份快照**
（`AgentConfig` 多数字段非 `Option`，序列化后丢失 presence，「没设置」与
「设为空」不可区分，所以无法做字段级合并）。内置定义改过之后，旧快照仍会把
`--list-models` 带回来 —— 2026-08-24 实测用户机器上正是如此：Pi 的覆盖里存着
`["--list-models"]`，模型列表又变回 `cline/cohere/north-mini-code:free` 复合串，
点选写不进去。

因此 `list_agent_models` 先算 `session_scoped = adapter.supports_model_selection()`，
**只有 `!session_scoped` 时才尝试 CLI 旁路**。用户的真实自定义（改 command / args /
icon 等）照旧生效，「有没有 CLI 旁路」由能力位说了算。

护栏：`transports_with_session_models_do_not_declare_a_cli_bypass`（内置定义不填）
+ `session_model_capability_overrides_the_cli_bypass`（消费点裁决顺序
`scoped < guarded < cmd`）。两条都做过变异验证。

> **2026-10-23 更新**：上面提到的「用户旧快照仍会把 `--list-models` 带回来」这个
> 隐患，其**前端成因已消除** —— 前端不再持有 `agentOverrides` 的配置副本（只留键
> 集合给 Reset 按钮判断），生效配置一律读 `agentStore`（后端合并后的结果）。见
> `.trellis/spec/frontend/state-management.md`「Agent 配置单源化」。
>
> 同理，表单现在会在 `transport ∈ {acp, pi-rpc}`（`SessionConfig`）时**隐藏**
> `List Models Args` 输入框并给出说明 —— 用户不再有机会填出那个冲突。
> 护栏：`AgentForm.modelListGate.test.tsx`（4 条，含「serve 必须保留」的反例）。

### 10.6 静态护栏只能防「整段删除」，防不住「条件被短路」

第一版的能力位护栏读源码做字符串匹配（`expect(CHAT).toContain('configWritable')`）。
变异验证把定义改成 `const configWritable = true` 后**8 条断言全绿** —— 名字还在，
门控已经没了。

**结论**：涉及「某条件必须成立才渲染」的护栏，必须**渲染组件并断言 DOM**，
不能只断言源码里出现过某个标识符。参照
`components/__tests__/ComposerCapabilityGate.test.tsx`（3 条，3/3 变异全抓）。

补充一条同类陷阱：判据选错会让变异漏抓。第一版用「agent 名文案」判断模型
选择器是否存在，而旁边的 agent 切换器渲染同一个名字 → 变异漏抓。改用
`queryByTitle('Select model')`（只有 `ModelPicker` 有这个 title）后才有效。

---

## 11. opencode serve 的双栈：同一份代码支持 1.x 与 2.x

> 一手证据：`.trellis/tasks/10-20-opencode-2x-serve-dual-stack/research/opencode-2x-protocol.md`
> 实现：`src-tauri/src/agent/chat/adapter/opencode/`

opencode 2.0 重写了 serve 的握手与 HTTP/SSE 协议。这不是"新增了几个端点"，
而是**四层同时变了**（就绪行 / 鉴权 / 端点 / 事件面）。

### 11.1 分派依据必须是能力，不是版本号

```
GET /api/info  →  200 application/json  ⇒ V2
               →  200 text/html         ⇒ V1
               →  其它 / 连接失败        ⇒ V1
```

**为什么不能用版本号字符串**：`1.19.0` 与 `opencode v2.0.32` 格式不同，且
1.18–1.20 的小版本没穷举。

**为什么必须看 Content-Type 而不是状态码**：1.19 对 `/api/info` 也返回 **200**
（未匹配路由回落 SPA `index.html`）。只看状态码会把 1.x 判成 2.x，此后所有
`/api/*` 请求都打在 SPA 上，得到「200 + HTML」的**假成功**。

护栏：`detect_protocol_uses_content_type_not_status`。变异（只看状态码）确认变红。

### 11.2 就绪握手：前缀不参与匹配 + 主动注入密码

```
1.19:  opencode server listening on http://127.0.0.1:4605
2.0 :  server listening on http://127.0.0.1:60656          ← 无 opencode 前缀
```

判据是 **`"listening on "` + `starts_with("http")`**，前缀不参与匹配 ——
未来任何前缀变化都不该再打断就绪检测，而 URL 形态才是这条输出的语义本体。

**鉴权改为主动注入**：spawn 时设 `OPENCODE_SERVER_PASSWORD=<Neeko 生成的 uuid>`。

| 注入与否 | 1.19 | 2.0 |
| --- | --- | --- |
| 未注入 | 警告 `server is unsecured` | **强制** Basic 认证 + 打印随机 `server password` 行 |
| 注入后 | 要求 Basic（用户名必须 `opencode`） | 要求 Basic，且不再打印密码行 |

恒带 Basic 头：认 env 的版本据此通过，不认的版本忽略该头（无副作用）。
`extract_server_password` 只作为「注入未生效」时的兜底。

护栏：`extract_listening_url_accepts_both_prefixes` / `base64_encodes_basic_credentials`
（RFC 4648 向量）。变异（改回带前缀的 MARKER）确认变红。

### 11.3 端点表：差异只有一个来源

`ServeProtocol` 是**唯一**分派点，其余方法都基于 `prefix()`（`""` / `"/api"`）。

| 能力 | V1 | V2 |
| --- | --- | --- |
| 建会话 | `POST /session?directory=` | `POST /api/session`（目录在 body） |
| 发 prompt | `.../prompt_async` | `.../prompt` |
| 切模型 | 无（per-prompt 参数） | `POST /api/session/{id}/model` |
| 中止 | `.../abort` | `.../interrupt` |
| 权限回执 | `/session/{id}/permissions/{rid}` | `/api/session/{id}/permission/{rid}/reply` |
| 提问回执 | `/question/{rid}/reply?directory=` | `/api/session/{id}/form/{fid}/reply` |
| SSE | `/event?directory=` | `/api/event`（**不接受** query） |
| 模型列表 | **`/api/model`** | `/api/model` |

### 11.4 四个「200 但什么都没做」的陷阱

这四条都不会报错，只能靠回读或断言发现。它们是本任务的主要风险来源。

| 陷阱 | 后果 | 发现方式 |
| --- | --- | --- |
| 2.0 忽略 `?directory=` | 会话落到 serve cwd，工具在错误目录跑 | 建会话后 `GET /api/session/{id}` 校验 `location.directory` |
| 2.0 静默丢弃 `permission` 字段 | **confirm 模式变 auto**，无人审批就改文件 | 回读 `permissions` 非空 |
| 2.0 静默忽略 prompt 里的 `model` | 切模型不生效（用户以为换了） | 切模型必须先走 `/model` 端点 |
| 2.0 移除 `models --verbose` | 模型列表**为空** + 刷 ERROR | 回落参数按协议选：V2 只传 `models` |

`verify_v2_session`（`adapter.rs`）在建会话后强制回读这两项，失败 WARN 不阻断
（用户至少能对话，但故障不再无声）。

### 11.5 事件面：两套模块，一个出口

`events_v1.rs` / `events_v2.rs` 各自翻译，都产出同一份 `StreamEvent`。
**前端协议零改动**。

| 方面 | V1 | V2 |
| --- | --- | --- |
| 载荷位置 | `properties` | `data` |
| 流式载体 | `message.part.delta` + `part_kinds` 反查类型 | `session.text.delta` / `session.reasoning.delta`（**类型在事件名里**） |
| 工具 | 一个 `part` 的 `state.status` 状态机 | `input.started` → `called` → `success`/`failed`（三个独立事件） |
| 回合结束 | `session.idle` | `session.execution.{succeeded,failed,interrupted}` |
| 提问 | `question.asked` | `form.created` + `metadata.kind=="question"` |
| todo | `todo.updated` | **没有** ⇒ 永不产生 `TodoUpdated` |

**包络归一化**：`ServeEvent.properties` 用 `#[serde(alias = "data")]` 承接 V2 的
`data`。归一化放在反序列化层，翻译器与泵循环就不需要知道自己在读哪个版本。

**V2 需要 `tool_names` 缓存**：`session.tool.called` 只带 `id` + `input`，
名字在前一个事件 `session.tool.input.started` 里。

**禁止伪造 `TodoUpdated`**：2.0 已无该事件。前端 `TodoListCard` 自然空着是
诚实降级；用 tool 事件拼一份 todo 快照会让用户看到一个永不更新的假计划。

### 11.6 共享而不是各写一份

| 共享点 | 位置 | 理由 |
| --- | --- | --- |
| 工具标题渲染 | `tool_title.rs` | 「bash 显示命令 / read 显示路径 / task 显示 `Type Task: desc`」与协议无关；两版用户看到同一张卡片 |
| 端点选择 | `protocol.rs` | 差异只允许一个来源 |
| `Translator` | `pump.rs` | 把「协议分派 + 各自的状态」收进一个类型，泵循环只与它对话 |
| `PumpTarget` | `pump.rs` | 五个定位参数总是一起出现；合成一个类型后「漏传」在类型层不可能 |

### 11.7 禁止模式

- ❌ 解析 `opencode --version` 做分支（格式两版不同，小版本未穷举）
- ❌ 「`/api/*` 能通」当 v2 判据（1.19 已实现部分 v2 路由）
- ❌ 只看状态码判协议（1.19 的 `/api/info` 也是 200）
- ❌ 按 `prefix()` 拼模型列表路径（两版都是 `/api/model`，V1 拼成 `/model` 会拿到 HTML）
- ❌ 在 V2 上传 `models --verbose`（必失败）
- ❌ 用 tool 事件伪造 todo 快照

### 11.8 验收实测（2026-10-23，双二进制）

用真 `opencode serve` 跑完整链路，1.19.0 与 2.0.32 各一次：

| AC | 1.19.0 | 2.0.32 |
| --- | --- | --- |
| 就绪解析 | PASS | PASS（无前缀） |
| 鉴权 | PASS | PASS |
| 协议探测 | → V1（`text/html`） | → V2（`application/json`） |
| 建会话 | PASS | PASS + `directory` 匹配 + `permissions` 非空 |
| 模型列表 | 206 条 | 167 条 |
| 切模型 | per-prompt | PASS（`204`；`modelID` 反证 `400`） |
| 中止 | `/abort` 200 | `/interrupt` 200 |
| resume 不存在 | 404 | 404 |

> **文本流未端到端验证**：本机所有 provider 的 API key 已过期
> （`api_key_expired`），`session.step.failed` 是唯一能拿到的下游结果。
> 失败路径的翻译有真实抓包样本锁定
> （`real_v2_failure_envelope_maps_to_error_turn_end`），成功路径（text/tool/execution.succeeded）
> 目前只有 schema 级单测。**换可用 key 后需复验 AC5/AC6/AC7。**
