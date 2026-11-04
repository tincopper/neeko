# 统一任务中心 · 实现路线图（设计后）

> 本阶段不写业务代码。确认 design + 原型后，再拆子任务 `task.py start`。

## 命名约束（实现时强制）

| 产品 | 代码 / 目录 | 禁止 |
| --- | --- | --- |
| **Tasks**（工作项面板） | `features/work-items`、`WorkItem` | 新代码用 `Task` 表示工作项 |
| **Launch**（原脚本 runner） | 文案先改；类型可暂留 `TaskConfig` | 新 UI 文案再写 Task Runner / Run 模块名 |
| **Agent** | 现有 agent 域 | 与 Tasks 列表混排为同一 inbox |

可选后续：**launch-rename** — `TaskConfig`→`LaunchConfig`、按钮/菜单文案、命令面板前缀 `Launch:`（独立子任务，不阻塞 Provider）。

## 建议子任务拆分

1. **work-items-core** — 类型、registry、store、query key、mock provider  
2. **provider-local** — 内置本地工作项 Provider：CRUD、stage 轨道定义、transition、本地存储  
3. **work-items-ui-shell** — 单一面板（Board/List 双视图）：看板列卡片、列表分组 + 详情面板、筛选条、Source strip、Stage rail、Connect banner
4. **provider-github-pr** — 迁移 PullRequestsPanel → GitHub provider（list/detail/merge）  
5. **provider-github-issue** — Issues list/detail  
6. **provider-gitlab** — MR + Issue  
7. **provider-linear** — tickets + transition  
8. **provider-jira** — tickets + transition  
9. **integrations-settings** — Settings → Integrations 页面：Provider 卡片、连接/断开、项目绑定映射
10. **run-single** — 单 agent 派活：`[Run with agent]` → 开会话 + 把 WorkItem 渲染成**指令前置**（标题/正文/仓库/分支/链接）+ 写一条 `WorkItemRun`
11. **run-team** — 派给团队：`[Dispatch to team]` → 起队（队长自己拆活）+ 存指针；**依赖 `10-30` 收尾**
12. **run-flow** — 固定流程引擎（v1 只线性 + fan-out/join + 重试/门禁；复用 worker primitive）
13. **launch-copy**（可选并行）— 产品文案 Task Runner → Launch  
14. **launch-rename**（可选靠后）— 类型与 IPC 符号 rename + 兼容  


## 跨任务桥接：WorkItem → 执行（与 `10-30-multi-agent-orchestration`）

**方向单向：本任务发起执行，执行域不反向依赖本任务。** 不合并数据模型，不把 `TeamTask` 注册成 WorkItem Provider。
契约（`WorkItemRun` 形状、指针+快照、三档阶梯、完成判定不共享）在 design §3.4 / §4.6，本节只定落手方式。

### 边的存放：写在 hub 侧（已有裁决 2026-11-01）

- 边是 `WorkItemRun.ref`，存在 hub 自己的存储（与 Local WorkItem 同库/同目录）；团队侧**一列不改**。
- 理由：`TeamTask` 现在没有外部引用字段（`types.rs:353-370` 只有 `artifacts`），团队库已有 `user_version`
  迁移链；而边的两端只有一个需要知道对方（hub 需要知道“派给了哪个队”，团队不需要知道“这活从哪来”）。
- 因此：**不给 `TeamTask` 加 `source`/`workItemRef` 列**（这与先前写的「不要预留空 `source` 字段」一致，现在是有了明确替代方案，不是单纯 YAGNI）。
- 团队板卡片 source badge → **二期**（需团队侧读 WorkItem，代价一次迁移）；v1 回链只在 hub 详情「执行」区块。
- 两侧存储不同（团队任务在 SQLite 的 `team_*` 表 + 租约，Local WorkItem 建自己的表；同库不同表也算两套存储），
  **任何一侧不得读写另一侧的表**。

### 触发方式：选 A（上下文前置），不新增写任务的命令

团队域今天的事实：任务只能由**队长**经 MCP `task_create` 写（`mcp/schema.rs:34`）；前端只有
`start/close/delete` + 只读查询（`team/commands.rs:121-517`）；`start_team_session` **不收初始指令**
（`teamApi.ts:48-84`）。于是只有两条路：

