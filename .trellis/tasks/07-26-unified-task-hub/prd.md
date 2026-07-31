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

- **不采用** 侧栏名单字 `Work`（过宽，易与 workspace/worktree 混）
- **不采用** `Run` 作为脚本模块终名（可用作按钮进行时态 *Running…*；模块名用 Launch）
- 中文：Tasks → **任务**；Launch → **启动 / 启动配置**

## Requirements

1. 统一抽象：PR / Issue / 需求 / Bug / 故事等均可映射为 Work Item
2. 统一列表体验：筛选、搜索、排序、分组、状态、指派人、标签
3. 详情与动作按 **类型 + Provider 能力** 扩展（不是一套死按钮）
4. Provider 可插拔：GitHub、GitLab、Linear、Jira… 注册即可出现
5. **Local Tasks 默认内置**：本地任务无需第三方即可创建、维护、流转；作为默认 Provider 始终存在
6. **第三方 Provider 可选扩展**：GitHub / GitLab / Linear / Jira 需用户主动添加/连接，不作为默认显示
7. **状态流转可视化**：本地任务支持自定义 workflow stage（如 Backlog → Ready → In Progress → Review → Done），详情面板展示阶段轨道与可执行 transition
8. 与项目环境绑定：Local / WSL / SSH（及未来 Docker）下的仓库/工作区上下文
9. 与 Agent 工作流衔接：从任务一键开 Agent 会话 / 终端命令 / 打开分支或 diff
10. **看板首页（Board View）**：以卡片列式看板作为 Tasks 默认首页，直观展示所有任务的状态分布与流转；支持 Board / List 视图切换
11. 命名消歧（强制）：产品 **Tasks** vs **Launch**；代码 **WorkItem** vs 现有 task runner 类型
12. 输出 design.md + 可交互 HTML 原型

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
- [x] Local Tasks 默认内置设计：本地任务无需连接即可使用，支持 workflow stage
- [x] 第三方 Provider 作为可选扩展：GitHub / GitLab / Linear / Jira 需用户主动添加
- [x] 状态流转可视化：详情面板展示 stage rail 与 transition 操作
- [x] 看板首页（Board View）：卡片列式展示任务状态分布，支持 Board / List 切换
- [x] Settings → Integrations 页面设计：Provider 卡片管理、连接状态流转、项目绑定映射（Source Strip 从 Tasks 面板移入 Settings）
- [ ] 用户确认 MVP Provider 范围与实现启动

## Notes

- 复杂任务：需要 `prd.md` + `design.md` + `implement.md` + 原型
- 实现阶段建议 parent/child：core model、GitHub provider、UI shell、GitLab、Linear、Jira
- Launch 文案可先改 UI；`features/task` 目录与 IPC 名分期 rename，不阻塞 Work Items MVP

## Phase 2: Local Task CRUD (新增需求)

### 用户故事

1. **US-CRUD-1**：用户点击 [+ Add task] 按钮或列底部 [+]，弹出 Create Task 对话框，填写标题（必填）、描述、Stage、优先级、标签、负责人后创建任务，新卡片立即出现在对应列顶部。
2. **US-CRUD-2**：用户点击 Board 卡片打开 Detail 面板，点击 [Edit] 按钮弹出 Edit Task 对话框，修改字段后保存，卡片实时更新。
3. **US-CRUD-3**：用户在 Detail 面板中点击 [Delete] 按钮，弹出确认对话框，确认后任务从 Board 和 List 中移除并显示 Undo toast。
4. **US-CRUD-4**：用户在 Board 视图中拖拽卡片到其他列，stage 自动更新，卡片在目标列显示。
5. **US-CRUD-5**：用户在 Detail 面板的 Stage Rail 中点击可流转的 stage 节点，任务 stage 立即更新。
6. **US-CRUD-6**：删除后显示 Undo toast，5 秒内可撤销删除操作。

### 交互约定

| 场景 | 行为 |
| --- | --- |
| 空状态（无任何任务） | 显示欢迎提示 + [Create your first task] 按钮 |
| 创建后 | 自动滚动到新卡片位置 |
| 删除后 | 若 Detail 面板打开且被删除项是当前选中，关闭 Detail |
| 键盘快捷键 | `Cmd+N` 新建，`Delete` 删除选中，`Escape` 关闭对话框 |
| 拖拽冲突 | 乐观更新 + 后端失败时回滚并 toast 错误 |
| 数据持久化 | 每次变更自动保存到本地 JSON（无手动保存按钮） |
| 撤销 | 删除后显示 "Undo" toast（5 秒内可撤销） |
| 批量操作 | 第一阶段不做，第二阶段支持多选批量删除/移动/分配 |

### 非目标（本阶段）

- 不实现批量操作
- 不实现拖拽排序（仅拖拽跨列移动）
- 不做跨平台写操作事务
- 不做离线全量同步
