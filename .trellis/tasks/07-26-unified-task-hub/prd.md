# 统一任务中心（Work Hub）

## Goal

设计一个可扩展的 **任务管理主题页面**，将 GitHub/GitLab 的 PR、Issue，以及 Linear、Jira 等需求/工作项统一为「任务（Work Item）」进行浏览、筛选、处理与打开详情；通过 **Provider 插件式扩展** 接入新平台，而不是为每个平台复制一套面板。

本任务阶段：**产品/信息架构/交互设计 + 原型**，不实现业务代码。

## Product positioning

- Neeko 是 **IDE 级 AI Agent 工作台**，任务中心应服务「当前项目 / 当前人」的开发闭环
- 与现有能力边界：
  - 现有 `features/task` = **可运行脚本/控制台**（npm/cargo 等）→ 产品 UI 定名 **Launch**（启动配置；中文「启动」）
  - 现有 `PullRequestsPanel` = **GitHub PR 列表**（gh CLI）→ 应收编为 Provider 之一
  - 新域 = **Work Items**；产品导航定名 **Tasks**（不叫 Work）

## Naming（已拍板）

| 角色 | 产品文案 | 代码域 | 说明 |
| --- | --- | --- | --- |
| PR / Issue / Linear / Jira… | **Tasks** | `WorkItem` | 可处理工作项列表；侧栏/面板用 Tasks |
| 脚本 / 命令 / 可扩展启动项 | **Launch** | 现 `TaskConfig`/`TaskRun`，可分期 `LaunchConfig` | 启动进程/工具，不是待办 inbox |
| AI 会话执行者 | **Agent** | 现有 agent 域 | 与 Tasks / Launch 并列 |
| 派给团队的一次执行 | **团队任务** | `TeamTask`（**已实现**：`src-tauri/src/agent/team/`） | 队长写板；不是 WorkItem，不并入 Tasks 看板 |
| 一次执行的编排形态 | **执行方式**：single / team / flow | `WorkItemRun.mode` | 三档共用 worker primitive，**完成判定各不相同**（§3.4） |

- **不采用** 侧栏名单字 `Work`（过宽，易与 workspace/worktree 混）
- **不采用** `Run` 作为脚本模块终名（可用作按钮进行时态 *Running…*；模块名用 Launch）
- 中文（**2026-11-01 修订**）：Tasks → **工作项**（侧栏英文仍 `Tasks`）；Launch → **启动 / 启动配置**；
  `TeamTask` → **团队任务**。**「任务」单独出现时只指 `TeamTask`**，工作项一律带限定语（本地工作项 / PR / Issue）
- **Stage vs Flow**：人侧进度轨叫 **Stage / 阶段**（Backlog→Done）；执行流程叫 **Flow / 流程**。
  两者都**禁止**再叫 `workflow` —— 旧文档与第 7 条里的 `workflow stage` 实现时按此改写

## Requirements

1. 统一抽象：PR / Issue / 需求 / Bug / 故事等均可映射为 Work Item
2. 统一列表体验：筛选、搜索、排序、分组、状态、指派人、标签
3. 详情与动作按 **类型 + Provider 能力** 扩展（不是一套死按钮）
4. Provider 可插拔：GitHub、GitLab、Linear、Jira… 注册即可出现
5. **Local Tasks 默认内置**：本地工作项无需第三方即可创建、维护、流转；作为默认 Provider 始终存在
6. **第三方 Provider 可选扩展**：GitHub / GitLab / Linear / Jira 需用户主动添加/连接，不作为默认显示
7. **状态流转可视化**：本地工作项支持自定义 **stage**（如 Backlog → Ready → In Progress → Review → Done），详情面板展示阶段轨道与可执行 transition
   （原名 `workflow stage`，2026-11-01 改名：`workflow` 一词留给执行流程以外的含义会造成撞车，见 Naming）
8. 与项目环境绑定：Local / WSL / SSH（及未来 Docker）下的仓库/工作区上下文
9. 与执行方式衔接：从工作项一键开 Agent 会话 / 派给团队 / 终端命令 / 打开分支或 diff
10. **看板首页（Board View）**：以卡片列式看板作为 Tasks 默认首页，直观展示所有工作项的状态分布与流转；支持 Board / List 视图切换
11. 命名消歧（强制）：产品 **Tasks** vs **Launch**；代码 **WorkItem** vs 现有 task runner 类型
12. 输出 design.md + 可交互 HTML 原型
13. **执行方式（Execution Mode）**：工作项可派生 `WorkItemRun`，`mode ∈ single | team | flow`；
    面板持有**意图 + 运行态视图**，执行器在 `WorkItemExecutor` 契约后面（详情见 design §3.4）