| 方案 | 代价 | 裁决 |
| --- | --- | --- |
| **A** 起队时把 WorkItem 渲染成指令写进队长会话（或给 `start_team_session` 加 `initialPrompt`） | 需后端加一个入参（或前端在 PTY ready 后写） | ✅ 保持「只有队长 `create`」不变量（`10-30` 裁决 2） |
| B 新增 `team_dispatch` 命令直接建 `TeamTask` | 多一个写入方 + 重新做授权模型 + 立刻需要 `source` 列 | ❌ 一期不做 |

同一套「渲染意图」函数被 `run-single` 与 `run-team` 共用（不要写两份提示词拼装）。
它只拼 WorkItem 的**字段**（标题/正文/仓库/分支/链接），不拼步骤 —— 步骤是队长的活。

### 收敛：`run-flow` 不另写 spawn / 准入 / 完成判定

`flow` 的每一步 = `10-30` 已有的一次性 worker（`team_spawn` + sentinel，准入只在 `admission.rs` 一处判据）。
两者的差别只能落在**编排策略**上（静态图 vs 队长动态排图）与**完成判定**上（退出码 vs 板声明）。
写第二套 spawn / 准入就是红线 15 的地方版本。

## 依赖顺序

```
core → provider-local（内置本地工作项 + stage 轨道）
     → ui-shell（Board/List 单一面板、stage rail、source strip）
       → run-single（最便宜、覆盖最高频；不依赖团队域）
       → github-pr（替换旧入口） / github-issue / gitlab / linear / jira（可并行）
       → run-team（依赖 10-30 团队域收尾 + initialPrompt 入参）
       → run-flow（复用 worker primitive；引擎不是 hub MVP 的一部分）
integrations-settings 可与 provider 并行，但 auth 完成前第三方 provider 只读 mock
```

**硬顺序**：`run-single` 先于 `run-team`；`run-flow` 最后（它本质是个 CI，不阻塞 hub MVP）。

**MVP 范围**（2026-11-01 裁决，详见 design §8.1）：**Local + GitHub PR + `run-single`**。
MVP+1 才接 GitHub Issue；GitLab / Linear / Jira 各自独立里程碑。本轮不做 Review 子视图、 Mine 跳仓视图、Gitee。

## 验证（未来）

```bash
npx tsc --noEmit
pnpm test
# 手动：Tasks 面板 Board 首页默认展示、卡片列分布正确
# 手动：Board/List 视图切换正常、记忆用户选择
# 手动：本地工作项默认存在、第三方未连接时仅显示 Local
# 手动：本地工作项详情展示 Stage rail、可执行 Transition
# 手动：GitHub 未登录 banner、打开 PR detail tab
# 文案抽检：侧栏 Tasks；启动配置处为 Launch；无双 Task 入口；「任务」单用只指团队任务
# 手动：详情「执行」区块可发起 single / team，两条记录并存、mode 徽标可辨
# 手动：团队运行中 → hub 快照显示 running；团队删掉 → 显示 unknown（不显示 failed）
# 手动：快照过期显示「· 已过期」+ 刷新按钮；不自动轮询
# 手动：flow 引擎未实现时 [Run flow…] 置灰且写明原因，不隐藏
```

## 岛屿布局改造（2026-11-03，design §4.2b）

> 用户反馈：「Tasks 实现的太丑了，没有遵循项目的 UI 规范，应该使用岛屿的布局设计」。
> 改在**本任务**下（不新建任务）：它就是 Tasks 面板的 UI 落地。

### 判据（四条，改完后逐条自查）

1. 面板**裸挂**进中心区（与 Library 同构），自己不画海面；
2. 所有岛屿外壳走 `ISLAND_CLASS` / `<Island>`，删除自写的 `rounded-md border border-border bg-bg-secondary`；
3. 岛间距只有 `ISLAND_SPLIT_GROUP_CLASS`（`gap-px`），删除 `gap-2` / `p-2`；
4. 岛内控件面用 `bg-bg-tertiary`，**禁止** `bg-bg-primary`（那是海面）。

### 改动清单

