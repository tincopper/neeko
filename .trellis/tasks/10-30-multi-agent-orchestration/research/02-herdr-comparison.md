# herdr 的 Agent 编排与通信机制（对照 Neeko 方案）

调研日期：2026-10-30 · 信源等级 **A**（官方仓库 + 官方文档原文，逐条可核）

仓库 `herdrdev/herdr`（Rust，Apache-2.0，46.7k★，2026-03 创建，活跃到 2026-10-29）
站点 `herdr.dev` · 定位「the runtime your coding agents live on」

---

## 0. 一句话结论

herdr **不用 MCP**。它对 agent 的暴露面是 **`$HERDR_BIN_PATH` CLI + 本地 unix socket**，
教 agent 学会用它的手段是 **一个 Markdown skill 文件**；
而 agent 的 **状态**，对 Claude Code 等大多数 agent 是**读终端屏幕**（detection manifest），
其对 Claude 的 `integration install` 装的 hook **只上报 session identity 用于恢复**，不用于状态。

---

## 1. 编排：不编排，只给原语

herdr 没有 leader / 任务板 / 委派。它提供的是**原语**，编排逻辑在被 skill 教会的那个 agent 脑子里。

| 层 | 机制 |
| --- | --- |
| 状态注册表 | 每个 pane 一个 `idle / working / blocked` 状态（外加 `--message` 解释 blocked） |
| 等待 | `agent.wait <pane> --until done\|blocked` —— 官方原话「**observe semantic state, not arbitrary command completion**」 |
| 派活 | `agent.prompt`，可带 `wait {until, timeout_ms}` —— **prompt+wait 原子**，避免两次调用之间的竞态 |
| 布局 | `pane.split` / `pane.open` / `pane.move` / `pane.swap` / `pane.zoom` |
| 起新 agent | `agent.start` |
| 事件 | `events.subscribe` / `events.wait` |

socket API 方法族（实测统计）：`pane.*` 20+ 个、`agent.*`（`list/get/read/explain/send_keys/prompt/wait/rename/focus/start/view.set/view.clear`）、`session.snapshot`、`events.*`。

**`agent.wait` 两个值得抄的细节**：
1. 「server-owned and **event-driven**」—— 不是轮询
2. 「**pins the resolved pane occupant** so a replacement cannot satisfy the wait」—— 等待绑定身份，同位置新起的 agent 不能顶替

`agent.prompt` 一个值得抄的保护：「If the resolved agent is already **blocked**, `agent.prompt` returns `agent_blocked` **without sending input or starting the wait**」—— 目标在等人时不往里打字节。

---

## 2. 通信：终端 I/O，没有消息层

| 动作 | API |
| --- | --- |
| 给另一个 agent 说话 | `agent.prompt` / `agent.send_keys` / `pane.send_input` |
| 读另一个 agent 说了什么 | `agent.read` / `pane.read`（读 pane 输出，含历史） |
| 读日志 | `pane.read` + `pane.process_info` |

**没有 mailbox、没有结构化消息、没有任务板**：在 socket API 全文里 `team` = 0 次、`task` = 0 次。

peer-to-peer 通信 = **A 往 B 的 pane 里打字，然后读 B 的屏幕/输出**。

---

## 3. MCP：零提及

在以下四份官方文档里 `mcp` 出现次数均为 **0**：
- `/docs/agent-skill/`（agent 怎么驱动 herdr）
- `/docs/add-herdr-support/`（第三方 agent 怎么接入）
- `/docs/socket-api/`（46KB 的完整 API）
- `/docs/integrations/`（每家 CLI 的集成装了什么）

agent 侧的「工具面」是 CLI 命令，不是 MCP server。

---

## 4. Claude Code 的特殊情况（用户问题的核心）

`herdr integration install claude` 做的是：

> 「Install the Claude Code hook … The hook reports Claude Code **session identity** to the local Herdr socket **on session start**. **Claude Code state comes from Herdr's screen manifest detection.**」
>
> 「Herdr uses `~/.claude` … Install writes `hooks/herdr-agent-state.sh` and updates `settings.json` with Herdr hook entries.」

