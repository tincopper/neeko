# 调研：业界开源 team 模式的人机交互（2026-11-07）

> 动机：用户反馈当前团队面板「用起来很怪、不灵活」。本文合并三路调研（编码 agent 编排器 /
> 平台仪表盘 / 终端原生交互，共 13 个项目），先盘 Neeko 现状与结构性病因，再对照业界模式给差距与方向。
> 三份原始调研报告见文末附录。信息以 2025-2026 公开文档为准，未确认处已标注。

---

## 0. Neeko 现状盘点（对照代码）

当前交互面（`src/features/agent-team/`，dock 右栏）：

| 用户能做的 | 落点 |
| --- | --- |
| 建队（配置成员池/上限/缺省/工作区）→ 自动开队长 PTY | `TeamLaunchPanel` → `start_team_session` |
| 列出/打开/关闭/删除团队 | `TeamListPane` / `team_close` / `team_delete` |
| 看花名册（八态徽标 + 租约剩余 + verification） | `TeamRoster` ← `TeamSnapshot` 脉冲刷新 |
| 看任务板（按状态分列 + 截断标记） | `TeamTaskBoard` |
| 打开成员/队长 PTY 终端（接管既有会话） | `openExistingTerminalTab` |
| 成员详情抽屉（任务 + 50 条事件 + 待批队列**展示**） | `MemberDetailDrawer` / `MemberApprovalQueue` |
| 任务详情抽屉（点开才拉正文） | `TaskDetailDrawer` |

**用户不能做的**：建/改/派任务（R1.7 只有队长能 create，UI 无入口）、批准/拒绝审批（无命令）、
对成员/队长插话（只能开 PTY 手打）、中途加/删/重启成员（respawn 未做）、看成员 transcript、
看 diff/产物（板上只有 summary + artifacts 引用）、改布局（固定 dock 槽位）。

### 结构性病因（为什么「怪」）

1. **面板是纯观察者** —— 设计把一切操作交给队长 agent 经 MCP 工具面执行，UI 只回放
   `TeamSnapshot`。用户唯一的「行动」是开终端手打。人被排挤到了圈外观战席。
2. **人的高频动作没有 UI 路径** —— 业界证据（见 §2）显示人在环的高频动作是：
   审批、插话、看产出、重试。四件事在当前面板上分别缺命令、缺通道、缺详情、缺重试。
3. **任务板是唯一主面**，而它天然低频变动（任务粒度大）——高频变动的是成员的
   流（thinking/工具/等人），流没有一等公民的呈现。

---

## 1. 三路调研的共性模式（合并去重后 12 条）

### A. 布局与观察

| # | 模式 | 出处 | 动机 |
| --- | --- | --- | --- |
| A1 | **两级布局：全局聚合（列表/看板）+ 单 agent 详情（日志流/diff/chat）**；没有一家用终端网格当主视图 | VK、Conductor、Sculptor、Claude Squad、Omnara、Warp | 并行规模一上来人只能细盯一个，其余靠状态聚合感知异常；网格在 >4 实例时可读性崩塌 |
| A2 | **事件流时间线是默认任务流呈现**（消息/turn/tool 流，带状态与耗时） | 全部平台：AGS、OpenHands stage groups、LangGraph thread、Omnara、CrewAI traces | 多 agent 并发不可预测，时间线是唯一能如实还原因果顺序的中性媒介，兼做审计 |
| A3 | **三态状态可视化（在思考 / 在调工具 / 在等人）+ attention 信号** | Warp tab 三元组（active/waiting/idle）+ 需输入 tab 加标记；OpenHands "Thinking"；Omnara running/sleeping | 正常时低噪音（可折叠），需要人时必须把人拉回（指示器/通知），且一键跳转 |
| A4 | **diff 是核心审查界面，行内评论即反馈** | VK 行内评论、Conductor 行级钉评、Sculptor Changes 累积 diff | 价值最高的两个人类环节是规划和评审；行级评论比自然语言更精准 |

### B. 行动与干预

| # | 模式 | 出处 | 动机 |
| --- | --- | --- | --- |
| B1 | **审批三层叠加：全局模式 → 类别/allowlist 规则 → 单次提示**，且**单次批准能沉淀为规则**（"always allow"），规则的作用域/继承是一等设计项 | Claude Code teams、Codex、Cline/Roo、Goose、Gemini CLI | 纯逐条审批在多 agent 下不可扩展（Claude Code teams 实测几十次/会话），纯自动不可信；规则不继承 = 摩擦重现（teams 的已知 bug #26479） |
| B2 | **单 agent 行内审批；多 agent 汇聚成「审批收件箱」+ 通知** | Claude Code teams 上浮到 lead、Omnara 审批卡片+推送、Warp attention | 焦点只有一个，审批要么抢占焦点要么变成可攒批的待办 |
| B3 | **排队 vs 打断是显式双通道，排队是默认** | Claude Code（Enter 排队/Esc 打断/Up 取回）、Codex（Tab 排队）、Amp（反默认） | agent 跑得越久随手补充越多；排队列表可见可编辑兼顾确定性与控制感 |
| B4 | **接管是渐进的：改命令 → 插话 → 整段接手**，永远留一扇舱门 | Gemini "Modify with editor"、Cline 审批条可编辑、Claude Squad attach、Sculptor Pairing | 「随时能半路抢方向盘」是心理安全阀，也是自动化的最终恢复路径 |
| B5 | **运行中随时插话（steer）是标配且不重置会话**；更进一步可 live steering（运行中改 model/tools/权限） | VK、Sculptor、Conductor、Omnara | 纠偏成本远低于推倒重来 |
| B6 | **关停分优雅与强杀两个动作**，且要处理进程残留 | Claude Code teams（转达 vs 按 x）、Claude Squad（pause vs kill） | 优雅关停要收尾+汇报，强杀要立断；混成一个动作两头不讨好 |

