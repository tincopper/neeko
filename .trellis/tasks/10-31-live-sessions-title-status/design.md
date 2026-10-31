# 设计：会话标题与状态从视图上移到 live-sessions 注册表

## 0. 判据

| 问题 | 唯一合法答案 |
| --- | --- |
| 这个会话现在什么状态？ | 后端注册表的 `SessionState`。视图**不得**推断 |
| 这个会话叫什么？ | 由 `title::pick` 从「来源候选」里取最强的一个；不落 tab state |
| 这个会话属于哪个单元？ | `WorkspaceSession` + `UnitScope`（最深根胜出），禁止字符串前缀 |
| 侧栏凭什么存在没打开的会话？ | 注册表快照 —— 不是打开的 tab |

## 1. 分层

```
真实            进程（chat adapter 子进程 / PTY）+ 地址（WorkspaceSession）
  │  信号（唯一写者 = 事件层）
  ▼
L1 注册表       live_sessions::Registry（内存唯一事实，写穿 SessionStore）
  │    ├─ state.rs   纯转移 reduce(state, Signal)
  │    ├─ title.rs   纯优先级 pick/truncate/should_upgrade
  │    └─ wiring/{chat,pty}.rs  原生信号 → Signal
  ▼
L2 快照接口     list_live_sessions(workspace?) + wait_live_sessions(since, timeout)
  │             + SESSIONS_EVENT（版本号变化通知，前端再拉）
  ▼
L3 前端         useLiveSessionsStore（只存取）+ sessionSelectors（纯派生）
  ├── TabItem 标题     ← resolveTabTitle(tab, session)
  ├── 侧栏单元图标     ← dominantState(sessionsOfUnit(key))
  └── 侧栏单元子列表   ← <SessionList sessions={…} />
```

**被否决的方案**：从打开的 tab 派生一切。隐藏 tab 不更新、关掉的会话消失、CLI 会话无标题、
排序按窗口而非事实 —— 它能通过截图验收，但保不住 R1 的不变量，且正是当前缺陷的成因。

## 2. 数据形状（`live_sessions/entry.rs`）

```rust
pub enum SessionKind { Chat, Terminal }          // 新增种类 = 加 variant + 一个 wiring
pub enum SessionState { Ready, Running, AwaitingApproval, Failed, Stopped }
pub enum TitleSource { Placeholder, Prompt, Native, User }   // Order = 质量顺序

pub struct SessionEntry {
    pub session_id: String,        // 后端铸造（uuid）
    pub kind: SessionKind,
    pub agent_id: Option<String>,  // terminal 纯 shell 时为 None
    pub workspace: WorkspaceSession,  // 红线 12：地址是唯一身份
    pub state: SessionState,
    pub title: String,
    pub title_source: TitleSource,
    pub started_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub turn_count: u32,
}
```

Wire DTO（`view.rs`）只暴露可序列化字段：`session_id / kind / agent_id / workspace_key /
title / title_source / state / started_at / updated_at / turn_count`。
`workspace_key` 与 git / file 事件同形（`WorkspaceSession::key`），前端经
`WorkspaceSession.fromKeyOrId` 唯一 codec 取分量。

## 3. 状态转移表（`state.rs`，纯函数）

信号：`Created | TurnStarted | TurnFinished | ApprovalRequested | ApprovalResolved | Failed |
Stopped | Exited | Closed`

| 当前 \ 信号 | Created | TurnStarted | TurnFinished | Approval* | Failed | Stopped | Exited | Closed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ready | Ready | Running | Ready | ApprovalRequested→Awaiting | Failed | Stopped | Stopped | Stopped |
| Running | Running | Running | Ready | ApprovalRequested→Awaiting | Failed | Stopped | Stopped | Stopped |
| AwaitingApproval | — | Running | Ready | Resolved→Running | Failed | Stopped | Stopped | Stopped |
| Failed / Stopped | **全部 None（不复活）** |

两条硬规则：
1. `Failed` / `Stopped` 吸收一切迟到信号（pi 实测：`Error` 之后还有 `TurnEnd`，不能把失败改写成 Ready）。
2. `Ready` 收到 `ApprovalRequested` 必须先走 `AwaitingApproval`；`ApprovalResolved` 在 `Ready` 下是
   噪声（用户误点/迟到），返回 `None`。