| # | 文件 | 动作 | 验收 |
| --- | --- | --- | --- |
| 1 | `src/app/components/AppCenter.tsx` | Tasks 从「套 `<Island>`」改为**裸挂**（与 Library 同形）；包装形状表补一行 | `AppCenter.test`：Tasks 的 DOM 父级不再有岛类 |
| 2 | `src/features/work-items/components/TasksPanel.tsx` | 根节点 `bg-bg-primary` → 透明；头部与内容各自成岛 | 组件测试断言两座岛存在 |
| 3 | `TasksPanelHeader.tsx` | 裸 `border-b` 横条 → `<Island>`（岛内 `bg-bg-tertiary` 头部语言） | `TasksPanelHeader` 无边框裸条残留 |
| 4 | `BoardView.tsx` | 列 → `ISLAND_CLASS`；容器 `gap-2 p-2` → `gap-px`；列头/卡片 → `bg-bg-tertiary` | `BoardView.test`：列有岛类、容器 `gap-px` |
| 5 | `WorkItemCard.tsx` | `bg-bg-primary` → `bg-bg-tertiary`（岛内控件面） | 断言不再有 `bg-bg-primary` |
| 6 | `ListView.tsx` | 裸 `<ul>` → 列表岛；与详情岛分栏 | 新测试：列表岛 + 详情岛 + separator |
| 7 | `WorkItemDetail.tsx` | `absolute inset-0 bg-bg-primary` 覆盖层 → **第二座岛**（Board 与 List 共用） | 详情不再是 `absolute inset-0` |
| 8 | `TasksPanelBody.tsx` | 按视图给出「看板岛容器 / 列表+详情分栏」 | — |

### 分栏尺寸

列表｜详情（以及 Board｜详情）的分栏比例走
`useDefaultLayout({ id, panelIds, onlySaveAfterUserInteractions: true })`：
`workItemsStore` 会随 `reset()` 清空（切项目），把布局比例塞进去会让「切项目后回到默认宽度」
变成一条无解释的行为。理由同 `TeamListPane`（`component-guidelines.md` 的变体节）。

### 验证

```bash
pnpm vitest run src/features/work-items src/app/components/__tests__/AppCenter.test.tsx
pnpm check:quick   # 收尾一次
```

## 进度（2026-11-03，岛屿布局改造）

| # | 动作 | 落地 |
| --- | --- | --- |
| 1 | Tasks 中心区**裸挂** | `AppCenter.tsx`：`<Island>` → 透明包装（与 Library 同形）+ 两岛骨架 |
| 2 | 岛屿间距新增唯一来源 | `layout/islands.ts` 新增 `ISLAND_GAP_CLASS`（6px，非分栏位置）；`ISLAND_SEA_PAD_CLASS` |
| 3 | 看板列 = 岛 | `BoardView.tsx`：`ISLAND_CLASS` + `ISLAND_GAP_CLASS`；列头/`+Add` → `bg-bg-tertiary` |
| 4 | 卡片 = 岛内控件面 | `WorkItemCard.tsx`：`bg-bg-primary` → `bg-bg-tertiary` |
| 5 | 头部 = 岛 | `TasksPanelHeader.tsx`：裸 `border-b` 横条 → `<Island className="flex-row bg-bg-tertiary">` |
| 6 | 列表 = 岛 | `ListView.tsx`：裸 `<ul>` → 岛壳 + 内部滚动 |
| 7 | 详情 = **第二座岛** | `WorkItemsSplitView.tsx`（新）：`ResizablePanelGroup` + `useDefaultLayout`；`WorkItemDetail.tsx` 去 `absolute inset-0 bg-bg-primary` |
| 8 | 面板根 = 海面 | `TasksPanel.tsx`：`bg-bg-primary` → 透明 + `ISLAND_GAP_CLASS p-1.5`；内容区去 `overflow-auto` |

### 顺带拆出的文件（`check_component_size` 300 行红线）

| 文件 | 职责 |
| --- | --- |
| `components/WorkItemsSplitView.tsx` | 「主内容岛 │ 详情岛」分栏（Board/List 共用） |
| `components/WorkItemDetailPane.tsx` | 详情岛的接线（选中项 + 阶段轨 + 四动作） |
| `hooks/useWorkItemDialogSubmit.ts` | 对话框开关 + 提交 + 错误回填（五个 state 同生同灭） |
| `utils/filterWorkItems.ts` | 搜索命中判据（纯函数，边界可直测） |

### 测试账（2026-11-03）

`pnpm vitest run src/features/work-items src/app/components src/app/dock src/layout` → **301 条绿**（37 文件）。
新增用例：BoardView 岛屿三条、TasksPanel 岛屿四条、AppCenter 包装形状三条、`filterWorkItems` 七条。
`pnpm check:quick` → **13 条护栏全通过**。

### 有意识改动的**存量**用例