### C. 生命周期与结构

| # | 模式 | 出处 | 动机 |
| --- | --- | --- | --- |
| C1 | **worktree + 独立分支是并行默认单元** | 五家编码编排器全部支持，三家默认 | 多 agent 写同一 checkout 必互踩；分支化把合并变成验收关卡，失败可整枝丢弃 |
| C2 | **廉价重试：新 attempt / fork / reset，不污染旧上下文，可换配置** | VK "Create New Attempt"（换 agent/换基线）、LangGraph "Re-run from here"、OpenHands "Branch from here"、Conductor 开新 workspace 归档输家 | 单轮成功率有限，重试是高频动作 |
| C3 | **状态真相来自机器而非人手：列/徽标随 agent 行为自动迁移** | VK 看板由 attempt+GitHub 驱动（拖拽仅装饰）、Conductor Checks 聚合 | 手动状态板在多 agent 下必然腐化 |
| C4 | **配置分两层：仓库级持久约定 + 会话级临时旋钮** | Conductor 明文区分、Claude Squad profile、claude-swarm YAML | 团队规范一次配全队生效，任务判断留给当下 |
| C5 | **声明式 spec 双模编辑（表单/拖拽 ↔ JSON/YAML），团队即文件** | AGS JSON↔拖拽、LangGraph schema 表单↔Raw、CrewAI JSONC、claude-swarm YAML | 可版本化、分享、复现；同一份 spec 服务两类用户 |

### 两个反向启示（市场验证）

- **claude-swarm v1→v2 从「多进程多终端」退回「单进程单 REPL」**：MCP 互连 swarm 的可观察性成本过高——
  多终端形态如果每个 pane 都要人盯，人就会放弃盯。
- **Vibe Kanban（任务板最重的编排器）宣布 sunsetting**，而最轻的会话列表型工具（Conductor/Sculptor/Claude Squad）持续迭代：
  「共享任务板」作为**主隐喻**在市场上尚未被验证收敛。板适合当**聚合层**，不适合当**主交互面**——
  主交互面应该是成员的流与行动入口。

---

## 2. 差距分析：Neeko ↔ 业界模式

| 业界模式 | Neeko 现状 | 差距等级 |
| --- | --- | --- |
| B2 审批收件箱**可操作** | 队列仅展示，无 approve/deny 命令 | **P0**（本来就是 implement.md 3.2 未完项） |
| B5 插话/steer 通道 | 无（只能开 PTY 手打；`team_send` 有后端语义但无 UI 面） | **P0** |
| A2/A4 成员详情流 + 产物 | 抽屉只有任务+50 事件；transcript 按需拉取未做；无 diff/产物视图 | **P1**（3.3 计划内） |
| A3 attention 信号 | 六/八态徽标已有，但「需要你」时没有跨队聚合信号把人拉回 | **P1** |
| C2 廉价重试 | 无 respawn（C11 未做）、无换人/新 attempt 概念 | **P1**（respawn 已在剩余顺序） |
| B4 渐进接管 | 有最强档（attach PTY）；无低摩擦档（批准前改写、排队插话） | **P2** |
| C1 worktree 并行 | 类型已建，`create_worktree` 未接线（P4 未做） | **P1**（已排期） |
| B1 审批规则三层 | 有每成员 policy（Interactive/Queue/Bypass），无类别规则/always-allow 沉淀 | **P2** |
| A1 两级布局 | 已符合（列表→团队→抽屉） | ✅ 基本达标 |
| C3 状态自动迁移 | 快照+脉冲驱动 | ✅ 达标 |
| B6 优雅/强杀分离 | `team_close` 请求关进程（异步退出）+ closing 重试 | ✅ 大体达标 |
| C4/C5 配置两层与 spec 双模 | 建队表单一次配死；无 YAML/导出 | **P3** |

**总诊断**：面板的骨架（两级布局、快照驱动、徽标语义）与业界一致；「怪」来自**行动面缺失**——
观察做了一半（详情太薄），行动基本没做（审批/插话/重试无路径）。这与任务状态检查的结论完全吻合：
3.2 审批回填、3.3 transcript 拉取、C11 respawn 本来就是未完项。

---

## 3. 方向建议（供裁决，非定案）

1. **把「审批收件箱」做成面板的一等公民**（补 3.2）：队列卡片带 Approve/Deny → 回填成员 PTY；
   徽标 + 声音/高亮作为 attention。这是性价比最高的一步。
2. **给成员流一个一等呈现**（补 3.3 + A2）：成员抽屉升级为「时间线（事件 + transcript 摘要）」，
   后续叠加 diff/产物视图（依赖 P4 worktree 后才有分支产物可看）。
3. **steer 双通道**（B3/B5）：对成员 = `team_send` 的 UI 面（`target_blocked` 语义后端已有，
   Awaiting 时禁投递是现成的安全栏）；对 lead = 聚焦其 PTY。
4. **中途调整**（C2/B6）：respawn_member（C11）→ 再延伸出「换人重做」（新 attempt 的最小形态）。
5. **主面隐喻裁决**（反向启示）：建议**成员流 + 审批收件箱为主面、任务板退为聚合页签**，
   而不是继续以板为主。理由：VK 反例 + 用户「不灵活」的直接体感。
   ⚠️ 这是视觉契约级变更，`prototype-agent-team.html` 视图①与 AC11 需同步修订，需用户拍板。
6. **UI 代行队长职权的边界裁决**：R1.7 只有队长能 `create`/accept。若要 UI 建任务/改派，
   需明确「UI 以队长身份落审计」还是「UI 动作仅限 claim 外的观察 + 审批」。
   ⚠️ 权限矩阵变更，需用户拍板。

