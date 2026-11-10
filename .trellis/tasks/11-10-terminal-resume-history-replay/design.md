# 技术设计：终端恢复的历史回放（方案 A）

## 1. 一句话架构

新增一个后端 command 按 `sessionId` 取该会话的 transcript 历史（结构化文本块），前端在 **PTY 创建之前**把这段历史写进同一块 xterm，再照常拉起 `--resume` 的新 PTY。历史是 xterm 收到的第一批字节，新输出接在后面。

## 2. 边界

| 归属 | 职责 |
| --- | --- |
| `live_sessions`（Rust） | 提供「session id → native id + agent id」的读接口入口（复用 `Registry::entry`，不新增状态） |
| `conversation`（Rust） | 定位 transcript、分页读取、投影成纯文本块；**不依赖扫描缓存已 hydrate** |
| `terminal/commands.rs`（Rust） | 新增 `terminal_replay_history` command，只做参数校验 + 调度（红线 6） |
| `TerminalView.tsx`（TS） | 从 tab data 取 `resumeFromSessionId`，作为**稳定** prop 下传 |
| `TerminalViewBase.tsx`（TS） | 持有 `term` 实例，负责「回放 → 建 PTY」的顺序与 `term.write` |
| 侧栏 / 选择器 | **不改** |

不新增持久化表、不新增 IPC 事件名（红线 5）、不改 `SessionView` wire 形状、不改 drain / backpressure、不改 `fitAddon` 调用点。

## 3. 数据流

```
侧栏点击已结束的终端会话
  → recreateSessionTab(...) 建 tab，带 resumeFromSessionId + taskCommand
  → TerminalView 把 resumeFromSessionId 稳定下传给 TerminalViewBase
  → TerminalViewBase effect:
      term = new Terminal(); term.open(wrapper)        ← 现有
      await loadReplay(replaySessionId)               ← 新增：IPC 取历史
      term.write(replayText)                          ← 新增：第一批字节
      term.write('\r\n' * K)                          ← 新增：把历史顶进 scrollback
      sessionId = await createSessionVal(..., taskCommand)  ← 现有：CLI 从这里才启动
      onSessionCreated(sessionId) → adoptLiveSession(...)  ← 现有，不动
  → CLI 输出经 drain 依次 term.write，接在历史之后
```

### 为什么回放必须在 `createSessionVal` 之前

`terminal/manager.rs:144 pair.slave.spawn_command(cmd)` 在 invoke 返回前就执行了 `taskCommand`；`onSessionCreated`（`TerminalViewBase.tsx:285`）触发时 CLI 已启动、清屏/alt-screen 序列可能已进 drain。把回放挂在 `onSessionCreated` 之后，顺序必然反。前移到 PTY 创建前，历史天然排在所有 PTY 字节之前（调研 B1）。

代价：恢复时 `Connecting...` 多显示一段（IPC + 分页读取）。可接受，且失败必须**降级**：读历史出错不影响 PTY 创建。

## 4. 契约

### 4.1 新增 Command（后端）

```rust
// terminal/commands.rs（名字在实现时定稿，注册进 lib.rs 的 neeko_invoke_handler!）
pub fn terminal_replay_history(
    session_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<TerminalReplay, AppError>

const REPLAY_MESSAGE_LIMIT: usize = 50;  // PRD R7：每次恢复只回放最近 50 条
const REPLAY_CHAR_LIMIT: usize = 64 * 1024; // 载荷兜底，单次 JSON 远低于 2MB

#[derive(Serialize)] // camelCase
struct TerminalReplay {
    blocks: Vec<ReplayBlock>,   // 有序，旧 → 新；至多 REPLAY_MESSAGE_LIMIT 条
    omitted: u32,               // 被省略的更早条数（前端渲染「已省略 N 条」）
    reason: Option<ReplayUnavailable>, // NoNativeId / NoTranscript / UnsupportedAgent
}
struct ReplayBlock { role: String, text: String }  // role: user | assistant | tool
```

- 入参只要 `sessionId`：前端不需要知道 native id（调研 B2，`SessionView` 没有该字段）。
- 后端从 `Registry::entry(session_id)` 取 `native_session_id` + `agent_id`；缺失即返回空 `blocks` + `reason`，**不是错误**。
- 读 transcript **不能**走现有 `get_conversation_messages`（它不 hydrate，恢复当次可能读不到，调研 B2）。方案优先级：
  1. 复用 `ConversationManager::hydrate_from_disk_index_if_empty()`（`manager.rs:138`，磁盘索引、非全量扫 transcript）+ `get_messages_page_from_end`；
  2. 若仍取不到，按 `(agent_id, native_id)` 走 adapter 的 direct file lookup（Phase 2 定位具体函数）。