`TasksPanel.test.tsx` 的「焦点在搜索框里时 Backspace 只是输入」从 `user.click(input)` 改成
`input.focus()` + `toHaveFocus()` 前置断言：`react-resizable-panels` 在 document 上挂
`pointerdown`（capture），按指针到分隔条的距离判命中；jsdom 里 rect 全 0×0、坐标全 0 ⇒ 距离恒 0
⇒ 任何点击都把焦点抢给分隔条。这是 jsdom 测量缺失，不是真实行为（坑已记入 spec）。

## 进度（2026-11-03b，左栏策略 + 项目级入口）

> 用户反馈：「Tasks 应该显示在中间区域，不要占用整个平面，左侧的 projects 需要支持打开关联的」。

| # | 动作 | 落地 |
| --- | --- | --- |
| 1 | 左栏策略成为**每视图属性** | `shared/dock/types.ts` 新增 `collapseLeftZone?`；`panelMeta.ts` 的 tasks 设 `false` |
| 2 | `openTabView` 按属性决定展开态 | `dockStore.ts`：`expanded = !collapseLeftZone`（不再一律收起） |
| 3 | 项目级入口 | `useProjectItemMenu`（右键菜单项）+ `ProjectGroup.onOpenTasks`（悬停图标）+ `ProjectItem` 接线 |
| 4 | 动作组合 | `app/hooks/useOpenProjectTasks.ts`（新）：`selectProject` → `setAppView('tasks')`；经 `ProjectActionsContext.onOpenTasks` 注入 |
| 5 | 图标别名 | `shared/components/icons`：`ListChecksIcon` |

### 测试账（2026-11-03b）

`pnpm vitest run src/app src/features/project src/shared src/features/work-items` → **1833 条绿**（190 文件）。
新增用例：`dockStore` 两条（Tasks 不收左栏 / Library→Tasks 要把左栏放回来）、`ProjectItem` 三条
（右键项 / 悬停按钮 / 未注入时不渲染）、`useOpenProjectTasks` 三条（顺序、非开关、跨视图）、
`buildAppShellValues` 一条（`onOpenTasks` 穿透）。

### 有意识改动的存量用例（本轮）

| 用例 | 原断言 | 现断言 | 理由 |
| --- | --- | --- | --- |
| `dockStore.test` 的「点 Tasks → 左栏收起」 | `expanded === false` | `expanded === true` | Tasks 改为不收左栏 |
| `dockStore.test` 的「Library 中点 Tasks → 左栏保持收起」 | 删除 | — | 与新行为直接冲突；已由「要把左栏放回来」取代 |
| `DockBarButton.test` 的「打开 tasks 收起左栏」 | `expanded === false` | `expanded === true` | 同上 |

## 进度（2026-11-03c，内容岛承接所有状态）

> 用户反馈（附截图）：「中间弄一个面板承接内容，像 tab 内容显示一样」。

**根因**：`TasksPanelBody` 的空态 / 加载中 / 无匹配 / 未绑定项目四档都返回裸 `<p>` / 裸 `<div>`，
直接画在面板根的海面上 —— 看起来不像「面板的内容」，而像「面板没渲染完」。

| 改动 | 文件 | 说明 |
| --- | --- | --- |
| 四档「无行」状态统一包进内容岛 | `TasksPanelBody.tsx` | `<Island data-testid="tasks-content-island" className="flex-1">`；判据 = **状态不改变表面层级** |
| 有数据时**不**包岛 | 同上 | 看板 / 列表自带分栏与岛屿，再包一层就是岛中岛 |
| 读失败且从未成功仍返回 `null` | 同上 | 顶部横幅已解释原因；摆空岛会让人以为「加载成功只是没数据」 |

### 测试账（2026-11-03c）

`pnpm vitest run src/features/work-items src/app` → **403 条绿**（59 文件）。
新增用例 3 条：空项目 / 未绑定项目 / 搜索无匹配 —— 三条都断言「文字住在岛里」（`islandOf` 向上找
`rounded-lg` 祖先）且 `tasks-content-island` 存在。

## 进度（2026-11-03d，面板层级修正：一座主岛）

> 用户反馈（附 Library 截图）：「中间应该像这样有一层岛屿作为内容的承载，而不是直接内容在海里面」。

**根因**：上一轮把「每列一座岛」当成了岛屿化 —— 看板变成**一排浮岛漂在海面上**。
而 Library 的正确形态是「**一座主岛**，岛内是 toolbar + content」。判据不是「它自己滚不滚」，
而是「它是不是一块独立的 UI 单元」。

### 修正后的层级