14. **执行阶梯不与看板合并**：single（一个 agent 会话）→ team（队长自主规划）→ flow（用户预先编排的固定流程），
    按「需要多少确定性」递增；三档共用 worker primitive，**不共用完成判定**

## Non-goals（本阶段）

- 实现真实 API / OAuth
- 替换现有 Task Runner 实现
- 做完整项目管理（甘特、史诗组合编辑器等）

## Acceptance Criteria

- [x] 统一领域模型（WorkItem / Provider capability）
- [x] 信息架构与页面布局（列表 + 详情 + 连接管理）
- [x] Provider 扩展点说明
- [x] 与现有 PR 面板 / Task Runner 的边界
- [x] HTML 原型可演示多源筛选与类型差异
- [x] 命名拍板：Tasks（工作项）+ Launch（原 runner）+ WorkItem（代码）
- [x] Local Tasks 默认内置设计：本地工作项无需连接即可使用，支持 stage 轨道
- [x] 第三方 Provider 作为可选扩展：GitHub / GitLab / Linear / Jira 需用户主动添加
- [x] 状态流转可视化：详情面板展示 stage rail 与 transition 操作
- [x] 看板首页（Board View）：卡片列式展示工作项状态分布，支持 Board / List 切换
- [x] Settings → Integrations 页面设计：Provider 卡片管理、连接状态流转、项目绑定映射（Source Strip 从 Tasks 面板移入 Settings）
- [x] **MVP Provider 范围已确认**（2026-11-01，design §8.1）：MVP = **Local + GitHub PR**；MVP+1 = GitHub Issue；V1 = GitLab；V1.1 / V1.2 = Linear / Jira
- [x] 执行方式轴与 `WorkItemRun` 契约进入 design（含与 `TeamTask` 的边界、回链方向、快照陈旧策略）
- [x] 命名裁决落地：WorkItem 中文「工作项」· TeamTask「团队任务」· 人侧 Stage / 执行侧 Flow
- [x] 团队侧零改动确认：不给 `TeamTask` 加 WorkItem 引用列，不在团队板做 source badge（二期）

## Notes

- 复杂任务：需要 `prd.md` + `design.md` + `implement.md` + 原型
- 实现阶段建议 parent/child：core model、provider-local、ui-shell、`run-single` → GitHub PR → GitHub Issue → GitLab → Linear → Jira
  （MVP 只包含前四项里的 **Local + GitHub PR + `run-single`**，档位与 exit 条件见 design §8.1）
- Launch 文案可先改 UI；`features/task` 目录与 IPC 名分期 rename，不阻塞 Work Items MVP

## Phase 2: Local Task CRUD (新增需求)

### 用户故事

1. **US-CRUD-1**：用户点击 [+ Add task] 按钮或列底部 [+]，弹出 Create Task 对话框，填写标题（必填）、描述、Stage、优先级、标签、负责人后创建工作项，新卡片立即出现在对应列顶部。
2. **US-CRUD-2**：用户点击 Board 卡片打开 Detail 面板，点击 [Edit] 按钮弹出 Edit Task 对话框，修改字段后保存，卡片实时更新。
3. **US-CRUD-3**（**2026-11-02 修订**）：用户在 Detail 面板中点击 [Delete]（或选中一行按 `Delete`），工作项**立即**从 Board 和 List 中移除，并显示 Undo 条 —— **不弹确认对话框**。
   形态改为「乐观删除 + 5 秒撤销窗口」：少一次点击，而且真的可撤回。确认框只能拦住误点的那一下，
   撤销能救误点之后的全部后果（连点两下删除、删错了行、删完才想起来里面写着分支名）。
4. **US-CRUD-4**（**本期不实现**）：用户在 Board 视图中拖拽卡片到其他列，stage 自动更新。
   拖拽是 design §4.5 标的「未来支持」；本版只落 **右键 [Move to]** 与 Stage Rail 两条入口（design §11.5 方式二 / 方式三）。
   理由：HTML5 `dataTransfer` 在 jsdom 里不可靠，为一版拖拽写下的交互测试只会变成易碎品。
5. **US-CRUD-5**：用户在 Detail 面板的 Stage Rail 中点击可流转的 stage 节点，工作项 stage 立即更新。
6. **US-CRUD-6**：删除后显示 Undo 条，5 秒内可撤销删除操作（撤销把该行放回**原位**）。

### 交互约定