即：
- **装的是 `SessionStart` hook**（匹配 `startup / resume / clear / compact / fork` 五个 source）
- 它**只上报 session identity**（为了 server 重启后能 resume 回同一会话）
- **状态（idle/working/blocked）依然靠读屏幕**

Codex 同构：hook 报 session identity（`hooks.json` + 确保 `[features] hooks = true`），状态仍是屏幕 manifest。

**只有 agent 自己上报状态的会覆盖屏幕判定**：opencode / pi / kimi / kilo 标注 "also reports state"。
「When an integration also reports state, Herdr uses those reports **instead of** reading the screen.」

### 屏幕读状态的三个官方自认局限（原文）

1. 「Unusual new agent prompts may **initially show as idle instead of blocked** until Herdr learns that screen shape.」
2. 「Detection itself does not send input, but **automation that trusts a mistaken idle state can type into an approval dialog**. … **idle status is not authorization to approve an action.**」
3. 「Antigravity and Grok count as idle once they return to their prompt, **even if background tasks, monitors, or subagents are still running**. `agent wait` and `agent prompt --wait` observe the agent's **state, not completion** of those jobs.」

第 3 条是**第一方承认 `wait --until done` 不等于「活干完了」** —— 与本方案 `Idle ≠ Done` 的不变量完全一致。

### 跨 CLI hook 泄漏（他们真踩过）

> 「Claude integration v10 matches **only** the documented SessionStart sources… This prevents **Grok's** `new` and `load` events from launching the imported Herdr Claude hook, without disabling unrelated Claude-compatible hooks.」

即 Grok（Claude 兼容面）触发了本该属于 Claude 的 hook。这与 Neeko 要修的「同 cwd 归因串台」是同一族问题。
Neeko 现状相对更稳：`neeko-report.mjs` 的 `<source>` 走 **argv**，不是靠事件名反推。

---

## 5. 为什么两家选择不同（不是品味差异，是覆盖手段差异）

| | herdr | Neeko |
| --- | --- | --- |
| 要覆盖多少 agent | **16+**（含自己都不熟的），无法要求人家改代码 | 8 个已装 hook 的目标 |
| 因此状态来源 | 必须能兜底 → **读屏幕** | 可以直接要信号 → **hook 上报** |

herdr 读屏幕是**覆盖面的代价**，不是设计偏好。一旦某 agent 自愿上报，它立刻改成用上报。

---

## 6. 对照表（本任务方案 vs herdr）

| 维度 | herdr | Neeko 本方案 | 取舍 |
| --- | --- | --- | --- |
| agent 侧工具面 | CLI + unix socket | **MCP**（HTTP + stdio bridge） | MCP 有自描述 schema，模型更难忽略；CLI 通用性更强（任何能跑 shell 的 agent） |
| 怎么让 agent 学会用 | Markdown **skill 文件** + `HERDR_ENV=1` | 写进 CLI 的 **MCP 配置** | skill 是 advisory；MCP 是客户端自动注入 |
| 状态信号 | 屏幕 manifest（+ 自愿上报优先） | hook `turn_completed` / `approval_requested` / … | 我们**不该**退回读屏幕 |
| 乱序保护 | **`--seq` 单调序号** | ❌ 无 | **该偷** |
| 完成语义 | `wait --until done` = 回到提示符 | L1 机器信号 + **L2 显式声明**分离 | 我们更严 |
| 编排归属 | agent 脑内（skill 教） | **共享任务板**（后端持有） | 面板可观测、可恢复；herdr 无 |
| 团队/认领/租约 | ❌ 无 | ✅ 有 | —— |
| 进程存活 | ✅ **daemon**（关客户端不断，重启用 resume 命令复原） | ❌ PTY 随 App 死 | 业界招牌能力，但是 terminal 域议题 |
| 跨机 | ✅ 内建 SSH 多机合并到一个列表 | 有 SSH 项目，但非会话持久化 | 同上 |