```
海面（中心区透明包装）
└ 主岛（tasks-main-island：头部 + 内容都在岛内）
  ├ 岛内 header（bg-tertiary + border-b，**不**套 <Island>）
  └ 分栏（gap-px）
    ├ 主格：看板列 / 列表（**分区** bg-tertiary，无圆角无阴影）
    └ 详情岛（**第二座岛**）
```

| # | 动作 | 文件 |
| --- | --- | --- |
| 1 | 头部 + 内容包进**一座主岛** | `TasksPanel.tsx`（`<Island data-testid="tasks-main-island">`） |
| 2 | 头部去掉自带岛壳（否则岛中岛） | `TasksPanelHeader.tsx`：`<Island>` → `<header>` + `bg-bg-tertiary border-b` |
| 3 | 看板列降为**岛内分区** | `BoardView.tsx`：`ISLAND_CLASS` → `bg-bg-tertiary`；容器 `ISLAND_GAP_CLASS` → `ISLAND_SPLIT_GROUP_CLASS` |
| 4 | 列表降为**岛内分区** | `ListView.tsx`：去 `ISLAND_CLASS` |
| 5 | 分栏注释对齐新层级 | `WorkItemsSplitView.tsx` |

### 测试账（2026-11-03d）

`pnpm vitest run src/features/work-items src/app` → **404 条绿**（59 文件）。

改写存量用例（3 条，都是上一轮把「列是岛」钉住的那几条）：

| 用例 | 原断言 | 现断言 |
| --- | --- | --- |
| `BoardView`「每列是一座岛」 | 列有 `rounded-lg`/`shadow-sm`/`bg-bg-secondary` | 列是 `bg-bg-tertiary` 分区，**无**圆角/阴影 |
| `BoardView`「列间距 = 6px 海面」 | 容器 `gap-1.5` | 容器 `gap-px`（岛内分隔） |
| `TasksPanel`「头部与列各自是岛」 | 各自非 null 岛 | 两者都 `islandOf(...) === tasks-main-island` |

新增用例 2 条：「整块面板是主岛|详情岛双岛」+「头部与内容都在同一座主岛里」。

## 进度（2026-11-03e，真正的根因：缺海面 + 同色叠同色）

> 用户反馈：「还是一样呀，没有岛呀」。连续第三轮。

**根因（两条，都在表面 token 上，不在结构上）**：

1. **没有海就没有岛** —— 中心区 `center-area` 面板只有 `py-0.5 px-px`（**无底色**），
   `AppCenter` 的 Tasks 包装也是透明的。所以主岛的 `bg-secondary + rounded-lg + shadow-sm`
   直接压在**窗口渐变**上，没有对比物 ⇒ 圆角阴影几乎看不见。
   参照：`LibraryPanel` 根 `bg-bg-primary`、`EditorGroupLayout` 根
   `rounded-lg overflow-hidden bg-bg-primary` —— 都是**容器给海、内层给岛**。
2. **岛与分区同色** —— 空态/加载中/无匹配容器套了 `<Island>`（`bg-secondary`），
   而它们住在主岛里（也是 `bg-secondary`）⇒ 同色叠同色，仍是一片白。

**教训：判据一直写错**。前两轮我都断言「有 `Island` 元素」，而它能抓的只有结构；
真正要抓的是「**三个表面 token 是否不同**」。

| # | 动作 | 文件 |
| --- | --- | --- |
| 1 | 面板根补海面 | `TasksPanel.tsx`：`+ bg-bg-primary overflow-hidden rounded-lg` |
| 2 | 空态容器从「同色岛」改为「岛内分区」 | `TasksPanelBody.tsx`：`<Island>` → `bg-bg-tertiary` 分区（`tasks-content-region`） |

### 测试账（2026-11-03e）

`pnpm vitest run src/features/work-items src/app` → **406 条绿**（59 文件）。

新增/改写的护栏（这是本轮唯一有长期价值的产物）：

- **「海 / 岛 / 岛内分区是三个不同表面」**：同时断言 `root.bg-primary` /
  `island.bg-secondary` / `column.bg-tertiary`。只断言其中一个 = 没断言。
- 「面板根是海面」：`island.parentElement` 必须带 `bg-bg-primary`。
- 三条空态用例改为断言「住在**主岛**内 + 分区是 `bg-tertiary`」。

## 进度（2026-11-03g，主题适配：表面阶梯走到最内层）

> 用户反馈：「但是UI还是需要根据应用的主题进行适配，当前的UI和整个应用主题不适配」。