---

## 附录 A：编码 Agent GUI/TUI 编排器调研（Vibe Kanban / Conductor / Sculptor / Claude Squad / claude-swarm）

### A1. Vibe Kanban（BloopAI/vibe-kanban）— Web 看板

> 状态注意：README 顶部横幅宣布「Vibe Kanban is sunsetting」，将转为开源社区维护。形态：`npx vibe-kanban` 启动的本地 Web 应用。

- **创建/启动**：按项目建看板；顶部加号或快捷键 `c` 建任务，「Create Task」（只建卡）与「Create & Start」（建卡并立即用默认 agent 开跑）二选一。任务=标题+描述+`@` 标签。agent 配置在**每次开跑（attempt）时选**：agent profile（CLAUDE_CODE / GEMINI / CODEX…）、variant（DEFAULT/PLAN）、base branch；默认 profile 存在 Settings。每 attempt 自动建 worktree + 跑 setup script。另可经 MCP 从 Claude Desktop / Raycast / 其他 agent 批量建任务。
- **任务流**：核心是 **attempt（一次 agent 会话）驱动看板列自动迁移**：创建→To do；attempt 启动→In Progress；attempt 结束（成败均）→In Review；PR 合并→Done（GitHub 轮询，60 秒）。可手动拖拽但「不会触发任何功能」——拖拽仅是摆位，状态真相来自 agent 行为。子任务有独立生命周期且绑定到特定 attempt。没有「agent 认领」，是人选 profile 派活。
- **观察**：主面板流式日志（Reasoning / Commands / 文件操作 / 工具调用 / 回复），文件操作条目可展开看改动片段；「View Processes」列出 agent 会话、dev server、构建脚本的进程表；QA 视图内置浏览器（devtools / inspect / 设备模拟），日志与实时预览并排。
- **干预**：运行中随时发消息（Cmd/Ctrl+Enter）；支持审批的 agent（Codex 已支持，Claude Code「coming soon」）在动作行下出现 approve/deny 按钮；diff 行内评论直接作为反馈发给 agent；可**编辑历史消息**——会回滚 agent 到该点并重放（Claude Code/Amp/Codex/Gemini/Qwen 支持）；Shift+Tab 切 profile（如 PLAN→DEFAULT）。
- **灵活性**：同一任务可开新 attempt（换 agent / 换 base branch / 重置上下文）即「换人重做」；workspace 提供分支+终端+dev server；10+ 编码 agent 可切换；多人 issue tracker + 团队。
- **布局隐喻**：Web 看板（卡片自动流转）+ 点开卡片进「执行日志流 / diff / 浏览器预览」详情。

### A2. Conductor（conductor.build）— Mac GUI（闭源，交互模式公开文档可查）

- **创建/启动**：`Cmd+Shift+N` 或「New workspace」；起点可选分支 / GitHub PR / GitHub issue / Linear issue（issue fanout：一个 issue 一个 workspace）。每个 workspace 自动获得独立分支+工作树；仓库级 setup script / Repository Settings 一次性配置。官方哲学：「workspace 是委派单元，branch 和 PR 是集成单元」，鼓励「不要等一个 agent 跑完，继续开新 workspace」。
- **任务流**：**没有看板/派单**——侧栏就是 workspace 列表，任务在创建 workspace 时的 composer（聊天）里给；持久上下文（AGENTS.md、skills、Repository Settings）与任务上下文（chat、附件、`.context`）分层。
- **观察**：侧栏「See at a glance what they're working on」；单 workspace 内 chat / diff / 终端 / **Checks tab**（git status、CI、部署、评论、todos 聚合）；同 workspace 多 agent 用 tab 并列，跨 workspace 各自独立；可在 IDE 打开 workspace。
- **干预**：diff viewer（`Cmd+Shift+D`）支持**钉在变更行上的评论**、反馈直接回给 agent；GitHub review 评论也汇入并要求 resolve；「Review」动作让 agent 自审；`Cmd+Shift+P` 建 PR（AI 起草描述，还能替你回复 review 评论、修 failing checks）；工具按阶段**主动建议下一步**；会话级自主性旋钮：Plan Mode、Fast Mode、reasoning 强度、Codex Goals（`/goal` 目标条可暂停/编辑/清除，跨轮次持续生效）。
- **灵活性**：同一 workspace 可放多 agent（review/fix/test 分工）或多 workspace 探索后归档输家、「把有用上下文拷进赢家」；完成的 workspace **归档**且可从 History 恢复（含聊天记录）；Claude Code / Codex / Cursor / OpenCode 四种 harness 可换。
- **布局隐喻**：侧栏工作区列表 + 单工作区详情（chat / diff / terminal / checks）。

### A3. Sculptor（imbue-ai/sculptor）— 桌面 GUI

