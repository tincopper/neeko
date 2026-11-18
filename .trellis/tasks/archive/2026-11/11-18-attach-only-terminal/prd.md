# 接回失败不得静默降级成新建会话

## Goal

「接回一条还活着的 PTY」失败时，`TerminalViewBase` 现在**静默新建一条会话**并自动拉起 agent。
对团队成员的会话，那是一条**没有团队 MCP 端点 / 凭证 / 隔离配置目录**的裸 CLI —— 它带着队长
preamble 起来却调不到任何 `team_*` 工具，而用户以为「打开的就是那个队长的会话」。

本任务把这条路径改成 **attach-only**：调用方要求接回时，接不回来就**诚实失败**，不替换成别的东西。

## 现状（可指到文件的事实）

| # | 事实 | 位置 |
| --- | --- | --- |
| 1 | 存活探针 = `detach_terminal_session(id, false)`：drain 存在返回 `true`，不存在返回 `false` | `src/features/terminal/utils/sessionAttach.ts:18`、`src-tauri/src/common/terminal/drain.rs:241` |
| 2 | 探针返回 `null` 时**直接落到** `createSessionVal(...)`，并把同一个 `tabAgentId` 传进去 | `src/features/terminal/components/TerminalViewBase.tsx:274-286` |
| 3 | 新建成功后 `!attached` 成立 ⇒ 走自动拉起 agent 的分支（`buildAgentCommand` + `terminalInputEvent`） | 同文件 `:296-320` |
| 4 | 成员的启动参数（`--mcp-config` / `NEEKO_TEAM_*` / 隔离配置目录）**只**在团队执行层起进程时注入；终端域新建的 PTY 一个都没有 | `src-tauri/src/app/team_executor.rs:214-262` |
| 5 | 调用方在「快照说还活着」时传 `attachSessionId`：花名册「打开会话」、侧栏团队行、`sessionTabFactory` 的 live 分支 | `TeamPanelWrapper.tsx`、`useTeamEntryActions.ts`、`sessionTabFactory.ts:57-64` |
| 6 | 探针对**已 attached（非 detached）** 的 drain 同样返回 `true`（先判断存在再 `set_detached`）⇒ 双挂载**不会**误判 | `drain.rs:241-249` |

窗口很窄（进程最后一次快照**之后**、用户点击**之前**退出），但后果不是「少一个 tab」而是
「多一个冒充队长的进程」，且它会以 `User` 归属出现在侧栏 —— 与 `11-17-team-member-session-lifecycle`
整条任务在消灭的形态同族。

## Requirements

- **R1** `attachSessionId` 存在时，`TerminalViewBase` **不得**调用任何建会话路径
  （`createSessionVal` / `strategy.createSession` / `sessionTabFactory`）。
- **R2** 失败态不得启动写管线 / drain 订阅，也不得自动拉起 agent（没有会话可投递）。
- **R3** 失败必须可见并且可读：替换「Connecting…」为一条明确说明
  （英文，与终端域一致），带 `data-testid` 供测试钉住。
- **R4** 成功路径与其它路径（无 `attachSessionId`、`resumeFrom`、`taskCommand`）行为**逐字不变**。
- **R5** 生产代码里**没有**第二处「探针失败 ⇒ 新建」的兜底（`grep` 证明）；若存在，一并收口到本判据。

## 明确不做

- **不做**自动恢复（续写 / 跳团队面板 / 关闭 tab）。恢复动作的判据在**调用方**：花名册五态
  （`utils/memberTerminal.ts`）、侧栏 `sessionTabFactory` 的 resume 分支。终端视图再猜一次
  就会造出第二套判据，而错分的症状正是本任务要消灭的那一个。
- **不改后端**：`detach_terminal_session` 的探针语义已经够用（§现状 6 已核实）。
- **不改** `attachLiveSession` 的接口。

## Acceptance Criteria

- [x] **AC1** 单测：`attachSessionId` 给出、探针返回 `false` ⇒ `createSessionVal` **一次都没被调用**，
      且页面出现失效提示（按 `data-testid` 断言）。
- [x] **AC2** 单测：同上场景 ⇒ 没有任何 agent 自动拉起（`emit` / `terminalInputEvent` 未命中），
      也没有 drain 拉取（无 `terminal_drain` invoke）。
- [x] **AC3** 单测：探针返回 `true` ⇒ 不新建、`ready` 正常、提示不出现（既有接回路径零回归）。
- [x] **AC4** 单测：没有 `attachSessionId` ⇒ 照常新建（既有行为不变）。
- [x] **AC5** `grep -rn "attachSessionId" src | grep -v __tests__` 逐个复核，确认没有第二处
      探针失败即新建的兜底。
- [x] **AC6** `pnpm check:quick` 通过；`pnpm exec vitest run src/features/terminal src/features/live-sessions src/features/agent-team` 全绿。

## Notes

- 红线自查：4（无新 IPC 载荷）· 6（纯前端，无后端命令）· 17（失效态是**派生**的渲染结果，
  不新增「我要接回谁」的本地记账）。
- 相关任务（均已归档）：`11-17-team-member-session-lifecycle`（成员会话的三条归属守卫）、
  `11-17-sidebar-lead-session`（侧栏团队行，正是本缺陷的一条入口）。

## 实施记录（与原计划的差异）

| # | 计划 | 实际 | 为什么 |
| --- | --- | --- | --- |
| 1 | 只改 `TerminalViewBase` | 另**抽出两个纯表现组件**（`TerminalTurnOverlay` / `TerminalScrollToBottom`）并把体积基线 542 → 537 | `check_component_size` 是 ratchet：该文件已登记基线，只许缩小。三态重构把文件顶到 576 行 ⇒ 必须同步拆分，否则门禁红 |
| 2 | 改写既有 attach 用例 | `TerminalAttach.test.tsx` 里那条「探针 false ⇒ 照常新建」的用例**被改写**（它钉的正是要删掉的行为） | 那条用例自己的注释写着「接着用一个死 id 只会得到一个永远空的终端」—— 它把「避免空终端」误解成「换一条会话」，而正确的解法是诚实的失效提示 |

红线自查补充：4（无新 IPC）· 6（无后端改动）· 17（失效态是探针结果的一次派生）。
