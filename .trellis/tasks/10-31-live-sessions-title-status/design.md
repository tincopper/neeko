# 设计：会话标题与状态从视图上移到 live-sessions 注册表

## 0. 判据

| 问题 | 唯一合法答案 |
| --- | --- |
| 这个会话现在什么状态？ | 后端注册表的 `SessionState`。视图**不得**推断 |
| 这个会话叫什么？ | 由 `title::admit`（什么不配）+ `title::should_upgrade`（谁能覆盖谁）裁决，**唯一写路径** `upgrade_title`；不落 tab state |
| 这个会话属于哪个单元？ | `WorkspaceSession` + `UnitScope`（最深根胜出），禁止字符串前缀 |
| 侧栏凭什么存在没打开的会话？ | 注册表快照 —— 不是打开的 tab |

## 1. 分层

```
真实            进程（chat adapter 子进程 / PTY）+ 地址（WorkspaceSession）
  │  信号（唯一写者 = 事件层）
  ▼
L1 注册表       live_sessions::Registry（内存唯一事实，写穿 SessionStore）
  │    ├─ state.rs   纯转移 reduce(state, Signal)
  │    ├─ title/     判据模块：judge（admit + 覆盖序）/ text / prompt / native
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

## 4. 标题优先级（`title/` 模块，纯函数）

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

## 11. 标题准入判据（`admit`）：从「提取」改为「拒绝」

> 对标：orca 的侧栏会话标题（`agent-row-conversation-name.ts`）走的是「候选 → 判负 → 回落」，
> 不是「候选 → 提取」。本文只吸收**判据形状**，不吸收它的来源清单（orca 的 provider 标题扫描
> 对应本任务 §8.2 已决定不做的部分）。

### 11.1 第一性原理

标题的**唯一职能**是「让用户在侧栏 / tab 栏认出这条会话」。四条公理：

1. **价值 = 检索效率**，不是描述完整性 ⇒ 「短而准」优于「长而全」（`MAX_TITLE_CHARS = 80` 已落地）。
2. **语义浓缩只能发生在源头**（provider 自己命名 / 用户自述），客户端只能**清理**不能**摘要** ——
   这是本 PRD 既有原则，也是「不推断」的直接推论。
3. 所有候选来源都是**别人产出的、带噪声的** ⇒ 客户端唯一能做的事是**拒绝**，不是**生成**。
   于是标题系统的核心签名是 `admit(...) -> Option<T>`，而不是 `extract(...) -> String`。
4. **拒绝必须发生在唯一写路径上。**

第 4 条推到底，得到本节的第一条硬约束：

> **只要还存在第二条写路径，`admit` 就必然有第二个调用点。**

当前 `SessionEntry::new(title)` 正是那第二条路径：`registry.rs:86` 的 `register_if_absent`
直接把 `title::pick` 的成品塞进条目，**完全绕过 `upgrade_title`**。所以**落地顺序不能反过来**：
先收敛写路径（11.3），再加判据（11.4）。反过来做，结果是把「两份判据」变成「三份」——
而那正是这次要修的病本身。

**判据 vs 优化**（本节反复用到的一条分类）：

> **移除这一层，行为不变、只是变慢 ⇒ 它是优化；移除后出错 ⇒ 它是判据。**

11.3 / 11.4 / 11.5 / 11.6 是判据；11.7 是优化。混淆两者会让后来者以为删掉优化层会出错。

### 11.2 为什么这正好治了实测的 `π` 事故

§20.2 记着当时的处置：OSC 标题把 pi 的状态栏字形 `π` 当成了会话名，**因为是 `Native` 级别**
而覆盖了用户首条输入，于是**整条 OSC 来源被删除**（`terminalTitle.ts` 与其 6 个用例一并删掉）。

诊断错了：出问题的是**缺少准入判据**，不是来源本身。证据是当时唯一的判据
`title::is_title_material` **是为 `Prompt` 设计的** —— 它拒绝斜杠命令与纯符号，而状态栏形态
恰好**含字母**：`π` 是希腊字母（`char::is_alphanumeric` 为真）、`✳ Claude ready` 含单词 ——
两者都能通过。拿它当 Native 判据等于没判。

删来源的代价被低估了：Claude Code / Codex 会把**任务标题**写进 OSC（`✳ Fix login bug`），
那是 provider 自己做的语义浓缩（公理 2 的「源头」），质量高于 `Prompt`（原始按键）。
删掉等于永久放弃唯一的 `Native` 真实来源。补上准入后，`π` 与 `✳ Claude ready` 被拒，
`✳ Fix login bug` 通过 —— 来源与判据各归其位。

### 11.3 D1 · 先收敛写路径：`SessionEntry::new` 不再接收标题

```rust
// 现在（第二条写路径，绕过全部判据）
SessionEntry::new(sid, kind, agent, workspace, cwd, (source, title))
// 之后（恒为 (Placeholder, "")，标题只能经 upgrade_title 写入）
SessionEntry::new(sid, kind, agent, workspace, cwd)
```

登记后按**质量升序**依次 apply 候选（`Prompt` 再 `Native`），让 `should_upgrade` 自己选强的。

**为什么这不是重构偏好**：`title::pick` 就是 `should_upgrade` 在**空条目**上的特例 ——
「取最强候选」已经由序关系表达了。两个函数编码同一条序 = 两份真相，而下一节要给这份真相
加准入判据时，两份都得改。

| 删除 | 量 |
| --- | --- |
| `title::pick` + 4 个用例 | ~30 行 + ~35 行 |
| `ChatRegistration::title()` | 18 行 → ~6 行 |
| `register_or_engage` 的 `.as_ref().map(\|(s,t)\| (*s, t.as_str()))` | 5 行 |

**代价（已评估，可接受）**：登记时出现一个瞬时空标题条目 —— 与 `set_title` 在同一命令内完成，
无观察者；`version` 会多 bump 1–2 次，而 `emit_changed` 仍只发一次（载荷只有版本号）。

**必须与 11.4 同一个 commit**：分开做会留下「`pick` 也学会了 `admit`」的中间态。

### 11.4 D2 · 判据表（`admit` 取代 `is_title_material`，不是新增一层）

不是「加一个准入层」，是把**已有的 Prompt 准入泛化成 4 个来源**：函数总数不变，
`registry.rs:422` 的 `if source == TitleSource::Prompt` 分支删除，`truncate` 降为私有细节。
对外只剩两个函数：`admit` + `should_upgrade`。

```rust
pub fn admit(source: TitleSource, raw: &str, agent_id: Option<&str>) -> Option<String>
```

| 来源 | 判据 | 判负的例子 |
| --- | --- | --- |
| `Placeholder` | **永远 `None`** —— 占位不是标题 | `pi` / `Terminal 1` |
| `User` | 非空即可（用户说了算，不套任何清理） | 空白串 |
| `Prompt` | 含字母/数字 **且** 非斜杠命令 **且** 剥掉客套包装后仍非空 | `/model`、`/mo`、`@`、`Can you please` |
| `Native` | 剥装饰后非空、**字符数 ≥ 2**、含字母数字、非身份回显、非纯状态词、非 `Terminal N`、非 cwd 形态 | `π`、`✳ Claude ready`、`ready`、`Terminal 2`、`/Users/tomgs/repo`、`claude-code` |

`Native` 的四条子判据，每条对应一个已观测或可证伪的失效形态：

| 子判据 | 失效形态 |
| --- | --- |
| 剥装饰（`✳ ✦ ⏲ ◇ ✋ ▲` / braille / 四分圆 / `. ` `* ` 前缀） | 装饰不进标题；剥完为空 ⇒ 判负（`✳` 单独出现） |
| 字符数 ≥ 2 | `π` 单字符 —— **`is_alphanumeric` 挡不住**，这条是唯一挡板 |
| 身份回显：`text == agent_id` 或其去 `-code` / `-cli` 形式，可后缀一个状态词 | `claude-code`、`pi`、`claude ready`、`cursor - action required` |
| 纯状态词 / `Terminal N` / cwd 形态（`/` `~` `C:\` 开头，或单 token 内含分隔符） | `ready`、`idle (2m)`、`Terminal 3`、SSH 无 hook 时的 spinner+cwd |

**身份判据的输入是 `agent_id`，不是 `AgentConfig`**：`agent_id` 已在 `SessionEntry` 上，
纯函数层因此**不新增对 agents 域的依赖**。新增一个 agent 不需要改判据函数；
slug 改名自动跟随。两侧都做「小写 + 非字母数字→空格 + 折叠」后比较（`claude-code` ≡ `Claude Code`）。

**身份回显是本表里最不确定的一条**（启发式，靠观测到的几个 CLI 调出来）。它排在最后实现：
即使漏判，后果是标题变成 `Claude Code` 这类固定短串 —— 用户仍能认出是哪个 agent 的会话，
只是没有主题信息。属于**可接受的降级**，不是正确性缺陷。

### 11.5 D4 · `Placeholder ⟹ 空标题` 这条不变量让两个谓词退化

若 `admit(Placeholder, _) = None` 成立（11.4 的第一行），则
`title_source == Placeholder ⟺ title.is_empty()`，于是：

| 现在 | 之后 |
| --- | --- |
| `has_real_title`（`registry.rs:438`）= `!title.is_empty() && source != Placeholder` | `!title.is_empty()` |
| `isNamedSession`（`liveSessionSelectors.ts:62`）= `source !== 'placeholder' && title.trim().length > 0` | `title.trim().length > 0` |
| `SessionList.tsx:104` 的 `titleSource === 'placeholder'` 分支 | **删除**（`isListedSession` 已把它挡在列表外，分支不可达，注释自己写着「理论上已为空」） |

收益不只是少几行：**`TitleSource` 真正退出 UI**（兑现 §10 的承诺），且堵上「IPC 传
`source: placeholder` + 非空 title」这个当前敞着的洞（`set_live_session_title` 的
`source` 是前端可控的 `Option<TitleSource>`，现在没有任何一层拦它）。

### 11.6 D5 · 性能边界：扫描预算（红线 3 取向）

现有 `title::truncate` 对**全量**输入做 `split_whitespace().collect::<Vec<_>>().join(" ")` ——
一条 200KB 的粘贴 prompt 会在**事件泵线程**上分配一个 200KB `String` + 每 token 一个指针的 `Vec`，
而它被 `pick` 与 `upgrade_title` 两个入口调用（11.3 之后只剩一个）。

改为先按**字符预算**取零分配前缀切片，再折叠、再截断：

```rust
fn budgeted(text: &str) -> &str {
    match text.char_indices().nth(TITLE_SCAN_BUDGET_CHARS) {
        Some((byte_idx, _)) => &text[..byte_idx],
        None => text,
    }
}
```

预算 `MAX_TITLE_CHARS * 8`：给 8 倍余量吸收缩进/换行（先按 80 字符硬切会把「80 个空格 + 正文」
整条切掉）。判据只看前缀：命令与 cwd 都在行首，结论不变。

### 11.7 D3 · 前置门是传输优化，不是判据（措辞修正）

早先版本把「用户输入前不收集 Native」写成**前置门**并与准入判据并列。按 11.1 的分类重新判：

- 如果 `admit` 正确，用户输入前的噪声**全部被拒**，`isListedSession` 也不会列它
  ⇒ 前置门对**正确性零贡献**；
- 它唯一的作用是**少发 IPC**（CLI 一启动就会反复刷 OSC）。

所以它必须与「逐字去重」放在同一个桶里：**无语义的传输优化**。措辞不能叫「门」或「判据」，
否则下一个人会以为删掉它会导致错误。真正的成本模型是：

| 层 | 职责 | 删掉的后果 |
| --- | --- | --- |
| `admit`（后端） | 判据 | **出错** |
| 逐字去重（前端） | 同一串不发两次 | 变慢 |
| 未 Engage 前不发（前端） | 少发启动期噪声 | 变慢 |

### 11.8 与既有决定的关系

| 既有 | 本次 |
| --- | --- |
| §4 表格里 `Native` 写着「`term.onTitleChange`」，但 §20.2 已把实现删掉（漂移） | 恢复，且补上准入 —— 文档与实现重新一致 |
| §23「斜杠命令不是标题」用 `source == Prompt` 分支 | 该分支移入 `admit` 的 `match`，`upgrade_title` 不再知道来源差异 |
| R4.1 `should_upgrade` 单调升级 | **不动**。判据正交，改任一个都是错的 |
| §20.2「OSC 不再是标题来源」 | 结论反转，但**理由被保留**：当时挡不住 `π`，现在挡得住 |
| 第三轮修订「没有真标题就不显示名字」 | 加强：判负时**不写空串**，已有标题保持 |

### 11.9 未根本解决的一处：OSC 通道的语义二义性（诚实标注）

`OSC` 承载**两类语义**（provider 渲染给终端标题栏的字符串）：任务主题 `✳ Fix login bug`
与状态 `✳ Claude ready`。hook topic 通道只承载一类（显式声明的会话主题）。当前两者都映射到
`Native`，靠「同级覆盖 + 谁后到」决胜负。

`admit` 之后这个问题**在已枚举形态上消失**（噪声帧被拒在门外，不参与覆盖竞争），但它是
**启发式收敛，不是结构性区分**：某个 CLI 的 idle 帧形态没被枚举到时，仍会覆盖正确标题。
表现是「标题变成一个固定短字符串」—— 可观测、可修。

**评估过并否决的结构性备选**：给 OSC 独立等级（`Placeholder < Osc < Prompt < Native < User`）。

- 序上 `Osc < Prompt` ⇒ Claude 的 `✳ Fix login bug` 会输给用户的「帮我看看登录」—— 语义更差
  （后者是原始按键，前者是 provider 的语义浓缩，公理 2 说浓缩在源头）；
- 序上 `Osc > Prompt` ⇒ 状态帧又压过用户原话；
- 代价：`TitleSource` 加 variant ⇒ wire 契约变 ⇒ 前端类型 + 序列化 + `view.rs` 断言。

**触发条件（写死，避免反复重开）**：真机出现 **≥2 例** `admit` 漏判（表现为标题被某个固定
短串占住且不恢复），才升级为独立等级；1 例按 11.4 补一条子判据。

### 11.10 明确不做（附理由，避免评审重开）

1. **词边界截断**（orca 的 `truncateAtWordBoundary`）：中文没有词边界；英文回退到上一个空格
   最多丢掉 45% 预算，换来的是「好看」而不是「可辨认」—— 公理 1 优先可辨认性。
2. **自动命名的用户开关**（orca 的 `tabAutoGenerateTitle` 默认 `false`）：本任务的
   「会话进侧栏的时机 = 有名字」直接绑在自动命名上，关掉等于侧栏不工作。开关会破坏已有
   不变量，而收益（少数人想看到无标题会话）不成立 —— 无标题的会话本来就不该列。
3. **provider 会话文件反查标题**（orca 的 `aiVaultTitle`）：§8.2 已定。但记下它的护栏：
   一旦 neeko 支持 tab 内多 PTY，标题归属必须按 **sessionId** 而非 tabId，否则同 tab 的两个
   pane 会互相抢名字（orca 用 `agent + sessionId` 双匹配才认）。当前单 PTY/tab 无此风险。

## 12. 第五轮修订：持久化侧栏会话列表（2026-11-05）

### 12.1 事实分层
- 持久化的是**侧栏列表条目** = 身份 + 标题 + 可见性 + 时间 + 原生恢复参数；运行时状态**不进**
  数据库（恢复时没有进程，任何非终止态都是假数据）。
- 注册表仍是唯一事实；DB 是它的重启投影，不是第二个事实源。恢复 = 把 DB 行**投影回**
  `SessionEntry`，且 `state` 固定为 `Stopped`。
- 行存在与否 =「这条会话在侧栏出现过」。因此**写穿从首次用户输入开始**，不在 `register` 无条件写。

### 12.2 存储位置：扩展 `session_cursors`（不新开表 / 不新开库）

`agent_sessions.db` 已有 `SessionStore`（注册表与 `AgentChatManager` 共用一个实例），且没有
`user_version` 门禁（`CREATE TABLE IF NOT EXISTS`），扩列风险远低于 `neeko.db` 的单一迁移链。

新列：`kind` / `project_id` / `worktree_path` / `title` / `title_source` / `has_user_input` /
`native_session_id`。时间不进新列：`created_at` → `started_at`，`last_activity` → `updated_at`。
`ResumeCursor` 仍是唯一持久化形状（名字保留，语义由 `cursor.rs` 的单向投影说明）。

**为什么不新开表**：`persistence-and-cache.md` §4b 的判据仍成立 —— 两张表会对「哪些会话该恢复」
给出两个答案。旧注释「终端不落 chat 表」随之改写：落盘的是**行**，不是「可恢复的进程」。

**兼容**：幂等扩列用 `PRAGMA table_info` 判存在性 + `ALTER TABLE ADD COLUMN`（每列一个默认值）。
旧行缺字段时：`kind` 默认 `chat`、`project_id` 空、`title` 空 —— 恢复时被过滤，不入注册表。

### 12.3 写穿策略（读者驱动）

| 时机 | 写什么 | 理由 |
| --- | --- | --- |
| `register` | 仅 `has_user_input == true` | 列表只列用户用过的会话 |
| 首次输入 / 首次 Engage | `has_user_input` + 标题 | 行「出现」的时刻 |
| 标题升级 / 用户改名 | `title` + `title_source` | 用户改过的名字必须活过重启 |
| native id 回填 | `native_session_id` | 点击恢复的唯一入参 |
| 状态转移 | 沿用既有节流（终态 / `turn_count`） | 不新增高频写 |
| `unregister` | DELETE | 删除 / 进程结束 = 从列表消失 |
| `begin_shutdown` 之后 | 只摘内存、不 DELETE | 退出不能等价于清空 |

锁内只做 map 操作；落盘一律锁外 best-effort（失败只 `warn`）—— 沿用 §4b.3。

### 12.4 启动恢复

`app::boot::on_setup` 调 `live_sessions::boot::restore(&state.live_sessions)`：

1. `list_restorable()`：过滤 `project_id != ''` 且 `title != ''`（旧行 / 无名行无法出现在列表里）；
2. 每行 → `SessionEntry { state: Stopped, .. }`；
3. 一次性插表 + **单次** `bump()`。

**不 emit 事件**：前端尚未挂载；`useLiveSessionsBridge` 挂载即拉快照。也不需要新命令。

### 12.5 退出抑制

`shutdown_background_and_exit` 第一行调 `live_sessions.begin_shutdown()`（`AtomicBool`）。
`Registry::unregister` 照常摘内存，但跳过 `store.delete_cursor`。不改关闭协议的顺序：
只要标志先置位，任何并发清理路径的 `unregister` 都不会删行。崩溃 / 强杀天然满足（根本没走到
`unregister`）。

### 12.6 点击才恢复（不改前端协议）

恢复出来的行就是普通 `SessionView`（`state = stopped`），点击走既有 `useActivateSession`：

- **terminal**：`isLiveSession = false` → `recreateSessionTab` → `live_session_resume_command` 读
  `native_session_id`（已持久化）→ 拼 `--resume`；成功后 `adopt_live_session` 继承标题、旧行退场。
  `Registry::adopt` 需同时「删旧 DB 行 + 写新 DB 行」。
- **chat**：打开一条新 chat tab（chat 侧没有原生 session id，§8.2 既有结论）；对话级恢复仍在
  Histor 面板。这是已知限制，不在本轮扩展。旧行不会因点击而 `adopt`（chat tab 没有
  `resumeFromSessionId` 通道），会作为历史保留到用户手动删除。

### 12.6.1 行增长与保留策略（已知取舍）

「关 tab」= 标 `Stopped` 并保留条目（既有语义），因此关过一个终端 tab 就会永久多一条 stopped
行；侧栏的 10 条分页只是展示折叠，不是清理。本轮选择**全量保留**（用户明确要「重启后不丢」），
清理阈值（N 天 / 每单元最近 K 条）需要产品决策，不在本任务隐式引入。

### 12.6.2 落盘串行化（实现约束）

`Registry` 的写入有三个线程来源（命令 / hook / 事件泵），而 `store` 是阻塞 IO、不能放进
`sessions` 锁。若直接把锁内算出的快照拿到锁外写，后写者可能拿旧快照覆盖用户改名 / 原生 id
（只在重启后暴露）。所以 `persist_gate: Mutex<()>` 串行化「从内存重投影 → 写库」，且
`unregister` 的删除同闸（否则一个在途旧快照会把刚删的行写回）。写序：`adopt` 先写新行、
后删旧行（中途崩溃最坏只留一条可手动删的陈旧行，而不是两行都丢）。

### 12.7 重命名输入框统一（同轮，前端）

- 根因：`SessionList` 的 focus effect 依赖 `[draft]`，每敲一个字符就重新 `select()` → 下一次
  按键覆盖整段（表现为「一输入就是选中状态」）。
- 归属错误：focus + 全选是「行内重命名输入框」的行为，应该由组件自己持有；现在
  `SessionList` / `useWorktreeRowState` / `TagGroupRail` 各写一份，漂移已在第一份发生。
- 统一：`InlineRenameInput` → `ui/Input size="sm"`，挂载即 focus + select；调用方删掉各自的
  effect 与 ref 透传。顺带继承 `ui/Input` 的 IME 空格守卫 / `noAutocorrectProps` / 统一 focus 样式。
- 范围：行内重命名 / 新建文本输入（侧栏会话行、worktree 行、tag group）；搜索框、过滤器等
  其它裸 `<input>` 不在本轮。
