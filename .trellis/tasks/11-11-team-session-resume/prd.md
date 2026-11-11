# 团队会话恢复：让团队的会话身份与进程生命周期解耦

## Goal

团队在**进程消失**（用户关窗、CLI 自己退出、app 重启、崩溃）之后仍然是一个**可恢复的团队**：
lead 与成员按各自的**原生会话 id**续接原来的对话，任务板与审计不受影响；
团队与成员的「身份」不再由 PTY 句柄与 token 定义；
同一个原生会话 id 只有**一个所有者**记录；
历史会话按**项目身份**（而不是路径字符串前缀）归属。

## 问题陈述（用户可见的三件事）

1. 团队退出后再点「打开会话」：**静默起了一个全新的裸 CLI**（没有 team env、没有 `--mcp-config`、
   没有角色 preamble），用户看到的是一个空对话。
2. lead 的会话**在历史记录里找不到**，团队面板上也没有「查看记录」入口。
3. app 重启后团队仍显示为「运行中」，花名册每行都显示「打开会话」，点下去必然失败或起新会话。

## 根因（一句话）

> **系统里没有「一名成员的对话」这个持久对象，于是用「进程句柄」当它的替身；
> 而进程句柄永远不可能跨重启存活 —— 所以「团队可以恢复」不只是没实现，而是当前数据模型里
> 无法表达。**

三个派生缺陷（每一个都独立成立）：

| # | 缺陷 | 位置 |
| --- | --- | --- |
| R1 | 会话身份（原生 id）在团队域**被门控记录**：只有 4 种事件键才记，其余事件直接 return | `agent/team/observe.rs:98` vs `:145` |
| R2 | 进程资源（`terminal_id` / `token_hash`）存在**身份行**上，并被 UI 当成「成员是否还存在」的唯一判据 | `agent/team/view.rs:642`、`src/features/agent-team/utils/memberTerminal.ts:80-90` |
| R3 | 历史归属用**路径前缀**匹配项目根；团队根常在项目根之外（`~/.neeko/worktrees/*`），结构上不可能匹配 | `conversation/types.rs:198`、`conversation/manager.rs:1322`、`conversation/scope.rs:95-106` |

## 不变量（本次要建立的，后续所有改动以此为准）

- **I1** 一名成员的「对话」= `(agent_id, native_session_id)`；它与任何进程无关，跨重启有效。
- **I2** PTY 句柄、token、MCP 端点端口都是**进程期资源**，寿命 = 进程寿命；不得出现在任何
  身份判据里，也不得作为「成员是否存在 / 是否可打开」的答案。
- **I3** 一个事实只有一个所有者：原生 id 由 hook ingest 记录一次（无门控），归属键在**启动时**
  由起进程的一方写入（`SessionOwner`），团队域**不存副本**（红线 17）。
- **I4** 恢复 = 用同一份身份 + 同一份原生 id **重建资源**（重新 admit、重新 provision、
  用 resume argv 起进程）；不是"把旧进程找回来"。
- **I5** 历史归属按项目/工作区身份解析，路径只是它的一个属性；路径→身份的映射必须来自
  注册事实，不得字符串反推（红线 12）。

## Requirements

### R-A 会话身份归位（S1）

- R-A1 团队成员的会话归属键（`SessionOwner`）在**起进程时**写入终端域；团队域不再保存
  `terminal_id` / `agent_session_id`。
- R-A2 一个成员会话的原生 id 在**任何** hook 事件到达时都被记录（不再按事件键门控），
  且与 `live_sessions` 的既有无门控记录是**同一份**。
- R-A3 花名册的「有没有活会话 / 有没有可看的历史」由**查询**终端域与会话域回答，
  不由团队行上的列回答。
- R-A4 app 重启后运行态归位：团队成员一律 `offline`，`closing` 队归位 `open`，
  全部 `token_hash` 清空（凭据寿命 = 进程寿命），每次归位写一条 `reconcile` 审计。

### R-B 恢复是一等操作（S2）

- R-B1 「续接某个原生会话」以 **argv 形态**（前缀 / 后缀）表达，逐 CLI 差异落在适配器
  （红线 15），不再把 resume 拼成一个 shell 字符串。