## 4. 标题优先级（`title.rs`，纯函数）

| 来源 | 何时可得 | 素材 |
| --- | --- | --- |
| `User` | 用户改名 | tab 改名（本期不做入口，但优先级先占位） |
| `Native` | 恢复会话 / 落盘后扫描 / OSC 标题 | `StreamRequest.topic`；`ConversationMeta.title`；`term.onTitleChange` |
| `Prompt` | chat 首轮 | `StreamRequest.prompt` 截断 |
| `Placeholder` | 创建即知 | `agent.name`（terminal 无 agent ⇒ `Terminal`） |

`should_upgrade(current, incoming) = incoming >= current`（**同级允许覆盖**：同一来源可能有更完整的值）。
截断按 `chars()`（中文不切半个字）；空白折叠后为空视为无候选。

## 5. IPC 策略（红线 4 / 5）

- 命令只两条：`list_live_sessions(workspace: Option<WorkspaceSession>)`、
  `wait_live_sessions(since: u64, timeout_ms: Option<u64>)`。
- **不推送全量**：状态变只 emit `SESSIONS_EVENT`（载荷 = 版本号）；前端凭版本号拉快照。
  复用 `terminal_drain_wait` 已证明的模式（macOS WebKit 上推送 = 每次 `evaluateJavaScript` 克隆，
  RSS 只增不减）。
- 载荷规模：100 条会话 × ~200B ≈ 20KB，远低于 2MB；若将来破 1MB 再按单元分页（不预做）。
- 事件名常量：Rust `live_sessions::events::SESSIONS_EVENT` + 前端 `shared/events.ts` 同值，
  跨栈一致性用例照 `shared/types/__tests__/transports.test.ts` 的「两端有序序列相等」写法。

## 6. 关键决定与理由

- **不复用 `SessionStatus`**：它是持久化词表（`Closed` 而不是 `Failed/Stopped`，且被 DB 的
  `status TEXT` 列语义绑住）。运行时词表与持久化词表用单向 `From` 投影；共用枚举会导致
  「加一个 UI 状态 ⇒ 改数据库语义」。
- **状态写者上移到 `spawn_session_pipeline`**：那里已经是「会话注册 / 事件批量 emit（16ms 合帧）/
  通知投影 / 结束注销」的唯一汇聚处（`agent/chat/commands.rs:359-430`）。在此加一次
  `wiring::chat::observe(&registry, sid, &seq_evs)`，与 `notify::project` 并列 —— 零新管道、
  零额外 IPC（注册表只 bump 版本号）。
- **PTY 的 agent 身份是显式字段**：`create_terminal_session(agent_id)` 而不是从 `command` 串推断
  （同 `ChatLaunch::inprocess` 的教训：推断会覆盖它本不覆盖的情况）。
- **`TerminalTabData.status` 删除**：它是「视图持有事实副本」的活标本（写了一次、无人读）。
  状态改由注册表提供，视图只渲染。
- **不做静默推断**：terminal 只要进程活着就是 `Running`；chat 的空闲由 `TurnEnd` 精确给出。
- **标题不写回 tab**：标题会升级（prompt → native），写回就需要「谁记得再改一次」；
  渲染期派生保一份真相。tab 自带的 `title` 只作为「创建期兜底 / 用户改名」。

## 7. 复用清单

| 复用 | 用途 |
| --- | --- |
| `AgentChatManager::register/unregister`（既有） | 仍是 chat 会话的存活登记；注册表在其旁共存（不合并：PTY 也要登记） |
| `SessionStore` + `ResumeCursor` + `SessionStatus` | 写穿持久化与重启恢复词表（`ResumeCursor::from_entry` 单一投影） |
| `AGENT_CHAT_EVENT` / `StreamEvent` | chat 信号源，不新增协议 |
| `UnitScope` / `WorkspaceSession::key` | 分组与 wire 身份 |
| `terminal_drain_wait` 的 credit-pull | 快照拉取 |
| `SessionRow` / `SessionChips` / `ProjectGitSection` / `WorktreeRowList` | 侧栏行与装配（加 `status` / `children` 两个可选 prop，不分叉） |
| `unitDisplayName` / `envLabelOf` / `getFileName` | 单元名派生 |
| `notify::is_session_terminal`（既有） | 「什么算会话终止」的既有判据，注册表复用同一函数 |

## 8. 风险与处置