- **创建/启动**：连 repo → `+` 建 workspace（选仓库、源分支、分支名、可选 starter prompt）→ 直接 prompt agent。隔离默认 worktree，另有 Clone 与 In-place 模式；per-repo setup 命令、`~/.sculptor/.env` 在创建时生效；harness 可选 Claude Code / Pi / 任意终端 agent。
- **任务流**：无任务板。隐喻是「workspace + 会话 tab」：跨项目开多个 workspace（每个一个 tab），同项目协作则**在 workspace 内的 tab 条上加第二个 agent**（共享同一工作副本——官方建议错峰或分文件以免冲突）；内置 skills 把常见流程模板化。
- **观察**：chat 面板是主观察面；复杂任务自动成 todo 列表，显示「1 / 8」可展开看 pending/in progress/done；footer 显示「45% context」点击看 token 构成；左侧 Files 面板三 tab：Browse（文件树）/ **Changes（工作区累计未提交 diff，绿红高亮）**/ Commits；workspace 内置终端；会话（plans、chats、tool calls、代码改动）整体保存可重开。*注：调研委托中提到的「observer 观察者」在公开文档中无对应命名特性，未确认。*
- **干预**：随时在 chat 里发 correction 纠偏（todo 随之更新）；Plan mode 需批准计划；effort 四档、Fast mode、model picker 每条消息可换；**Pairing Mode**：一键把 agent 容器里的工作同步到本地 repo 且双向同步——「agent sees your edits and comments in real time」，可以直接替它改；Changes 里按文件 discard、显式 Commit（不自动 push）；选择性合并，冲突可**交还给 agent 解决**。
- **灵活性**：会话级可加/切/停 agent（tab 条）；workspace 可删除（cleanup 策略 never / only when safe / always）；官方博客预告「Forking agents：从会话历史的任意点分叉出新 agent」（预告，未确认已上线）；容器隔离使依赖环境各自独立。
- **布局隐喻**：「工作区 tab」单窗口：左侧文件三面板 + 中央 chat + 底部 agent tab 条 + 终端。

### A4. Claude Squad（smtg-ai/claude-squad）— TUI

- **创建/启动**：`cs` 启动 TUI；`n` 新建实例、`N` 新建并带 prompt；`-p` 指定程序（codex / aider / gemini）；`-y/--autoyes` 全自动接受；命名 profile 写在 `~/.claude-squad/config.json`；v1.0.17 起建会话时可选源分支。每个实例 = tmux 会话 + git worktree 独立分支。
- **任务流**：**没有任务概念**——就是会话列表；任务即创建时/attach 后敲的那条 prompt，用户手动一对一派。
- **观察**：会话列表 ↑/↓ 导航；`tab` 在 **preview tab（实时终端预览）与 diff tab（待应用改动）** 间切换；shift-↓/↑ 在 diff 里滚动；v1.0.16 增加 Terminal tab（交互式 shell 直录）；tmux 鼠标模式开启。
- **干预**：`↵/o` **attach 进 tmux 完全接管**并 reprompt（= 直接替 agent 干活的最强形式），`ctrl-q` 脱离；`s` commit+push；`c` **checkout = 提交变更并暂停会话**，`r` 恢复；`D` 杀掉会话；`-y` 完全放手。
- **灵活性**：任意实例可暂停/恢复/删除/重建；`Shift+J/K` 重排顺序；v1.0.20 支持恢复「tmux 会话死了」的实例；多实例并行纵向列表呈现。
- **布局隐喻**：终端会话列表 + 每个实例带（预览 / diff / 终端）三标签页。

### A5. claude-swarm（parruda，Ruby gem）→ 后继 SwarmCLI v2

> 状态注意：原仓库 `parruda/claude-swarm` 于 2025-12 改名 `parruda/swarm`，当前 GitHub 已 404（删除或转私有，未确认）；gem `claude_swarm` 最新公开版 v1.0.11（2025-11-28）。

- **创建/启动（v1）**：**纯启动前声明式 YAML**——`claude-swarm init` 生成 `claude-swarm.yml`（也可 `claude-swarm generate` 让 AI 帮写配置）：`swarm.main` 指定 lead，每个 instance 定义 description / directory / model / prompt / allowed_tools / connections / mcps / `vibe: true` / worktree / provider / hooks，支持 `${VAR}` 插值与 YAML anchors。运行后**主实例以交互式 Claude Code 会话出现在你的终端**，各 worker 作为独立 Claude Code 进程、以 MCP server 形式暴露（task / session_info / reset_session 三个工具）供 lead 委派。
- **任务流**：无卡片无列表——**层级拓扑即组织架构图**（lead 在中间，connections 形成树）；你只对 lead 说话，lead 拆解并经 MCP `task` 工具委派；不存在认领/拖拽。
- **观察**：终端里只直接看到 lead 的会话；worker 靠 CLI 监控命令：`claude-swarm ps`（运行中会话 + 成本/运行时长）、`watch <id> -n 50`、`show <id>`、`list-sessions`；落盘 `session.log`（JSONL）。
- **干预**：对 lead 插话即 steer；per-instance `reset_session` 重置某 agent；`claude-swarm restore <id>`（实验性）恢复会话——文档承认 lead 的对话上下文不能完整恢复；worker 可直接进其 directory 操作。无审批队列概念（权限靠 allowed_tools / vibe 预先划定）。
- **灵活性**：**拓扑在启动时冻结**，运行中加/删实例无文档支持（未确认）；多 swarm = 多个独立会话目录；v1.0 起支持混合 provider。
- **v2（SwarmCLI）转向**：彻底换隐喻——所有 agent 跑进**单进程**（RubyLLM，方法调用替代 MCP IPC），`swarm run x.yml` 是 **TTY REPL 对话**或一次性脚本；YAML v2 用 `delegates_to` 声明委派权、12 种 hook 事件、node 多阶段流水线（`depends_on`）、SwarmMemory 持久记忆 + 成本追踪。观察从「多终端」收敛为「单会话 + 结构化日志」。
- **布局隐喻**：v1：YAML 组织架构图 + 终端里的 lead 会话（worker 是后台 MCP 进程）；v2：单 REPL 会话。

---

## 附录 B：平台仪表盘调研（AutoGen Studio / OpenHands / CrewAI / LangGraph Studio / Omnara）

### B1. AutoGen Studio（microsoft/autogen · studio 子包）