- **回放范围（PRD R7，用户已定）**：只取**最近 50 条**（`REPLAY_MESSAGE_LIMIT`），更早的不读进载荷，`omitted = total - blocks.len()`。`REPLAY_CHAR_LIMIT` 是载荷兜底（红线 4，`command-guidelines.md:226`），与 50 条取先到者。注意 `get_messages_page_from_end` 是「跳过末尾 N 条」、**不是**「取最近 N 条」，实现要先拿 `total` 再算窗口，别用反。
- **投影内容（PRD R8，用户已定）**：只取 `text` 类块 + tool 调用的一行摘要；`thinking` 与 `toolResult` 原始输出一律不进回放。`tool` role 的 `text` 即那行摘要，前端不再渲染工具详情。
- 用户视角：被省略的更早内容仍可在已有 Histor 面板查完整历史，回放开头写一行「已省略 N 条，完整历史见 Histor」。

### 4.2 前端 API

- `src/features/live-sessions/api/liveSessionsApi.ts`（或 terminal 域自己的 api）新增 `fetchTerminalReplay(sessionId): Promise<TerminalReplay>`，错误一律 catch 成空回放。
- `TerminalViewBase` 新增可选 prop `replaySessionId?: string`；**该值必须稳定**：`TerminalView.tsx:73` 在 `handleSessionCreated` 里会清掉 `resumeFromSessionId`，若 prop 随之变 `undefined` 且进了 effect 依赖数组，会触发 cleanup + PTY 重建。用 `useRef` 锁首次值，或不进依赖数组（ref 读取）。
- 渲染成纯终端文本（`renderReplayText`，纯函数）：开头一行「已省略 N 条，完整历史见 Histor」（`omitted > 0` 才写）；随后每行 `<role> │ <text>`，长行折叠；末尾一条分隔线（`─── 以上为历史回放 · 以下为本次续写 ───`）与若干空行，让历史滚进 xterm 的 scrollback。`omitted = 0` 时不写省略提示。

## 5. 关键技术决策

### 5.1 scrollback 而非当前屏幕

历史行 + 分隔线 + 空行写满一屏以上，让历史进入 scrollback。xterm 的 `ESC[2J` 只清当前屏幕（`ESC[3J` 才清 scrollback），因此 CLI 启动时的常规清屏**大概率**不会抹掉历史；`ESC[?1049h` 切 alt-screen 会保存主屏、退出时恢复。这两点需要一次实测 spike 验证（调研 B4），不能靠推断。

### 5.2 alt-screen 限制（已与用户对齐）

全屏 TUI 运行期间主屏被切走，历史不可见；退出 TUI 或滚回主屏才回得来。这是 xterm 固有行为，方案 A 接受，不为此引入分栏（PRD Technical Notes）。若实测发现目标 CLI 会 `ESC[3J` 清 scrollback，则本方案不成立，需回报用户重新在 A/B 之间选择 —— 这是唯一的方案级风险，放在实现第一步验证。

### 5.3 不复用 `convertHistory`

`historyConvert.ts:124` 产出 `ChatMessage`（React 消息模型，含 block id / ts），而回放目标是字节流。只复用其 **role 归一化**（`toRole:110`）与块类型判据，不引入 chat 组件依赖（前端导入防火墙）。

### 5.4 失败降级

任何环节失败（无 native id、transcript 未找到、adapter 不支持、IPC 错误、分页超时）都返回空回放，照常创建 PTY；不弹 toast、不阻塞、不留空历史区。与 `resumeLaunch` 现有的「拿不到就退回新建同 agent 终端」同口径。

## 6. 兼容性

- `SessionView` / `TerminalTabData` 形状不变；`resumeFromSessionId` 的一次性消费语义（`TerminalView.tsx:73`）不变，回放用锁定的 ref 值。
- 无数据库迁移：不新增表、不新增列。
- 现有 `--resume` 链路、`adopt_live_session`、`drain` / credit-pull、`terminalCache` 全部不动。
- 无历史的新会话（非恢复路径）不发起任何新 IPC。

## 7. 回滚

- 前端：`replaySessionId` prop 不传即完全回到现状；删掉 `term.write(replay)` 调用即回滚视觉行为。
- 后端：新 command 无调用方后可直接摘除 `neeko_invoke_handler!` 注册与函数体，不留 schema 痕迹。
- 两步独立，可分先后回滚。

## 8. 待验证假设（实现第一步）

1. **A0 spike**：目标 CLI（pi 优先，claude-code 次之）`--resume` 启动时发的到底是 `ESC[2J`、`ESC[3J` 还是 `ESC[?1049h`；把文本写进 scrollback 后能否回看。若 `ESC[3J`，立即回报用户。
2. `hydrate_from_disk_index_if_empty` 能否在应用刚启动、Histor 从未打开时，仅凭 `(agent_id, native_id)` 定位到 transcript。
3. 回放 200 行文本时 `TerminalViewBase` 的 effect 等待对 `Connecting...` 时长与 `fitAddon` 的影响。