---

## 7. 三条该偷、一条该否、一条该记账

### 偷 1：`--seq` 单调序号
> 「Herdr **ignores reports whose number is not higher than the last one it accepted**, so late or out-of-order reports can't overwrite newer state.」

Neeko 的 hook 上报没有序号。乱序到达的 `turn_completed` 会覆盖更新的 `approval_requested`。
→ `HookEvent` 增加 `seq`（agent 侧用时间戳，集成侧自增），团队观察者丢弃非递增上报。

### 偷 2：`team_send` 支持原子 prompt+wait
> 「`agent.prompt` accepts an optional `wait` object … this submits the prompt and **starts the wait in one request, avoiding a race between separate calls**.」

→ `team_send(wait: {until, timeout_ms})` 单次往返；且目标在 `Awaiting` 时**拒绝投递**（`target_blocked`），不把字打进审批框。

### 偷 3：`team_wait` 钉住占用者
> 「pins the resolved pane occupant **so a replacement cannot satisfy the wait**」

→ 等待必须绑定 `member_id`；同一任务被租约回收后由新成员接手，**不能**满足旧 waiter。写成测试。

### 否：不退回屏幕读状态
herdr 自己的三条局限就是反证。我们有 hook，就不该猜屏幕。
（**但要记账**：屏幕 manifest 是覆盖「无 hook 的 agent」的唯一手段。若将来要支持 `gemini`/`grok`/`reasonix` 当成员，
屏幕读是唯一可行路径 —— 那时它是 **L3 兜底**，必须标「推测」并禁止据此自动批准。）

### 记账：daemon 化
herdr 46.7k★ 的核心卖点是「detach without stopping work」+ 重启后用 resume 命令复原。
这是我在「已否决 rmux」里列的第 1 个复活条件的最强旁证：**该能力在业界是招牌级，不是小众需求。**
但它属于 terminal 域（PTY 所有权），不应绑进 multi-agent 任务。

---

## 8. 追问：rmux 能满足 herdr 的能力吗？

**结论：给基座，不给语义。** 并且「rmux 已实现等 agent 结果」这个说法需要精确化 —— 它等的是**渲染文本**，不是**语义状态**。

### 8.1 逐项对照（证据均来自官方文档）

| herdr 的能力 | rmux 有吗 | 证据 |
| --- | --- | --- |
| daemon（关客户端不断） | ✅ **有** | 「Local daemon architecture: shells, panes, windows, sessions, and scrollback stay on your machine」 |
| sessions / panes / layout | ✅ 有 | tmux 兼容 90+ 命令；SDK `EnsureSession` / `session.pane(r,c)` |
| 发输入给某 pane | ✅ 有 | SDK `pane.send_text(..)`；CLI `send-keys` |
| 读 pane 输出 / scrollback | ✅ 有 | SDK「capture snapshots」；`pane.read` 类命令 |
| **等待** | ⚠️ **有，但语义不同** | 「**wait for rendered text**, capture snapshots, inspect locators, stream output」；示例名 `wait_for_text`；代码形态 `pane.expect_visible_text().to_contain("ready").timeout(5s)` |
| pane 生命周期事件 | ✅ 有 | `PaneStateClosedReason::DiedKept` 等，`sdk.pane.state_events` |
| **agent 状态（idle/working/blocked）** | ❌ **没有** | 官方自述：「**RMUX does not try to classify agent names.**」（`docs/scripting-sdk.md`，在讲 foreground process 契约时明说） |
| **agent 上报协议**（`pane.report_agent --state --seq`） | ❌ 没有 | 无对应命令族；SDK 方法集里无 agent 概念 |
| **`HERDR_*` env 契约** | ❌ 没有 | 只有 `RMUX_*`（配置/诊断类） |
| **每 CLI 的屏幕 detection manifest** | ❌ 没有（明确不做分类） | 同上自述 |
| **agent 级 API**（`agent.wait --until done` / `agent.prompt` 原子 + 拒投 blocked） | ❌ 没有 | 只有 pane 级 |
| **agent 集成**（写 `~/.claude/settings.json` 的 hook 用于 resume） | ❌ 没有 | —— |
| 多机 SSH 合并到一个列表 | ⚠️ 「web share」不同问题 | 无 SSH 会话合并 |
| 教学 agent 的 skill 文件 | ❌ 没有 | 但 demo 用 `CLAUDE.md` 承担了同一角色 |