**根因**：上一轮修「看得出岛」时把卡片也写成 `bg-bg-tertiary`，于是卡片与列**同色**——
五个主题下对比度恒为 1.00。**教训**：上一轮只查了「列 vs 岛」，在阶梯中间停了一层。

| 层 | 错 | 对 | 依据 |
| --- | --- | --- | --- |
| 分区内卡片 | `bg-bg-tertiary`（= 列同色） | `bg-bg-primary` | `ui/Card` / `PromptCard` / `TaskCardRow` / `MemberApprovalQueue` 全用 primary |
| 岛内 header / footer | `bg-bg-tertiary` 满宽横条 | 只写 `border-b` / `border-t` | `LibraryToolbar` / `GitControlPanel` / `PaneTabBar` / `McpProjectContent` 全不自刷 |
| 空态 | `px-2 py-3 text-micro`（贴左上 10px） | 居中 + `text-meta` | `PromptListSection` / `PullRequestsPanelWrapper` |
| 列内 / 列表内局部占位 | `text-micro` | `text-meta` | `text-micro` 是 hint 专用字阶 |

### 测试账（2026-11-03g）

`pnpm vitest run src/features src/app` → **5363 条绿**（607 文件）。

三层判据（数值 / DOM-token / DOM-不自刷）：
- 新增 `surfaceContrast.test.ts`：五个主题下相邻两层对比 ≥ 1.05 + 「同色 = 1.00」反证；
- 改写 `BoardView.test.tsx`「岛内控件面用三级表面」→「卡片与所在列是**不同表面**」
  （上一版断言「卡片用 tertiary 不是 primary」**写反了**，正是本次事故的成因）；
- 新增 `TasksPanel.test.tsx`「岛内 header 只靠 border 划界」+「四档空态居中不用 hint 字阶」；
- 新增 `UndoBar.test.tsx` / `WorkItemDetail.test.tsx` 的「不自刷表面」。

## 进度（2026-11-03f，中心视图框架统一）

> 用户反馈：「高度和宽度没有和其他中间内容区域对齐……中间这块应该是应用的一个统一组件，
> 而不是每创建一个功能其中间的大小需要重新实现，内容只是在这个框架里实现」。

**根因**：外圈内缩**有两个所有者**。布局框架里它本该唯一（`DockLayout` 的 `center-area`
给 `py-0.5 px-px`），但四个中心视图各自又写了一遍外壳，几何三种：

| 视图 | 原外壳 | 结果 |
| --- | --- | --- |
| ProjectView | `<Island className="flex-1 h-full">` | 满格 |
| Library | 根 `bg-bg-primary` | 满格 |
| Tasks | 根 `rounded-lg bg-bg-primary p-1.5` | **四周多缩 6px + 双层圆角** |
| Settings | `<Island className="flex-1">` | 满格 |

| # | 动作 | 文件 |
| --- | --- | --- |
| 1 | 新建中心区唯一框架 | `app/components/CenterViewFrame.tsx`（海面 + 尺寸链 + 裁切；**不加** padding/圆角） |
| 2 | AppCenter 恰好一层框架，视图作子节点 | `AppCenter.tsx` |
| 3 | Tasks 去掉自写几何 | `TasksPanel.tsx`：根去掉 `rounded-lg bg-bg-primary p-1.5` |
| 4 | Library 去掉自写几何 | `LibraryPanel.tsx`：根去掉 `bg-bg-primary h-full` |
| 5 | Tasks 骨架对齐新形状（一座岛） | `AppCenter.tsx` 的 `TasksSkeleton` |

### 测试账（2026-11-03f）

`pnpm vitest run src/app src/features` → **5358 条绿**（606 文件）。

新增护栏：
- `CenterViewFrame.test.tsx`：框架提供海面/尺寸链/裁切，且**不含** `p-*`/`m-*`/`rounded-*`；
- `CenterViewAlignment.test.tsx`：四个视图框架类串**集合相等** + 恰好一层；
- `AppCenter.test.tsx`「四个视图用同一个框架」；
- `TasksPanel.test.tsx`「本面板不自写几何」（替代原来「根是海面」那条 —— 海面已归框架）。

## 进度（2026-11-02）