- **定位**：基于 AutoGen AgentChat 的低代码 Web 界面，官方明确「面向原型验证，非生产应用」。2025 年起 AutoGen 转社区维护，AGS 于 2025-01 在 v0.4 API 上重写。
- **创建/启动**：**Team Builder 双模编辑**——同一团队既可用**声明式 JSON**（兼容 AgentChat 组件定义）定义，也可**拖拽**组装；可配置 teams / agents / tools / models / termination conditions 五类组件。**Gallery** 作为社区组件发现与导入中心。
- **任务流**：Playground 中 agent 间消息**实时流式呈现**，并有一张**控制转移图（control transition graph）**可视化消息在 agent 间的流向。
- **观察**：run 结果保存到历史，可回看**每条消息的 token 用量与耗时**、turn 数、tool 调用与代码执行结果；产物（图片/代码/文档）可在会话中查看。
- **干预**：运行控制为 **pause / stop**；通过 **UserProxyAgent** 与团队交互式对话（用户以 agent 身份进入循环）。无 node 级断点重跑（未确认）。
- **灵活性**：团队配置可导出为 **Python 代码**、部署为 Docker 容器/HTTP endpoint；v0.4.1 起支持 **live editing**（改完即测）。运行中改团队构成：未确认。
- **布局隐喻**：低代码 IDE——左「装配」（Team Builder 拖拽/JSON）、右「试驾」（消息流 + 控制转移图）+ 组件 Gallery。

### B2. OpenHands（All-Hands-AI，原 OpenDevin）

- **定位**：AI 编码 agent 平台。两代 UI：legacy GUI（已弃用）与 2025-2026 的新客户端 **Agent Canvas**。
- **Legacy 事件流**：所有 agent 动作/观察都是事件；UI 为 **chat 面板（事件流 + 确认提示）+ 工作区标签页（文件编辑器 / 浏览器 / 终端 / Jupyter）**。**Confirmation mode** 下每个可执行动作暂停在 chat 中等待批准/拒绝。
- **Agent Canvas 创建/启动**：对话式启动（composer 支持语音输入）；通过 **ACP 协议**接 Claude Code / Codex / Gemini CLI / OpenHands agent；顶部 header 一键切换 **local / VM / Cloud 多 backend**；每个 conversation 绑定独立 workspace（**git worktree 隔离**），支持**多 agent 并行**；子任务委派走 `launch_child_conversation`，子会话结果回传父会话。
- **任务流**：chat 内**阶段分组（stage groups）**——完成阶段折叠为句子式摘要（"Ran a command, ran a hook" / "Read a file"），运行中步骤显示在组头部，步骤间显示 **"Thinking"**；model reasoning 收进 step details 内层。
- **观察**：**Files drawer**（文件树 + 多标签 + Markdown 内联预览 + 图片 lightbox）；**Commits drawer**（git 变更/分支/commits/PR 聚合，可一键向 agent 发 commit/pull/push/PR 指令）；composer 上的 **context meter** 显示 context window 占用，可手动 "Compact context"。
- **干预**：`/goal --max N` 循环运行时**发普通消息即打断并收回控制权**；**"Branch from here"** 在任意消息上 fork——对自己消息等同 edit-and-resend，对 assistant 消息则携带至该回复的历史；发送失败的消息可 Retry/Dismiss。
- **灵活性**：分支可再分支、独立命名、原会话保留；Automate 视图管理 **cron / 轮询 / 事件驱动自动化**（含 GitHub webhook）；会话归档不删除、可恢复。
- **布局隐喻**：自托管的「工程团队指挥中心」——左侧会话列表 + 中央 chat 流 + Files/Commits 抽屉，多 backend 多会话并行。

### B3. CrewAI（开源框架 + CLI vs. 闭源 Enterprise/AMP Studio）

**开源侧（Python 框架 + `crewai` CLI）**
- **创建/启动**：代码 + 配置文件。新版脚手架 `crewai create flow` 生成 **JSONC 配置**（agents/crew 各一份，`{topic}` 变量由 `kickoff(inputs=...)` 填充）；团队构成是**静态声明**，不是拖拽。
- **任务流**：终端即 UI——`crewai run` 打印 flow 与 crew 日志，产物落盘。sequential / hierarchical / hybrid 三种过程；**hierarchical 由 manager agent 按角色与可用性动态派活**。
- **干预**：任务设 `human_input=True` 时，任务完成后**终端暂停**，提示对 Final Result 与 agent 行为给出反馈（反馈触发 agent 精炼一轮，回车即批准继续）。
- **观察/导出**：开源侧无官方 UI；观测靠内置 **tracing**（OpenTelemetry 上报，首次运行终端询问是否分享）。

**Enterprise / AMP（闭源，app.crewai.com）**
- **创建**：**no-code 可视化编辑器**（可导出 Python），与代码优先 API 并存；`crewai deploy push` 把开源项目桥接上云。
- **观察/干预**：控制平面 **Traces 标签页**呈现 agent 决策、任务执行时间线、tool 调用、LLM 调用、token/成本指标；时间线可点击下钻、可导出；trace 中含 **HITL pause/resume 链接**。
- **布局隐喻**：开源=纯终端 REPL；闭源=云控制台（左侧项目 → Traces/Metrics/Triggers 仪表盘）。

### B4. LangGraph Studio（LangChain，2025+ 更名 LangSmith Studio）

