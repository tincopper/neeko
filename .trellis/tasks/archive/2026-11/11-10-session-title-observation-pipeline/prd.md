# 会话标题观测通道编排重构

## Goal

把「会话标题怎么来」从**每个 CLI 各自解析**改造为**一层事实阶梯 + 一条身份脊柱 + N 行数据**：
任一 CLI 的存储布局或 hook 载荷字段变化，不得再表现为「用户侧标题静默消失」。

直接症状：claude / codebuddy / qoder 三源在侧栏与历史列表里没有标题（qoder 一条都没有、
codebuddy 只有 `codebuddy 111d0e39` 这种兜底串、claude 部分标题是 `<local-command-caveat>` 噪声）。

## Background

三个 CLI 共享同一条 Claude 兼容 hook 面（`CLAUDE_COMPAT_ENTRIES`），因此共享同一个结构性缺口：

- 标题只有两条来路（`live_sessions/wiring/hooks.rs:114`）：hook 上报的 `topic`，或 conversation
  内存缓存回落（`conversation/manager.rs:991`，仅在打开过 History 后才 hydrate）。
- hook `topic` 对三源恒为 `null`：shim 只认 Codex 系字段名（`neeko-report.mjs:129`），而三源共用的
  事件表只有 `PermissionRequest` / `Stop` / `StopFailure`，唯一携带 prompt 的 `UserPromptSubmit` 未安装。
- 缓存回落对 qoder / codebuddy 结构性命中不了：adapter 指向的存储位置早已过期（`~/.qodercli/projects`、
  `~/.codebuddy/sessions/*.json`），真实数据在 `~/.qoder/projects/<proj>/<uuid>.jsonl`、
  `~/.codebuddy/projects/<proj>/<uuid>.jsonl`。
- 「空标题」是可表示状态（`TitleSource::Placeholder` 的 `admit` 恒 `None`），下游分裂成三种行为：
  侧栏不列行（`liveSessionSelectors.ts:103`）、行内无标题、前端各自编兜底（3 处，红线 17 影子副本）。

完整证据（命令 + 实测输出 + 索引实况）见 `research/current-state.md`。

## Requirements

- **R1（单一判据）**：全仓只有一个「这串字配不配当标题」的判据 —— `common::agent::title::admit`
  （2026-11-10 起落在中立域：`conversation` 也要用，而它不能反向依赖 `live_sessions`）。
  适配器只产出原始候选（`TitleCandidate::{CliNative, Prompt}`，由 `ParsedMeta::title_candidates()`
  按质量序给出），历史列表与实时侧栏都经 `admit_candidates` 取值，不得自己挑；
  `conversation::normalize` 的 Title 目标已删除（只剩 Preview），两套判据收敛为一套。
- **R2（标题永不空）**：任一会话在任何时刻都返回非空、可解释的标签。`Placeholder` 承载身份事实
  （agent + 项目/cwd 名 或 `agent #序号`），不再是空串；标题阶梯单调升级（User > CliNative > Prompt > Placeholder）。
- **R3（可见性 = 用过 + 有真标题）**：侧栏列出一条会话的条件是 `hasUserInput` + **有真标题**
  （`titleSource ≠ placeholder`）。**不看回合数** —— 定案是「拿到标题就出现」：
  打开 CLI 不出行；用户提交指令、标题到手的那一帧出现。
  占位标签（`claude-code · neeko`）只是「任何界面都有字可读」的兜底（tab / 历史列表），
  不能当进列表的许可 —— 否则一条没有信息量的行会常驻侧栏。
  （修订记录：① M0 曾整条删掉「有真标题」的判据，因为那时三源拿不到标题；M1 修好观测后恢复。
  ② 恢复时同时**删掉**了「首轮已结束」这一条与 `native|user` 直通特例 —— 删掉回合数依赖后
  特例失去存在理由，回填行 `turnCount` 不落盘的问题也一并消失。）
- **R4（身份脊柱）**：一个 CLI 的五个事实（provider id / hook source / 配置目录 / 转录布局 / prompt 观测）
  只允许出现在**一张** `AgentDescriptor` 表里；`HOOK_TARGETS`、ingest 白名单、conversation 注册、
  设置页、测试夹具全部从该表派生。