### 8.2 「等 agent 结果」的精确差异

```
herdr:  agent.wait w1:p1 --until done      ← 等语义状态（done = 回到提示符）
rmux :  pane.expect_visible_text().to_contain("done").timeout(5s)   ← 等屏幕出现某段文字
```

后者**必须由调用方自己知道"该等什么文字"** —— 也就是要自己为 claude / codex / gemini / grok 各写一套屏幕规则。
herdr 把这个「知道」做成了产品（detection manifest + blocked 严格匹配 + explain 输出），rmux 明确声明不碰这一层。

所以：**rmux 少掉的不是 wait 原语，是"等什么"这件事。**

### 8.3 官方那个「Multi Agents Orchestration」demo 的真实内容

`rmux-demos/demo-orchestration/launch.sh`（287 行 shell，标称 ≃514 行）：

1. `new-session -d -s codex/gemini/grok <cmd>` —— 建 3 个 detached 会话
2. 开 3 个终端窗口分别 `attach-session`
3. 开第 4 个窗口跑 **Claude**，注入 `RMUX_DEMO_TARGETS='codex:0.0 gemini:0.0 grok:0.0'` + `IS_DEMO=1`
4. 结束

README 原话：「Claude controls other AI agents through rmux … **Claude gets the rmux context it needs to send input to the other agents and read their panes.**」

**它和 herdr 的模型完全一样**：multiplexer + 教 agent 用 CLI；编排逻辑在 Claude 里。
但**没有 wait**（脚本里只有 `sleep`），也**没有结果回传**。

> ⚠️ 而且它 README 明写「this demo starts AI CLIs with **approval or sandbox bypass flags**」。

这一句是决定性的：**因为它没有 blocked 状态，一遇审批就会卡死，所以只能绕过审批。**
herdr 的解法是建 blocked 检测层；Neeko 的解法是审批队列（`ApprovalPanel` + 待批队列）。
三方在同一问题上的三种选择，而「绕过审批」是唯一不能用于产品的那个。

### 8.4 对 Neeko 的三个不同议题，三种结论

| 议题 | 结论 |
| --- | --- |
| **A. 给 Neeko 的 multi-agent 加编排** | **两者都不是依赖项。** 缺的是语义层（状态注册表 / 上报 / 任务板），而 Neeko 已有更强的信号源（8 家 hook，不是猜屏幕） |
| **B. Neeko 要不要 daemon 化（关掉 App 后 agent 继续跑）** | **rmux 是合格候选人**（Rust、daemon、跨平台原生、MIT/Apache）。herdr 46.7k★ 证明这个需求是招牌级而非小众 —— 但它是 terminal 域议题，不绑进本任务 |
| **C. Neeko 的差异化定位** | herdr 用**屏幕猜测**覆盖 16 家；Neeko 有 **8 家真实信号**。若在 hook 信号之上建任务板 + 团队，**语义上严格强于 herdr**；herdr 强在进程存活与覆盖面。别在「读屏幕」上和她比，那是她的补救手段，不是优势 |

### 8.5 一条反向提醒

不要因为「rmux 有 wait 就以为省了事」。有了 wait 原语，仍然要回答：
**等什么？谁来报？乱序怎么办？审批态和空闲态怎么区分？**
这四问正是本任务 `design.md` §4–§6 的全部内容 —— 它们与「用谁的 PTY」无关。