- **定位与形态**：「第一个 agent IDE」。2024-08 以 macOS 桌面应用发布，官方现已建议改用**网页版**，连接本地 `langgraph dev` 或 LangGraph Platform 部署。
- **创建/启动**：图**在代码里定义**，Studio 不画图编排——但 `langgraph dev` **热重载**（改 prompts / tool signatures 即时反映到 UI）。输入区按图的 **state schema 自动生成表单**，可切 "View Raw" 变 JSON 编辑器；上/下箭头翻历史输入。
- **双模式**：**Graph mode**（完整执行视图）与 **Chat mode**（轻量对话，可折叠 tool calls）。
- **任务流/观察**：中央是**交互式图**，运行沿节点推进；每步可见 prompt、tool calls 与返回值、最终输出；右侧 **thread 历史面板**，顶部**细节粒度滑杆**，turns/nodes/state keys 可折叠，Pretty ↔ JSON 双渲染。
- **干预（interrupt 是头等交互）**：点 **Interrupt** → 选节点 → 选 **before/after** 暂停；输入面板呈现状态，**thread log 里点 Continue 恢复**；随时 Cancel。
- **灵活性**：checkpoint 上 **"Re-run from here"** 从任意检查点分叉新 run；**"Edit node state"** 直接改节点输出后 **Fork**；Chat mode 中可编辑自己的历史消息再提交（分叉对话）、retry AI 回复；**Manage Assistants** 切换/版本化运行配置；多 thread 管理。
- **布局隐喻**：三栏「图调试器」——左输入/控制、中交互式状态图、右 thread 历史检查器。

### B5. Omnara（omnara-ai/omnara · YC S25）

- **定位**：开源 agent command center（自称「开源版 Claude Managed Agents」），核心卖点 **terminal ↔ web ↔ mobile 三端无缝接管**。
- **创建/启动（多入口）**：CLI `npx omnara` 或 **YAML 配置** + 初始消息；SDK/REST API；**Slack/Discord @bot** 在线程中启动；**GitHub 事件触发**；**cron 定时**；MCP client 接入。Claude Code wrapper 通过解析 `~/.claude/projects` session 文件镜像原生体验，经 SSE 实时上传。
- **任务流**：**turn 制事件时间线**——`agent_input` → `model_output · streaming` → `tool_result run_command · succeeded ✓`，带 token 数与时间戳；故障有 `LLM call failed → resumed · state restored` 的恢复记录。
- **观察**：web dashboard 显示 agent 组织路径、**sandbox 机器面板**（running / sleeping / creating 状态）、每会话 tool call 流与回复输入框；每步持久化到 Postgres 可回放。
- **干预（审批是核心交互）**：**每个 tool 三档权限**——直接执行 / 先问人 / 禁止；命中审批时 agent 暂停，**iOS push notification** 推送权限卡片（显示完整命令 + **Allow/Deny** 按钮），手机上一键批、可先看 logs 与 git diff；审批落 **#approvals 频道**与审计记录。
- **接管/热改**：agent 运行中**随时插话**；**live steering**——运行中改 model / tools / permissions / instructions，下一次 model call 生效、无需重启；subagent 可被检视并注入新指令。
- **布局隐喻**：跨端指挥所——web 端 agent 列表 + 会话时间线，移动端 = 推送 + 审批卡片，终端与任一端即时续接。

---

## 附录 C：终端原生 CLI Agent 的团队/审批交互调研（Claude Code teams / Codex / Cline·Roo / Goose / Warp·Amp·Gemini）

### C1. Claude Code — Agent Teams（研究预览）

> 开启方式：`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`。lead 与 teammates 都是独立的 Claude Code 会话，lead 在用户自己的终端里；teammates 默认「in-process」跑在同一个 TUI 内，也可选 tmux / iTerm2 分屏。

- **teammates 状态显示**：lead 会话的提示词输入框下方有一个「agent panel」，每个 teammate 一行；方向键上下选择，`Enter` 打开其 transcript。空闲行 30 秒后自动隐藏（该 teammate 仍在运行、仍可被点名），其下一轮开始时重现；空闲超过 3 个时多余行折叠成一行「`2 idle agents`」，`Enter` 展开、`Esc` 再折叠；working / failed / 正在查看的 teammate 永远保留自己的行。
- **审批交互**：teammate 的权限请求**上浮（bubble up）到 lead 会话行内呈现**，官方原话 "Teammate permission prompts appear in the lead session, so approve them there yourself"。spawn 时没有 per-teammate 权限模式——新 teammate 继承 lead 当前模式；plan 模式 teammate 的计划默认自动批准，除非用户用 `Shift+Tab` 手动把它放进 plan 模式。没有独立审批队列、没有批量审批。
- **实测摩擦（GitHub #26479）**：teammate 即便 `bypassPermissions` 也会逐条弹 Bash 审批；lead 里积累的 100+ 条 "always allow" 规则不被 teammates 继承；点了 "Yes, and always allow" 也不持久化；部分 Write/Edit 请求「`Permission request sent to team lead`」后**无限阻塞、lead 侧根本收不到可操作的提示**。多 teammate 下用户每会话要点几十次批准——这是该功能最大的 UX 痛点。
- **插话 / steer**：lead 自己的会话遵循全局约定——`Enter` 把输入排队（灰色显示），`Ctrl+Enter` 立即发出队列，`Up` 从输入框首行取回队列编辑/撤销，`Esc` 打断当前 turn。**查看某个 teammate 时**，纯文本与 skills 发给该 teammate，`Esc` 直接打断它的当前 turn；但内置命令（`/compact` `/clear` 等）仍归 lead（带确认框），`/model` 直接拒绝执行。
- **关停**：优雅关停 = 用自然语言让 lead 转达，teammate 可以接受或拒绝，且要等它做完手头工作，可能很慢；强杀 = 选中后按 `x`。tmux 模式杀不干净时用户要手动 `tmux kill-session`。
- **查看 transcript / 切换**：方向键选中 → `Enter` 查看；`Ctrl+T` 切换共享任务列表视图。分屏模式下直接点进 teammate 的 pane 交互。**局限**：teammates 无法用 `/resume` / `/rewind` 恢复；每会话只允许一个 team，lead 角色不可转移。
- **通知**：teammate 空闲/失败会自动通知 lead 并附最终答案/错误文本；有 `TeammateIdle` / `TaskCreated` / `TaskCompleted` hooks 可做质量门（exit code 2 可把反馈打回让 teammate 继续干）。

### C2. OpenAI Codex CLI