| 子任务 | 状态 | 落地 |
| --- | --- | --- |
| 1 work-items-core | ✅ 后端完成 | `src-tauri/src/work_items/{types,store,manager,commands,mod}.rs`；迁移 v17→v18（`work_item` / `work_item_run`）；7 条薄命令；52 条 Rust 测试 |
| 1 work-items-core（前端） | ✅ | `types.ts` / `api/` / `utils/stageRail.ts` / `store/workItemsStore.ts` / `hooks/{useWorkItems,useStagePlan}.ts` |
| 2 provider-local | ✅ 后端（含 stage/transition 与 Run 记录） | 自定义 stage 轨留为后续（当前只有 `DEFAULT_STAGES`） |
| 3 ui-shell | ✅ | `components/{TasksPanel,BoardView,ListView,WorkItemDetail,WorkItemDialog,WorkItemForm,StageRail,WorkItemCard,WorkItemChips,UndoBar,TasksPanelHeader,TasksPanelBody,TasksPanelStatus,WorkItemRunsSection,WorkItemRunRow,StageMoveMenu}.tsx` + `utils/{stageRail,shortcuts,viewPreference,runFreshness,workItemInstruction}.ts` + `hooks/{useWorkItems,useStagePlan,usePanelShortcuts,useRevealRow,useRunSingleWorkItem,useWorkItemRuns}.ts` + dock 接线（`panelMeta` tasks=6 / search=7、`registry` icon+lazy、`TasksPanelWrapper`） |
| 10 run-single | ✅ 2026-11-02 | `work_item_run_record`（**只接受 `mode=single`**）+ `utils/workItemInstruction.ts` + `hooks/useRunSingleWorkItem.ts` + 执行区接线（Run with agent / agent 下拉 / 记录 [Open]）；`createTaskTerminal` 改为**返回新 tab id**（`string | null`）—— 原计划的「可选 `tabId` 入参 + 保持 boolean」被护栏 `check_terminal_foreground_arbitration` A3 禁止（terminal 域不得出现可选 `tabId`），理由写在该文件注释里 |
| 11 run-team | ◻️ 未开始 | 依赖 `10-30` 收尾 + `start_team_session` 的 `initialPrompt` |
| 12 run-flow | ◻️ 未开始 | |
| 4 provider-github-pr | ✅ | 只读 provider：`viewModel.ts`（`TaskItem` 视图模型，**不污染 DTO**）、`providers/githubPr.ts`（`listPrs` → 视图模型）、`hooks/useGithubPrs.ts` + `usePrDetail.ts` + `useTaskFeed.ts`（本地项与 PR 合并）、`utils/providerPreference.ts`（默认 **关**）、`TaskSourceBadge` / `PrTaskSection`；旧 `Pull Requests` 面板一行未动（并联期） |
| **MVP 完成度** | **3/3** | Local provider ✅ · `run-single` ✅ · GitHub PR（只读）✅ —— 写操作（merge / checkout / diff）与 Issue 仍属后续里程碑 |

**测试账（2026-11-02 `run-single` 后）**：Rust `cargo test work_item` **59 条**（+7：single 落库 / `team`·`flow` 被拒 /
未知 workItemId → `NotFound` / `single` 必须指 `session` 且 `ref_id` 非空 / 线上词汇转换 / 指针归一 / 命令已注册）；
全量 `cargo test` 2946 条绿。前端 `npx vitest run src/features/work-items` **182 条**（api 10 + utils 50 + store 33 +
hooks 31 + 组件 58；另 `terminal/api` 的返回值用例也在）。`workItemsStore.ts` 覆盖率
statements/lines/functions/branches **100/100/100/100**；五个纯函数（shortcuts / viewPreference / runFreshness /
stageRail / **workItemInstruction**）与两个新 hook（`useRunSingleWorkItem` / `useWorkItemRuns`）同样实测
100/100/100/100，纯函数均已登记进 `vitest.config.ts` thresholds。

### design / PRD 写了、本切片**没做**的 UI 细节（不是缺陷，是范围）

> 记在这里的原因：下次审计会把它们当成「spec 说了代码没实现」，或者更糟 —— 当成已交付。
> **2026-11-02 更新**：第一轮复审后补了一批交互细节（下表已按事实重写），做掉的移到
> 「已落地」一节并写明实现点。

#### 已落地（2026-11-02 补齐，原表里的前五项）