- R-B2 `team_resume(team_id)`：对每个**未封存**的成员，若有已知原生 id ⇒ 重建资源并用
  resume argv 起进程；没有原生 id 的成员进入 `cold` 并在结果里点名（不得静默新开）。
- R-B3 前端有第三态 `resume`（身份存在、进程不在）：文案必须与「查看记录」区分
  ——前者接管一个**新进程**，后者只读历史。
- R-B4 对 `offline` 成员调用 `team_send` 必须**明确失败**（今天静默成功）。

### R-C 历史按身份归属（S3）

- R-C1 团队行记录它所在的**工作区身份**（`project_id` + worktree），而不是只有路径。
- R-C2 历史面板的 scope 从 `Project { path }` 改为按身份（项目 → 全部工作区），
  团队根在项目之外时仍能归属。
- R-C3 侧栏行按工作区身份分组（团队成员的会话必须出现在它真正跑的那个工作区下）。

## Non-goals

- 不实现「进程离线后仍能给成员发消息」（消息队列 / 离线信箱）—— 恢复后重发即可。
- 不实现团队跨机器迁移（WSL / SSH 成员仍是 N/A：`extra_env` 只在 Local 生效）。
- 不实现「恢复时回放原先的 stdout 历史」（`resume_from` 是纯 shell 回放，与本次无关）。
- 不改 `MAX_*` 上界与红线 4 的载荷纪律。

## Acceptance Criteria

### S1

- [x] AC-1 `team_member` 表不再有 `terminal_id`、`team` 表不再有 `lead_session_id`；v22 迁移把
      `state='dead'` 映射成 `offline`、`team.state` 的 `active/closed` 映射成 `open/sealed`。
      **实施修正**：`team_member.agent_session_id` **保留** —— `live_sessions` 在自然退出时整行
      删除，它不能当持久 id 的主人；成员行是这份身份的唯一持有者（`team-domain.md` §5a）。
- [x] AC-2 lead 只发过 `session_started`（非 4 种信号键之一）也能拿到 `nativeSessionId`
      （回归测试：门控被删）。
- [x] AC-3 关掉 app（进程全部消失）再启动：`team_snapshot` 里每个成员 `live=false`、
      `state=offline`，团队 state 仍是 `open`；`team_send` 返回明确错误。
- [x] AC-4 重启后 `token_hash` 全为空 ⇒ 端点启动时组装出的 principal 表为空
      （旧 token 不能再用）。
- [x] AC-5 花名册的「打开会话 / 查看记录 / 离线可恢复 / 无任何会话」四态各有测试，
      且判据只有一处（`openTerminalAction`）。

### S2

- [x] AC-6 `team_resume` 后 lead 的 `nativeSessionId` 未变，且新 PTY 的 argv 含 resume 片段
      （逐 CLI：claude `--resume`、pi `--session`、codex `resume` 子命令、gemini/qoder 拒绝恢复）。
- [x] AC-7 对同一个已恢复团队再调一次 `team_resume` 是幂等的（已 `live` 的成员跳过）。
- [x] AC-8 没有原生 id 的成员在 `team_resume` 的返回里被点名，UI 显示「只能新开」，
      不显示为可恢复。
- [x] AC-9 `sealed` 团队与 `sealed` 成员不可恢复（明确错误），与「离线」区分。

### S3

- [x] AC-10 团队的根在 `~/.neeko/worktrees/<name>`（项目根之外）时，lead 的 transcript
      出现在 History 面板的该项目下。
- [x] AC-11 同一项目多个工作区的会话都归属于该项目，且侧栏按真正的工作区分组。
- [x] AC-12 路径→项目身份的解析只经注册事实（不得出现新的字符串前缀匹配）。

## Constraints

- 数据契约变更走一次 v22 迁移（三张表同批：`team`、`team_member`、必要时 `session_cursors`）。
- 跨域读取必须走读接口（红线 17），不得在团队域重建终端的活性副本。
- CLI 差异落在适配器 / 准入表数据（红线 15），不得在通用模块写 `if agent_id == ...`。
- IPC 载荷纪律不变（红线 4）：花名册每行恒定小字段。
- 破坏性变更（删列、清 token）必须在 spec 里写下后果与排查入口。