- **审批呈现**：两轴组合——**sandbox 模式**（`read-only` / `workspace-write` / `danger-full-access`）× **approval policy**（`on-request`：模型自行判断何时请求批准，当前推荐默认；`on-failure`：沙箱内先跑，失败才问；`never`：无人值守用；`untrusted` 已退役）。推荐预设 "Auto" = `workspace-write + on-request`：工作区内自动干，出沙箱/联网/破坏性 MCP 工具调用才问。
- **切换方式**：会话内 `/permissions` 斜杠命令；启动时 `--ask-for-approval` / `--sandbox` flag；持久化在 `~/.codex/config.toml`。
- **审批对话框**：官方文档未给出终端内对话框的逐字 UI（未确认），但确认了「inspect the active sandbox and writable roots before you continue」。**值得注意的新设计**：`approvals_reviewer = "auto_review"` 可把审批请求先交给一个 AI reviewer（查数据外泄、凭据探测、持久性安全弱化、破坏性操作），低/中风险放行、critical 直接拒绝、high-risk 转给用户，失败即 fail-closed；桌面端显示 "Reviewing / Approved / Denied / Aborted / Timed out" 状态与风险等级——即「审批代理化」。
- **插话 / steer**：运行中状态行显示 "Working (3m 06s • esc to interrupt)"；`Esc` 打断当前 turn（保留已完成部分）。运行中输入会**排队**；多 agent 模式下 `Tab` 专门用于排队消息。已知痛点：用 `/agent` 切去 sub-agent 再切回来时排队消息会丢；`Esc` 打断后偶发后续输入报错。
- **多 agent 呈现**：subagents 是「delegate focused work to specialized agents, then bring their findings back into the main terminal session」——主会话保持单一焦点，无 teammate 面板/分屏（未确认有并行多窗格视图）。
- **其他状态面**：composer 状态行含 context 余量「100% context left · ? for shortcuts」；`/review` 有编号预设菜单。

### C3. Cline / Roo Code（VS Code 插件，图形化对照组）

> 两者同源。终端 CLI 没有的「富审批面板 + 每步按钮」在这里体现得最完整，对 Neeko 的桌面 UI 最有参照价值。

- **逐条审批**：每次文件编辑/命令/浏览器动作在聊天流中出一条卡片式审批条，带 **Approve / Reject 按钮**；**终端命令在批准前可直接编辑命令文本**再点 "Run Command"——「改命令再放行」是最细粒度的接管。拒绝时可附带说明让模型换路。
- **Cline Auto Approve**：按类别勾选——Read project files / Read all files / Edit project files / Edit all files / Execute safe commands / Execute all commands / Use the browser / Use MCP servers / Enable notifications；后一档依赖前一档开启。**没有固定 allowlist**——由模型给每条命令打 `requires_approval` 标记。OS 级通知：需要批准或命令跑超 30 秒时弹系统提醒。
- **YOLO 模式**（Cline）：一键全放行，**连 Plan→Act 模式切换也自动确认**。
- **Plan / Act 切换**（Cline v3.2+）：聊天面板底部一个 toggle，Plan 模式只读架构师，用户审完切 Act 才动手；模式切换本身默认也要批准（Roo 的 "Switch modes" 是独立审批类别）。
- **Roo Code 审批面板**：下拉网格，每个权限瓷片带风险等级——"Read files and directories"(Medium)、"Edit files"(High)、"Execute approved commands"(High)、"Use the browser"(Medium)、"Use MCP servers"(Medium-High)、"Switch modes"(Low)、"Create & complete subtasks"(Low)、"Answer follow-up questions"(Low)；底部 `Enabled` 主开关 + `All / None` 批量 chip；快捷键 Cmd/Ctrl+Alt+A。命令层有 **allow/deny 前缀清单**（最长前缀匹配、deny 优先、shell 替换注入守卫，建议 deny `rm`/`sudo`/`git push`…）；追问类提示可设 1-300 秒超时自动选第一项。
- **subtask / subagent 呈现**：Roo 的 Boomerang Tasks（Orchestrator 模式）把子任务以**可折叠块嵌在父任务历史里**，子任务完成摘要回流给 orchestrator 审核后才算完；每个子任务独立上下文。Cline 的 `new_task` 是**顺序栈式交接**（父任务压栈、新任务带结构化摘要启动）+ Focus Chain 进度链；v3.58 才引入实验性**并行原生 subagents**（中止父任务会连带取消它派生的 subagents；用户自定义 sub-agent 只需批一次委派，之后免逐条审批）。

### C4. Goose（Block）

- **四种 permission mode**：Completely Autonomous（**默认**，免批改文件/删文件）、Manual Approval（所有工具调用前确认）、Smart Approval（按风险分级：低风险自动过、高影响拦下来）、Chat Only（纯对话不动文件）。
- **审批呈现**：Manual / Smart 模式下，工具调用时界面出现 **Allow / Deny 按钮**；只对被归类为「写」的工具询问（读写分类由 LLM provider 尽力判断，不是确定性规则）。第三方 CLI provider（如 Claude Code）的审批请求**会被路由进 goose 自己的 UI**，用户的 Allow/Deny 决定回传给 provider。
- **切换**：会话内 `/mode auto|smart_approve|approve|chat` 即时切换；`goose configure` 持久化；桌面端 Settings → Chat → Default Mode（只影响新会话）。粒度规则在 "Tool Permission" 菜单配（仅 Manual/Smart 生效）。
- **session 管理**：`goose session --name <name>` 命名会话、`--resume` 恢复、`goose session list` 列表；同一 session ID 可在 CLI 与桌面端之间换客户端续聊——「会话是可迁移资产」。

### C5. 补充：Warp / Amp / Gemini CLI