- **R5（CLI 差异落数据）**：新增/修复一个 CLI = 加一行数据 + 一个真实样本夹具；判据函数、shim 主体、
  前端组件零改动（红线 15 的通用形态）。
- **R6（推送优先，拉取只富化）**：实时标题来自事件（用户改名 / Neeko 自己发出的 prompt / CLI hook），
  转录扫描只做历史富化；不得要求用户「先打开 History」才能看到实时标题。
- **R7（漂移可见）**：每个 agent 有可观测的健康度（roots 是否存在 / 扫到文件数 / 提取到标题的比例 /
  拒绝原因 top-N），且真实样本夹具探针进 CI。任一 CLI 改布局 → 红灯或告警，不得静默变成「0 条会话」。
- **R8（范围）**：不改写 Upstream CLI 的文件，不写任何未被支持字段的 hook 信任哈希，不代写 CLI 配置
  （沿用 `agent-hooks-domain.md` 的既有边界）；不改终端渲染/布局。

## Acceptance Criteria

- **AC1**：新接一个 CLI 的 diff 只含 `AgentDescriptor` 一行 + 一个夹具 + 一条注册；
  `git diff --stat` 中不出现 `title/judge.rs`、`neeko-report.mjs`、任何 `src/features/**` 标题组件。
- **AC2**：`resolve_title`/快照路径对「无任何来源」的会话返回非空标签；存在 `title == ""` 的快照
  被断言为不合法（变异测试：把 Placeholder 改回空串 → 用例转红）。
- **AC3**：qoder / codebuddy 的历史列表出现真实标题（各自的真实样本夹具断言「至少 1 条标题
  不是兜底串 `agent <id8>` 且不含 `<local-command-caveat>`」）。
- **AC4**：claude / codebuddy / qoder 三源在 hook 上报后**无需打开 History** 即得到标题
  （回归用例：registry 空缓存 + 一条带 prompt 的 hook 事件 → 标题非占位）。
- **AC5**：健康度可见：任一 adapter 的「roots 不存在 / 找到 0 文件」出现在一处可读信号里
  （评估后选：日志 warn + 设置页一行 + `ScanReport` 字段），并有单测固定口径。
- **AC6**：前端标题兜底只剩 0 处（`conversationTabTitle` 的 `agentId` 兜底、`SessionListRow` 的
  `fallbackLabel`、`ConversationItem` 的 `meta.title` 空判一并清理），渲染层只消费后端字符串。
- **AC7**：`pnpm check:quick` 绿；新增判据单测覆盖正常/边界/错误三面（TDD：先红后绿）。

## Out of Scope

- 不做标题「生成」（不调模型摘要、不做语义改写）：本任务只保证观测不丢、判据唯一。
  将来若要 AI 标题，它是阶梯上新增的一级（`TitleSource` 新 variant），不是本任务。
- 不恢复 OSC 标题通道（已在第 35/37 轮证伪）。
- 不动终端/侧栏的视觉与布局（只动「标题字符串从哪来」）。
- 不接管 Codex 的 `hooks.json` 信任门（不可反推，保持现状）。

## 交付批次（同一任务内的三个里程碑，不拆子任务）

三批共用一个任务、一条分支、一次 `check:quick`：它们不可并行，也不宜各自 archive，
拆子任务只会多出三份清单要维护。

| 批次 | 交付 | 对应 R/AC | 独立性 |
| --- | --- | --- | --- |
| M0 | 标题永不空 + 可见性解耦 + 前端去兜底 | R2, R3, AC2, AC6 | 单独可上线（消症状） |
| M1 | `AgentDescriptor` 单表 + 三源 adapter/hook 修复 + 单一判据 | R1, R4, R5, R6, AC1, AC3, AC4 | 需要 M0 的标签非空才可用侧栏观察 |
| M2 | 标题落库 + 观测健康度 + 真实样本夹具探针 | R7, AC5 | 需要 M1 的 descriptor 作枚举源 |

顺序 M0 → M1 → M2，每个里程碑一次 commit（回滚粒度见 `design.md` §7）。