| 风险 | 处置 |
| --- | --- |
| 状态抖动刷 IPC | 只在状态真变时 bump；前端长轮询 + 版本比较；前端 store 丢弃乱序回包 |
| 崩溃/重启留下幽灵会话 | 启动时把持久化的非 Closed 会话标为 `Stopped`（可从 History 恢复），不做 pid 探测（不可靠） |
| 注册表锁与事件泵互相反压 | 锁内只做 map 操作与克隆；落盘在锁外 best-effort（失败只 warn） |
| terminal 全程 `Running` 看起来"卡住" | UI 用「最近活动相对时间」表达（`updated_at`），不伪造 Idle |
| 侧栏会话行数量爆炸 | 单元行默认折叠，展开才渲染；每单元最多渲染 20 条 + 「查看全部」进 Conversations 面板 |

## 9. 护栏与验证

- 静态：`SessionState` 的赋值只允许出现在 `live_sessions/`（同 `check_workspace_session_addressing`
  判据 F 的形态，可加判据 H）；地址分组走 `resolve_unit_scope`（既有判据 A2/D 覆盖）。
- 跨栈：`SESSIONS_EVENT` 双端常量一致性用例。
- 动态：`cargo test --lib` + `pnpm check:quick`；真机 AC8。

## 10. 原型（可执行契约）：`prototype.html`

同目录 [`prototype.html`](./prototype.html) 是本设计的**可视化契约**（单文件、零依赖，浏览器直接打开）。
它不画"想象图"，而是**执行与实现同一张转移表**：

- 左列 = 今天的形态（tab 标题恒定 `Agent Chat` / `Claude Code`、侧栏只有单元行、图标静态）；
- 右列 = 方案形态（单元角标 + 会话子列表 + 派生标题）；
- 下方「信号」按钮直接调 `reduce(state, signal)`：非法/迟到信号在原型里也**被丢弃**，
  并在日志里说明原因 —— 与 `state.rs` 的终止吸收行（R1.3）同一条规则；
- 「标题升级」按钮演示 `placeholder → prompt → native → user` 单向升级，反向被
  `should_upgrade` 拒绝。

原型承诺的视觉不变量（实施时逐条对齐，不靠"看着像"）：

| 不变量 | 原型里的位置 |
| --- | --- |
| 会话行图标 = 该会话的 **agent 品牌图标**（不是 kind 图标）；纯 shell / 未知 agent 回落 `cli.svg` | 侧栏会话行 `.s-agent-icon` |
| 状态 → 视觉只有一张表（5 个状态各有确定形态） | 底部「状态 → 视觉」+ 全站 `.dot` |
| 单元角标 = 多会话里最需要注意的一个；无会话不画点 | `multi-agent`（awaitingApproval）vs `dsh-neeko`（stopped） |
| 标题来源**不进 UI**：placeholder 只用斜体 + 次级灰表达「没有真标题」 | 会话行 `.s-title.is-placeholder` |
| tab 标题 = 注册表标题，不再有常量 | 右列 tab 栏 3 个标题 |
| 三处投影同源：改状态 → 会话行 + tab 点 + 单元角标一起变 | 点「TurnStart / RequestApproval / Stop」观察 |

**图标口径（2026-10-31）**：会话行画的是**该会话的 agent 图标**，复用前端既有的
`shared/utils/agents.ts::getAgentIconSrc`（键 = `AgentConfig.icon` 文件名）与
`DEFAULT_AGENT_ICON = 'cli.svg'` 兜底；原型为保持单文件，把这些资源内联成 data URI，
**键与资源逐字对应**（`pi` / `opencode` / `claude-code` / `codex`）。单元行（local / worktree）
仍用结构图标 —— 单元不是 agent，没有品牌可言。

**标题来源（`TitleSource`）是内部事实，不是 UI 元素**（2026-10-31 按评审去掉行内 `U/N/P/·` 徽标）：
它决定「谁能覆盖谁」，由 `title::should_upgrade` 单独消费；界面只表达结果（有真标题 / 占位斜体）。
想再把它显示出来时，先回答「它帮用户做什么决定」，否则不给像素。

色值取自 `src/styles/themes/dark.css`（oklch），尺寸取自 `base/variables.css`
（`--sidebar-width: 280px` / `--font-size: 12px`），因此**原型与真机同色同密度**。