- **Warp（多 agent 汇聚层）**：把 Claude Code / Codex / OpenCode / Gemini CLI / Warp Agent 各放进一个 tab/pane（推荐垂直 tab），**tab 上直接显示元数据**：正在跑哪个 agent、当前 git branch、工作目录、状态（active / waiting for input / idle）；**需要输入的 tab 有 attention 指示器**，点击跳转。agent 要权限或要批准 diff 时发系统通知。另有 Agent Management Panel——跨 tab 汇总「所有活跃 agent 的 running / waiting / finished」仪表盘，tab 可上色区分。
- **Amp**：插话设计反主流——**默认发送即打断**，`Shift`+提交才是排队（2025-06 上线）。无传统的逐命令审批 gate（`amp.permissions` allow/deny/ask 规则链的 UI 细节未确认）；主打云端 orbs：每 thread 一台云机器，关笔记本继续跑，Mac/iOS/Android 客户端共享同一 agent 会话——「审批前置到规则、运行时零打扰」。
- **Gemini CLI**：确认对话框选项最全——**"Yes, allow once" / "Modify with editor"（批准前改命令）/ "No (esc)" / "Always allow"**（本会话或按命令模式记忆）；`Shift+Tab` 循环 Default → Auto-Edit → Plan（YOLO 用 `--yolo` 单独开，不进循环；`security.disableYoloMode` / `disableAlwaysAllow` 可被管理员锁死）。Plan 审批给出两档："Yes, automatically accept edits" / "Yes, manually accept edits"；`Ctrl+X` 把 plan 文件丢进外部编辑器改。0.61.0 起改构建配置文件、跑构建/测试命令强制二次确认。

---

## 附录 D：各报告原始引用 URL

**附录 A（编码编排器）**
- Vibe Kanban：https://github.com/BloopAI/vibe-kanban · https://www.vibekanban.com · https://vibekanban.com/docs/core-features/creating-tasks · https://vibekanban.com/docs/core-features/monitoring-task-execution · https://vibekanban.com/docs/core-features/new-task-attempts · https://vibekanban.com/docs/core-features/subtasks
- Conductor（闭源）：https://conductor.build · https://conductor.build/docs · https://conductor.build/docs/concepts/workflow · https://conductor.build/docs/concepts/parallel-agents · https://conductor.build/docs/concepts/agent-modes · https://conductor.build/docs/reference/diff-viewer
- Sculptor：https://github.com/imbue-ai/sculptor · https://imbue.com/blog/sculptor-announce · docs/help/{chat,agents,changes,workspaces}.md（raw.githubusercontent.com/imbue-ai/sculptor/main/docs/help/）
- Claude Squad：https://github.com/smtg-ai/claude-squad · https://github.com/smtg-ai/claude-squad/releases
- claude-swarm / SwarmCLI：https://parruda.net/posts/claude-swarm-how-ai-agent-teams-can-handle-your-multi-repo-reality · https://rubygems.org/gems/claude_swarm · https://www.claudemod.com/mods/claude-swarm

**附录 B（平台仪表盘）**
- AutoGen Studio：https://microsoft.github.io/autogen/dev/user-guide/autogenstudio-user-guide/index.html · https://microsoft.github.io/autogen/stable//user-guide/autogenstudio-user-guide/usage.html · https://arxiv.org/abs/2408.15247 · https://microsoft.github.io/autogen/0.2/blog/2023/12/01/AutoGenStudio
- OpenHands：https://www.openhands.dev/product/canvas · https://docs.openhands.dev/usage/about · https://docs.openhands.dev/openhands/usage/agent-canvas/overview · https://docs.openhands.dev/openhands/usage/agent-canvas/conversations · https://docs.openhands.dev/openhands/usage/agent-canvas/managing-automations · https://github.com/All-Hands-AI/OpenHands/issues/2308 · https://arxiv.org/abs/2407.16741
- CrewAI：https://docs.crewai.com/quickstart · https://docs.crewai.com/en/concepts/tasks · https://docs.crewai.com/edge/en/observability/tracing · https://www.crewai.com · https://www.crewai.com/enterprise
- LangGraph Studio：https://docs.langchain.com/langsmith/use-studio · https://docs.langchain.com/oss/python/langgraph/studio · https://docs.langchain.com/oss/python/langgraph/interrupts · https://blog.langchain.dev/human-in-the-loop-langgraph-interrupt/ · https://blog.langchain.dev/langgraph-studio-the-first-agent-ide/
- Omnara：https://github.com/omnara-ai/omnara · https://www.omnara.com · https://www.ycombinator.com/launches/OCT-omnara-the-first-command-center-for-ai-agents-terminal-web-and-mobile

**附录 C（终端原生）**
- Claude Code Agent Teams：https://code.claude.com/docs/en/agent-teams · https://code.claude.com/docs/en/interactive-mode · https://github.com/anthropics/claude-code/issues/26479
- Codex CLI：https://learn.chatgpt.com/docs/codex/cli · https://learn.chatgpt.com/docs/agent-approvals-security · https://github.com/openai/codex/issues/39973 · https://github.com/openai/codex/issues/16173
- Cline / Roo Code：https://docs.cline.bot/features/auto-approve · https://docs.cline.bot/features/new-task-tool · https://docs.roocode.com/features/auto-approving-actions · https://docs.roocode.com/features/boomerang-tasks
- Goose：https://goose-docs.ai/docs/guides/managing-tools/goose-permissions · https://goose-docs.ai/docs/guides/goose-cli-commands
- Warp / Amp / Gemini CLI：https://docs.warp.dev/guides/agent-workflows/how-to-run-multiple-ai-coding-agents · https://ampcode.com/news/queued-messages · https://ampcode.com/manual#permissions · https://geminicli.com/docs/cli/plan-mode · https://geminicli.com/docs/cli/settings