| 场景 | 行为 |
| --- | --- |
| 空状态（无任何工作项） | 显示欢迎提示 + [Create your first task] 按钮 |
| 创建后 | 自动滚动到新卡片位置 —— **只对「本面板发起的 create」生效**。列表因为别的原因多出一行（5 秒后延迟提交的删除失败会把行放回来）时**不滚**：那不是新建，滚过去等于骗人 |
| 删除前 | **不弹确认对话框**（见 US-CRUD-3）：乐观移除 + 5 秒撤销窗口 |
| 删除后 | 若 Detail 面板打开且被删除项是当前选中，关闭 Detail |
| 键盘快捷键 | `Cmd/Ctrl+N` 新建，`Delete` / `Backspace` 删除选中，`Escape` 关闭当前面板层（详情；对话框的 `Escape` 归对话框自己）。**只在面板有焦点且焦点不在输入框 / 文本域 / contentEditable 里时生效** —— 否则在标题框里按 Backspace 会删掉整条工作项 |
| 视图记忆 | Board / List 上次选择写进 `localStorage`（`neeko.work-items.view`）；存储不可用（隐私模式）时静默回落 Board |
| 拖拽冲突 | 乐观更新 + 后端失败时回滚并 toast 错误 |
| 数据持久化 | 每次变更自动保存到 **SQLite**（复用 `common/db` 的 `user_version` 迁移链；无手动保存按钮） |
| 撤销 | 删除后显示面板内 **Undo 条**（5 秒内可撤销）。**不是** shared toast：那一套是 3 秒且无动作按钮，与 5 秒窗口必然漂移 |
| 执行快照陈旧 | `snapshot.capturedAt` 超 60 秒阈值显示「· 已过期」+ 刷新按钮；**不自动轮询**（陈旧只是渲染提示，不参与完成判定） |
| 批量操作 | 第一阶段不做，第二阶段支持多选批量删除/移动/分配 |

### 非目标（本阶段）

- 不实现批量操作
- 不实现拖拽排序（仅拖拽跨列移动）
- 不做跨平台写操作事务
- 不做离线全量同步

## Phase 3: 执行方式（单 agent / 团队 / 固定流程）

> 2026-11-01 新增。动机：工作项只回答「要做什么」；用户还需要在同一个面板里决定「谁来干、怎么干」。
> 已有能力：`agent/team/**`（队长 + 共享任务板 + MCP，已实现）只能从团队面板发起；`features/task`（Launch）只能跑单条命令。

### 用户故事

1. **US-RUN-1**：用户在工作项详情点 [Run with agent]，选一个 CLI，开会话并把工作项上下文（标题 / 正文 / 仓库 / 分支 / 链接）
   作为**指令前置**；该工作项详情出现一条执行记录。
2. **US-RUN-2**：用户点 [Dispatch to team]，选队长 CLI，起队并把同一段上下文交给队长；队长自己拆活、派成员、跑完回流到团队板。
   hub 侧只显示「已派给团队 · 团队名 · 状态」并可跳转，**不复制团队板**。
3. **US-RUN-3**：用户点 [Run flow…]，选一个预先编排好的固定流程。v1 引擎未实现时该入口**置灰 + 一行原因**，不隐藏、不做假按钮。
4. **US-RUN-4**：一个工作项可有多条执行记录；按 `createdAt` 倒序，状态来自**快照**，快照过期显示「· 已过期」+ 手动刷新。
5. **US-RUN-5**：团队被删除后，关联执行记录显示 `unknown`（**不得**显示 `failed`），并保留最后一次快照时间。

### 三档阶梯（不进同一个视图）

| 档 | 谁决定下一步 | 完成判定 | 典型场景 |
| --- | --- | --- | --- |
| `single` | 人（一次会话） | 会话结束 | 5 分钟的修复、探索 |
| `team` | 队长 LLM 运行时拆活 | **任务板显式声明** | 多文件并行、需 worktree 隔离、长链路 |
| `flow` | 人（预先编排静态图） | 步退出码 / 门禁 | 固定套路：实现 → 测试 → lint → PR |

`flow` 的可观测面是 run graph，`team` 是板列 + 成员六态（含「未声明」）。压平会丢掉「未声明 ≠ 完成」这条不变量。

### 交互约定

| 场景 | 行为 |
| --- | --- |
| 三个动作入口始终可见 | 不可用时置灰 + 一行原因（隐藏会让用户以为功能不存在） |
| 执行态 | 卡片与详情显示 mode 徽标 + 状态 chip；**不把 team 的「未声明」压成「完成」** |
| 轮询 | 不自动轮询；打开详情刷新一次 + 手动刷新按钮 |
| 快照 | 只做渲染与跳转；任何「做完了没有」的判定回执行域查 |
| 载荷 | 执行记录一行一条，只显示 `snapshot.label`（≤ 120 字符）；不渲染团队任务 / 成员明细（红线 4） |

### 非目标（本阶段）

- 不实现 flow 引擎（只留入口与契约；引擎排在 single / team 之后，且不是 hub MVP 的一部分）
- 不做 team 侧反向依赖：不给 `TeamTask` 加工作项引用列，不在团队板做 source badge（二期，代价是一次迁移）
- 不做跨平台写回（团队结果自动评论 / 流转到 GitHub / Linear）：属于 provider 写能力，另开任务
