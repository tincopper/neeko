# 执行计划：终端恢复的历史回放

> 复杂任务。TDD（Red → Green → Refactor），`pnpm check:quick` **只在收尾跑一次**。
> 前置：PRD / design.md 已评审通过，`task.py start` 已执行（Phase 2）。

## 顺序与检查点

### 0. A0 spike（方案级风险，必须先做）

- [ ] 用真实 pi / claude-code `--resume` 启动，抓首帧字节，确认清屏序列是 `ESC[2J` / `ESC[3J` / `ESC[?1049h` 中的哪一种；手工往 xterm 写若干行后再灌该序列，验证 scrollback 能否回看。
- [ ] **Gate**：若目标 CLI 会 `ESC[3J` 清 scrollback，方案 A 不成立 —— **停下回报用户**，回到 A/B 选择，不继续写代码。
- [ ] 顺带确认 `hydrate_from_disk_index_if_empty` 在「刚启动、Histor 从未打开」时能否凭 `(agent_id, native_id)` 命中 transcript。
- [ ] 把结论追加进 `research/current-state.md` §4 B4 与 design.md §8。

### 1. 后端：新增 `terminal_replay_history`

- [ ] **Red**：在 `src-tauri/src/terminal/commands.rs` 的测试里写用例 —— 无 native id → 空 blocks + `NoNativeId`；有 native id 但 transcript 缺失 → 空 blocks + `NoTranscript`；少于 50 条 → 全量有序返回、`omitted = 0`；**超过 50 条 → 只回最近 50 条且 `omitted = total - 50`（AC4）**；单条超长文本受 `REPLAY_CHAR_LIMIT` 截断；`thinking` / `toolResult` 不进 blocks、`tool` 只留一行摘要（AC5）。确认红。
- [ ] 定义 `TerminalReplay` / `ReplayBlock` / `ReplayUnavailable` DTO（放 domain 的 types 文件，遵守红线 9：`mod.rs` 只做声明 + re-export）。
- [ ] Green：command 只做参数校验 + 调度（红线 6）；`Registry::entry` 取身份；conversation 侧先尝试 `hydrate_from_disk_index_if_empty` + `get_messages_page_from_end`，失败再走 direct file lookup。
- [ ] 投影纯文本块，双闸截断，**注意 `get_messages_page_from_end` 是「跳过末尾 N 条」**（`research/current-state.md` §2）。
- [ ] 注册进 `src-tauri/src/lib.rs` 的 `neeko_invoke_handler!`。
- [ ] 单次返回 JSON 明显低于 2MB（红线 4）；大 transcript 走已有分页，不整体序列化。
- [ ] 前端镜像类型放 `src/shared/types/`（按域分文件）；API wrapper 放对应 feature 的 `api/`。

### 2. 前端：回放数据下发

- [ ] `TerminalView.tsx`：用 `useRef` 锁住首次读到的 `resumeFromSessionId`，作为**稳定** `replaySessionId` prop 下传。陷阱：`handleSessionCreated`（`:73`）会清掉 tab data 上的该字段，若 prop 进 effect 依赖会导致 cleanup + PTY 重建。
- [ ] `TerminalViewBase.tsx`：新增可选 prop；**不进主 effect 依赖数组**，用 ref 读取。
- [ ] `fetchTerminalReplay(sessionId)` 一律 catch 成空回放（失败降级，design.md §5.4）。

### 3. 前端：写入顺序与渲染

- [ ] **Red**：抽出纯函数 `renderReplayText(replay): string`（放 `src/features/terminal/utils/`），写测试覆盖：role 前缀、分隔线、空回放返回空串、长行折叠、`omitted > 0` 才写「已省略 N 条」、`omitted = 0` 不写、末尾空行数。确认红。
- [ ] Green：实现纯函数（role 只归一化，不引入 chat 组件依赖）。
- [ ] `TerminalViewBase` effect 内，在 `term.open(wrapper)` 之后、`await createSessionVal(...)` 之前插入 `await loadReplay()` + `term.write(...)`；**回放失败不得跳过建 PTY**（try/finally 或独立 catch）。
- [ ] 历史行数 + 分隔线 + 空行使内容滚进 scrollback（design.md §5.1）。
- [ ] 不改 `fitAddon` 调用点、不改 DOM 结构（AC3 / AC6）。

### 4. 补测试

- [ ] Rust：command 的正常 / 边界 / 错误路径；DTO 序列化形状（camelCase）。
- [ ] 前端：`renderReplayText` 全部边界；`TerminalView` 的 `replaySessionId` 稳定性（清掉 `resumeFromSessionId` 后 prop 不变、不重建 PTY）。
- [ ] 组件关键交互：恢复一条有历史的会话，断言 `term.write` 的调用顺序（回放先于首个 drain chunk）；恢复纯 shell 会话不发起 `fetchTerminalReplay`。

### 5. 收尾

- [ ] 只跑**一次** `pnpm check:quick`（含 eslint / tsc / fmt / clippy / 仓库护栏 / 改动文件单测）。
- [ ] 改 `.rs` 时 `check:quick` 不跑 `cargo test`：本地直测 `cargo test --lib terminal::` 与 `live_sessions::`。
- [ ] 同步必要 spec：`spec/backend/agent-chat-transports.md`（终端恢复小节）、`spec/backend/conversation-adapter.md`（若新增按 native id 读取口）、`spec/frontend/state-management.md`（若动到 tab data 语义）。
- [ ] 人工验收 AC1–AC7（尤其 AC1 的滚动回看、AC3 的纯 shell 行为、AC4 的 50 条上限与「已省略 N 条」、AC7 的回放先于首帧）。

## 风险文件

| 文件 | 风险 |
| --- | --- |
| `src/features/terminal/components/TerminalViewBase.tsx` | 主 effect 依赖数组极敏感；多插一个依赖就会重建 PTY / 泄漏进程。已有 StrictMode 双挂载与 `cancelled` 门的先例，改前通读 effect 全文。 |
| `src/features/terminal/components/TerminalView.tsx` | `resumeFromSessionId` 一次性消费与回放取值时序冲突。 |
| `src-tauri/src/terminal/commands.rs` / `src-tauri/src/lib.rs` | 新 command 注册；命令层必须薄。 |
| `src-tauri/src/conversation/manager.rs` | hydrate / 分页语义（`from_end` 是「跳过末尾 N 条」），别用反。 |
| `src/features/terminal/api/taskTerminal.ts` | `taskCommand` 生成链不动，只读对照。 |

## 回滚点

- 回滚点 1（spike 失败）：未写任何代码，直接回报用户改选 B。
- 回滚点 2（后端完成、前端未接）：command 无调用方，摘除注册与函数体即可。
- 回滚点 3（前端已接）：不传 `replaySessionId` prop 即回到现状；再删 `term.write(replay)` 调用。
- 无 DB 迁移、无 wire 形状变更，回滚不留残留。

## 不做

- 不落盘 PTY 字节、不做字节回放。
- 不改 chat 恢复链路、不改侧栏可见性规则、不改 drain / backpressure。
- 不引入 `@xterm/addon-serialize` 等新依赖。
- 不主动提交代码（根 `AGENTS.md` 收尾约定）。