| 项 | 出处 | 实现点 |
| --- | --- | --- |
| 右键 [Move to] 菜单 | design §11.5 方式三 | `components/StageMoveMenu.tsx`（Radix `ui/ContextMenu`）+ `WorkItemCard` 的可去目标来自 `stageNodes` 的 `reachable`；`current` / `locked` **不出现**（菜单是可执行命令清单，「为什么不能跳」归 Stage Rail） |
| `Cmd/Ctrl+N` / `Delete` / `Backspace` / `Escape` | design §11.7 / PRD Phase 2 | 判据 `utils/shortcuts.ts`（纯函数，100% 覆盖）+ 接线 `hooks/usePanelShortcuts.ts`（监听器挂面板根元素，不是 `document`）；对话框开着时键盘整体归 Radix Dialog |
| 创建后自动滚动到新卡片 | design §11.7 / PRD Phase 2 | `hooks/useRevealRow.ts`，**只对**本面板发起的 create 生效；「延迟提交失败回魂」不会触发（spy 断言的用例钉住） |
| Board / List 记忆上次选择 | design §4.5 | `utils/viewPreference.ts`（`neeko.work-items.view`）+ `TasksPanel` 的 `useState` 初值；非法值 / 隐私模式静默回落 `board` |
| 执行快照的「· 已过期」标记 | design §4.6 | `utils/runFreshness.ts`（`isStale` + `formatCapturedAt`，阈值 60s 一处定义）+ `WorkItemRunsSection`；阈值只是**渲染提示**，不参与完成判定 |

#### 仍未做（本期范围之外）

| 项 | 出处 | 状态 |
| --- | --- | --- |
| Board 拖拽改变 stage | design §11.5 方式一（§4.5 已标「未来支持」） | **明确不做**。理由：①§4.5 早就是「未来支持」；②HTML5 `dataTransfer` 在 jsdom 里不可靠，为它写的交互测试只会变成易碎品。本期只做右键 [Move to] 与 Stage Rail 两条入口（共用同一个 `transition` 与同一条可达性判据） |
| 执行记录的「跳转」按钮 | design §4.6（按 `ref.kind` 分流到会话 / 团队面板） | **✅ 2026-11-02 随 `run-single` 落地**：`session` 档给 [Open]（tabKey 走 `activeWorkspaceSession(projectId).key`），tab 已关闭则 `disabled` + 「该会话已关闭」；`team` / `flow` 不给按钮（没有可跳目标）。实现点：`WorkItemRunsSection` + `components/__tests__/WorkItemRunsSection.test.tsx` |
| 删除前的确认对话框 | design §11.4 / PRD US-CRUD-3 | **有意识偏离（已在 design §11.4 与 PRD US-CRUD-3 改正）**：乐观删除 + 5 秒撤销窗口取代确认框 |
| 撤销用 “Undo toast” | PRD Phase 2 / US-CRUD-6 | **形态变了（已在 PRD 交互约定注明）**：面板内 UndoBar（shared toast 是 3s 且无动作按钮，与 5s 窗口必然漂移） |

**这一轮新增的跨栈契约（写 spec 时别漏）**：

1. 可空字段的**清空**用空值表达（`None` = 不改，`Some("")` / `[]` = 清空；`title` 空串 = 拒绝）—— 前端 `UpdateWorkItemParams` 因此必须允许 `priority: ''`
2. `WorkItemRun` 的 Rust 字段 `run_ref` 用 `#[serde(rename = "ref")]` 上线为 `ref`（`ref` 是 Rust 关键字，**改键名等于改 IPC 契约**）
3. `StagePlan` 的边只有一个产生点（`StagePlan::from_stages()`：相邻两两、双向），`can_transition` / UI 的 `stageNodes` 都是它的消费者

## 回滚

- GitHub 迁移保留 feature flag：`workItems.githubProvider` **默认关闭**
  （开发期本地打开，验收后翻默认；迁完与旧 dock 项**并联一轮**再删旧入口）
- 失败时恢复独立 Pull Requests dock 项
- Launch 文案可单独回退，不影响 Work Items

## 非目标

- 第一期不做离线全量同步
- 第一期不做跨平台写操作事务
- **不把 TeamTask 并入 Tasks 看板**：`WorkItem` = 人的工作项，`TeamTask` = 派给 agent 的一次执行；
  团队板是**团队级**视图（受团队/队长会话作用域约束），Tasks 是**项目级** inbox —— 作用域轴不同，不是筛选关系。
  视图层关联走 design §3.4 的 `WorkItemRun`（指针 + 快照），**不做数据合并**
- 一期不给 `TeamTask` 加工作项引用列，不在团队板做 source badge（二期）
- 一期不做 flow 引擎（只留入口与契约）；不做团队结果自动写回 GitHub/Linear
- 第一期不强制 rename `features/task` 目录与全部 IPC
