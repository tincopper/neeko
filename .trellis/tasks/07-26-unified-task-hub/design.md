# 统一任务中心 · 技术与产品设计

## 1. 核心判断

你的理解正确：**PR、Issue、Linear/Jira 工作项在「人要处理的工作单元」层面是同一类东西。**

但实现上要分清两层：

| 层 | 含义 | 例子 |
| --- | --- | --- |
| **Work Item（统一任务）** | 跨平台规范化后的「待办/在办/已关闭工作单元」 | PR #42、Issue #7、LIN-123、PROJ-88 |
| **Provider Artifact** | 平台原生对象与动作 | GitHub PR review、Jira transition、Linear cycle |

UI 只认 Work Item；平台差异通过 **Provider Capability** 暴露。

---

## 2. 与现有 Neeko 能力的边界

| 现有模块 | 实际含义 | 统一任务中心关系 |
| --- | --- | --- |
| `features/task` | 可运行脚本 / Console 输出 | **不合并进 Work Item 列表**；产品 UI 定名 **Launch** |
| `PullRequestsPanel` + `pr-detail` | GitHub PR 列表与详情 Tab | **迁移为 GitHub Provider** 的一种 kind=`pull_request` |
| `conversation` / Agent tabs | AI 会话 | Work Item 可「Open in Agent」生成上下文 |
| Git branch/worktree | 代码线 | PR 类 Work Item 可关联 branch/checkout |

---

## 2.1 产品命名（已拍板）

### 三元组

```text
Tasks   → 工作项 inbox（PR / Issue / Linear / Jira / …）
Launch  → 启动配置（脚本、命令、可扩展启动项；原 Task Runner）
Agent   → 执行者（会话 / 模型）
```

| 场景 | 选用 | 不用 | 理由 |
| --- | --- | --- | --- |
| 侧栏 / Dock 工作项面板 | **Tasks** | Work | Tasks = 可处理事项列表；Work 过宽，易与 workspace/worktree 混 |
| 脚本与一键启动模块 | **Launch** | Task Run、Tasks | 与 TitleBar 的 Run/Debug/Open IDE「启动」语义一致；扩展面大于 “run script” |
| 进行中按钮态 | Running… / Stop | Launching…（可短暂） | 进行时仍可用 run 语义，模块名保持 Launch |
| 领域模型（工作项） | **`WorkItem`** | `Task` | 避免与 `TaskConfig` / `run_task` / store 撞名 |
| 领域模型（启动配置） | 现 `TaskConfig`/`TaskRun`，分期 **`LaunchConfig`** | 继续叫 Task | 产品先改文案；代码 rename 不阻塞 MVP |
| 中文 | 任务 / 启动（启动配置） | 运行任务（易混） | 任务=Tasks；启动=Launch |

### Tasks vs Work（决策记录）

- **选 Tasks**：与 GitHub/Linear/Jira 用户心智一致；IDE 里更像「条目列表」；和 Agent「要做什么」叙事清晰。
- **不选单字 Work**：抽象、偏软；和 worktree/workspace 英文易混；作导航标签辨识度弱。
- **Work items** 仅可作完整短语（文档/空态），不作侧栏缩略名。

### Launch vs Run（决策记录）

- **选 Launch 作为模块名**：覆盖脚本、Agent 快捷启动、Debug 配置入口、未来 Docker/compose 等「拉起」动作；与现有 `TaskRunButton` / `DebugRunButton` 同族。
- **Run** 可保留在：动词（Run this）、状态（Running）、部分命令文案；**不要**作为与 Tasks 并列的模块品牌名（易缩成 Task/Run 仍混）。
- Debug 可以是 Launch 的一种配置类型，或 TitleBar 上与 Launch 并排，不强迫第一期合并 UI。

### 文案与命令面板约定

| 位置 | 文案示例 |
| --- | --- |
| Dock / 面板标题 | Tasks |
| 空态 | Track PRs, issues, and tickets in one place |
| 原 Task 控制台 / 配置列表 | Launch |
| 命令面板前缀 | `Tasks: …` / `Launch: dev` / `Launch: test` |
| Settings 分组 | Integrations（Tasks 数据源）；Launch 配置可留在项目/应用设置 |
| 禁止 | 两个入口都叫 Task；侧栏 Task Run |

### 迁移策略（命名）

1. **P0（文档与新 UI）**：新面板只用 Tasks；新文案 Launch；代码新域 `work-items` + `WorkItem`。
2. **P1（产品文案）**：TitleBar / 菜单 / 快捷键说明中 Task Runner → Launch。
3. **P2（代码 rename，可选）**：`TaskConfig` → `LaunchConfig`，`run_task` → `launch_task` 等；需兼容层与测试，**不阻塞** GitHub Provider 迁入。

---

## 3. 统一领域模型

### 3.1 WorkItem（规范模型）

```ts
type WorkItemKind =
  | 'local_task'     // Neeko 本地任务（默认内置）
  | 'pull_request'   // GitHub/GitLab MR
  | 'issue'          // GitHub/GitLab Issue
  | 'ticket'         // Linear/Jira/Asana… 通用工作项
  | 'incident'       // 可选扩展
  | 'custom';

type WorkItemStatusCategory =
  | 'open' | 'in_progress' | 'blocked'
  | 'done' | 'cancelled' | 'merged' | 'draft';

interface WorkItemRef {
  providerId: string;      // 'github' | 'gitlab' | 'linear' | 'jira' | …
  providerItemId: string;  // 平台稳定 id
  url: string;
  webUrl?: string;
}

interface WorkItem {
  id: string;              // `${providerId}:${providerItemId}`
  ref: WorkItemRef;
  kind: WorkItemKind;
  title: string;
  description?: string;    // 摘要或 markdown
  status: {
    category: WorkItemStatusCategory;
    label: string;         // 平台原始：Open / In Review / In Progress
  };
  projectKey?: string;     // 仓库 full_name / Jira project / Linear team
  identifiers: {
    number?: number;       // #42
    key?: string;          // PROJ-88 / LIN-123
  };
  people: {
    author?: Person;
    assignees: Person[];
    reviewers?: Person[];  // PR
  };
  labels: Label[];
  priority?: { rank: number; label: string };
  timestamps: {
    createdAt: string;
    updatedAt: string;
    closedAt?: string;
  };
  // 类型扩展袋：强类型可选字段，未知 key 忽略
  pr?: {
    sourceBranch: string;
    targetBranch: string;
    isDraft: boolean;
    mergeable?: boolean;
    checks?: { pass: number; fail: number; pending: number };
    reviewDecision?: string;
  };
  repo?: {
    owner: string;
    name: string;
    remoteUrl?: string;
  };
  links?: { type: string; id: string; title?: string }[]; // PR↔Issue, Jira↔PR
  // 本地任务工作流：stage 轨道 + 可执行 transition
  workflow?: {
    stages: string[];           // e.g. ['Backlog','Ready','In Progress','Review','Done']
    currentIndex: number;       // 当前所处 stage 索引
    transitions: { from: string; to: string; label?: string }[];
  };
  // 原始载荷（调试/未来字段，不进列表渲染主路径）
  raw?: unknown;
}
```

### 3.2 Provider 契约（扩展点）

```ts
interface WorkItemProvider {
  id: string;                 // 'github'
  name: string;               // 'GitHub'
  icon: IconComponent;
  // 能力广告：UI 按 capability 显示动作，而不是 if (github)
  capabilities: ProviderCapability[];

  // 连接
  getConnectionState(ctx: ProjectContext): Promise<ConnectionState>;
  connect?(ctx): Promise<void>;
  disconnect?(ctx): Promise<void>;

  // 列表
  list(ctx: ProjectContext, query: WorkItemQuery): Promise<Page<WorkItem>>;
  // 详情
  get(ctx, ref: WorkItemRef): Promise<WorkItemDetail>;

  // 动作（可选实现；无 capability 则 UI 隐藏）
  actions?: {
    openInBrowser(item): void;
    checkoutBranch?(item): Promise<void>;
    merge?(item, opts?): Promise<void>;
    transition?(item, toStatus): Promise<void>; // Jira/Linear
    comment?(item, body): Promise<void>;
    assign?(item, person): Promise<void>;
  };
}

type ProviderCapability =
  | 'list' | 'search' | 'detail'
  | 'comment' | 'assign' | 'label'
  | 'merge' | 'checkout' | 'review'
  | 'transition' | 'time_track'
  | 'link_vcs';               // 关联 PR/commit
```

### 3.2.1 Local Provider（内置默认）

Local Provider 是 Neeko 自带的 first-party provider，无需连接第三方：

- **id**: `'local'`
- **默认启用**：用户安装/打开 Tasks 面板时即存在
- **能力**: `list`, `search`, `detail`, `comment`, `assign`, `transition`
- **工作流**: 每个 Local WorkItem 可绑定 `workflow`（stage 定义 + 当前索引 + 可执行 transitions）
- **存储**: 本地 JSON / SQLite（与 sessions/config 同级目录），不依赖外部 API
- **与第三方 Provider 的关系**: Local 任务与 GitHub/Linear 等任务在同一列表混排，通过 `provider` 字段区分；第三方 Provider 需要用户在 Settings → Integrations 中主动添加/连接

### 3.3 Query（统一筛选）

```ts
interface WorkItemQuery {
  kinds?: WorkItemKind[];
  providers?: string[];
  statusCategories?: WorkItemStatusCategory[];
  assignee?: 'me' | 'unassigned' | string;
  author?: 'me' | string;
  labels?: string[];
  text?: string;
  projectScope?: 'current_repo' | 'all_connected';
  sort?: 'updated' | 'created' | 'priority';
  cursor?: string;
}
```

---

## 4. 信息架构（页面）

### 4.1 入口

推荐作为 **右侧 Dock 面板**（或左栏一级，与 Projects 并列）：

```
Dock: Projects | Files | Git | [Tasks] | History | Browser
```

现有 Pull Requests 入口可降级为 Tasks 内筛选 `kind=PR + provider=GitHub`，避免双入口。

### 4.2 布局（IDE 密度）

**Tasks 是单一面板，Board / List 为面板内的视图切换。** 共用同一份数据、筛选状态和详情。
Provider 连接/断开在 **Settings → Integrations** 中管理，Tasks 面板内仅保留 Provider 筛选 pills。

**头部（两种视图共享）**

```
┌─ Tasks ──────────────────────────────────────────┐
│ [Board] [List]    ↻  ⚙            ← ⚙ 打开 Settings │
│ 🔍 Search…  Status: All▾  Sort: Updated▾  [Local][GH][GL][Lin][Jira]
```

**Board View：** 看板默认首页，五列卡片展示状态分布。

```
│ Backlog(5) │ Ready(1) │ In Progress(4) │ Review(1) │ Done(1)
│ ┌────────┐ │ ┌────────┐ │ ┌────────┐   │ ┌────────┐ │ ┌────────┐
│ │ LO T-2 │ │ │ GH #88 │ │ │ LO T-1 │   │ │ LO T-3 │ │ │ GL !15 │
│ │ GH #119│ │ │        │ │ │ GH #128│   │ │        │ │ │        │
│ │ LIN-55 │ │ │        │ │ │ GL #3  │   │ │        │ │ │        │
│ │ PROJ-91│ │ │        │ │ │ LIN-42 │   │ │        │ │ │        │
│ │        │ │ │        │ │ │ PROJ-88│   │ │        │ │ │        │
│ │ ＋Add  │ │ │ ＋Add  │ │ │ ＋Add  │   │ │ ＋Add  │ │ │ ＋Add  │
│ └────────┘ │ └────────┘ │ └────────┘   │ └────────┘ │ └────────┘
```

**List View：** 切换到列表后，显示 kind tab（All/Mine/Local/PRs/Issues/Tickets）+ 分组列表 + 右侧详情面板。

```
│ [All][Mine][Local][PRs][Issues][Tickets]
├──────────────────────────┬───────────────────────┤
│ 列表（虚拟滚动）            │ 详情 / 空态            │
│ · LO T-1  In Progress    │ 标题 / 状态 / 人       │
│ · GH PR #128  draft      │ Stage rail（本地任务）  │
│ · LIN-42  In Progress    │ 描述 markdown         │
│ · JIRA PROJ-9  To Do     │ 动作条（按 capability） │
│ · GL !15  merged         │ 关联分支 / 检查 / 链接  │
└──────────────────────────┴───────────────────────┘
```

小宽度：仅列表；点击在 **中心 Tab** 打开详情（复用现有 PR detail tab 模式）。


**视图切换**：Board / List 通过顶部 tab 切换；Board 为默认首页，更适合直观查看状态分布。
### 4.2a 连接提示与空态（Connect Banner）

Tasks 面板不展示 Source Strip 卡片（占空间、低频、与 Settings 重复）。

未连接第三方 Provider 时，面板顶部显示一行 inline banner：

```
┌─ Tasks ──────────────────────────────────────────┐
│ Connect GitHub in Settings → Integrations to see PRs  [Open Settings] │
└──────────────────────────────────────────────────┘
```

- **仅当存在未连接且用户可能关心的 Provider 时显示**（如当前项目 git remote 指向 GitHub 但尚未 auth）
- 已连接的 Provider 通过筛选条 `Source: All ▾` 切换可见性（数据筛选，非连接管理）
- **空态（无任务）**：列表区显示 "No tasks match your filters"，若所有 Provider 均未连接则引导至 Settings
- 连接管理统一收敛到 **Settings → Integrations**


### 4.3 列表行统一骨架

```
[kind icon] [provider badge]  Title………………  [status chip]
#key/number · repo/team · assignees · labels · updated
[PR only] base ← head · checks · review
```

### 4.4 动作条策略

| Kind | 常见动作 |
| --- | --- |
| local_task | Transition（按 workflow stages）、Assign、Comment、Agent: implement |
| pull_request | Open、Checkout、Open Diff、Merge、Request Review、Agent: review |
| issue | Open、Create branch、Comment、Close、Agent: implement |
| ticket | Open、Transition、Assign、Link PR、Agent: implement |

**禁止** 在 React 组件写死 `if (provider === 'jira')`；改为：

```ts
const actions = registry.resolveActions(item) // 按 capabilities ∩ kind
```

### 4.5 看板首页（Board View）设计

**作为 Tasks 默认首页**，Board View 以卡片列式展示任务状态分布：

| 元素 | 说明 |
| --- | --- |
| **列 = Stage** | Backlog → Ready → In Progress → Review → Done；列头显示该阶段任务数 |
| **卡片 = WorkItem** | 展示 kind icon、provider badge、标题、标签、优先级（P1/P2/P3）、指派人头像 |
| **Local 任务** | 默认显示，可直接在看板中创建（每列底部 `+ Add task`） |
| **第三方任务** | 按 `status.category` 映射到对应 stage 列混排 |
| **状态映射** | `open/draft` → Backlog/Ready；`in_progress/blocked` → In Progress；`done/merged` → Done |
| **阻塞标记** | `blocked` 任务在卡片上显示红色 `⛔ BLOCKED` 标记，但仍位于 In Progress 列 |
| **交互** | 点击卡片打开详情面板；未来支持拖拽改变 stage（transition） |
| **视图切换** | Board / List 通过顶部 tab 切换；记忆用户上次选择 |

---

## 5. 连接与作用域

### 5.1 连接配置（Settings → Integrations）

每个 Provider：


**为什么 Source Strip 从 Tasks 面板移入 Settings**

- Provider 连接是「一次性配置」，不是日常浏览动作；在 Tasks 面板常驻卡片占用宝贵空间
- 多项目场景下，同一 Provider 的连接可被多个项目共享（或按项目独立 scope）
- Settings → Integrations 是 Neeko 全局/项目级第三方连接的统一归宿，避免分散管理

**页面布局**

```
┌─ Settings ───────────────────────────────────────┐
│ General | Appearance | Integrations | Launch | …  │
├──────────────────────────────────────────────────┤
│ Integrations                                      │
│                                                   │
│ ┌─ Built-in Provider ───────────────────────────┐ │
│ │  [Local]   Local Tasks                         │ │
│ │            Always available. Stage workflows,   │ │
│ │            assign, transition.                  │ │
│ │            [Configure workflow]                 │ │
│ └────────────────────────────────────────────────┘ │
│                                                   │
│ ┌─ Third-party Providers ───────────────────────┐ │
│ │                                                 │ │
│ │  [GitHub]  Connected · tincopper               │ │
│ │            PR, Issue, Review · 2 repos linked   │ │
│ │            [Disconnect]  [Manage repos]         │ │
│ │                                                 │ │
│ │  [GitLab]  Not connected                       │ │
│ │            MR, Issue                            │ │
│ │            [Connect with GitLab]                │ │
│ │                                                 │ │
│ │  [Linear]  Not connected                       │ │
│ │            Tickets, Cycles                      │ │
│ │            [Connect with Linear]                │ │
│ │                                                 │ │
│ │  [Jira]    Not connected                       │ │
│ │            Tickets, Transitions                 │ │
│ │            [Connect with Jira]                  │ │
│ │                                                 │ │
│ └────────────────────────────────────────────────┘ │
│                                                   │
│ [＋ Add custom provider]（future）                │
└──────────────────────────────────────────────────┘
```

**Provider 卡片结构（原 Source Strip 的归宿）**

每张卡片对应一个 Provider，展示：

| 元素 | 说明 |
| --- | --- |
| **Provider icon + 名称** | GitHub、GitLab、Linear、Jira、Local |
| **连接状态** | `Connected` / `Not connected` / `Error`（带重连提示） |
| **能力摘要** | PR, Issue, Review / MR, Issue / Tickets, Cycles… |
| **已链接项目/仓库数** | GitHub: "2 repos linked" |
| **主操作按钮** | 未连接 → `[Connect]`；已连接 → `[Manage repos]` / `[Disconnect]` |
| **展开详情** | 点击卡片展开：auth 方式、默认组织、轮询间隔、项目绑定映射 |

**连接状态流转**

```
Not connected
      ↓  [Connect]
  Connecting…（OAuth 窗口 / PAT 输入 / CLI 检测）
      ↓  success
   Connected
      ↓  token expired / revoked
     Error（展示错误信息 + [Reconnect]）
      ↓  [Disconnect]
Not connected（保留项目绑定配置，方便下次重连）
```

**项目绑定映射**

在 Provider 卡片展开详情中：

```
GitHub · Connected · tincopper
───────────────────────────────
Auth:     PAT (••••ghp_xxxx)   [Edit]
Default:  tincopper
Polling:  60s                  [Edit]

Project bindings:
  neeko (current)  →  tincopper/neeko      [Unlink]
  ci-templates     →  neeko/ci-templates   [Unlink]
  [＋ Link another repository]
```

- 当前打开的项目自动置顶
- 从 git remote 推断的仓库建议自动填充，用户可确认或修改
- Linear/Jira 绑定的是 `Team/Project`，不是仓库

**与 Tasks 面板的关系**

- Settings → Integrations 是「配置源」；Tasks 面板是「消费端」
- Tasks 面板内只保留：**Connect Banner**（未连接时提示）+ **Provider filter chips**（已连接时筛选数据）
- 不在 Tasks 面板内做连接/断开操作，避免管理入口分散

### 5.2 项目作用域

默认 **Current project**：

1. 从 git remote 推断 GitHub/GitLab 仓库  
2. Linear/Jira 通过「项目绑定」：settings 里 map `projectId → jiraProject/linearTeam`  
3. 可切换 **All connected** 看跨仓个人待办（Mine 视图）

### 5.3 多环境

Work Item 本身不随 WSL/SSH 变 id；但 **checkout / 终端动作** 走当前 `ProjectEnvironment`（与现有 git/remote 一致）。

---

## 6. Provider 注册与扩展方式

```
features/work-items/
  model/          # WorkItem types, mappers
  registry.ts     # registerProvider / listProviders
  store.ts        # query state, cache, selection
  components/     # WorkItemsPanel, WorkItemRow, Detail, ConnectBanner
  providers/
    github/
    gitlab/
    linear/
    jira/
    mock/         # 原型与测试
```

**添加新平台步骤（目标）：**

1. 实现 `WorkItemProvider`  
2. `registry.register(provider)`  
3. 提供 mapper：原生 JSON → `WorkItem`  
4. 声明 `capabilities`  
5. （可选）详情子视图 slot：`DetailExtension`  

无需改列表壳组件。

---

## 7. 缓存、同步与性能

- 列表：按 `projectId + queryKey` 缓存，TTL 30–60s + 手动刷新  
- 详情：打开时拉取，后台 revalidate  
- 虚拟列表：默认  
- Provider 并行 list，前端 merge + 统一 sort（标注 partial failure）  
- 不在主进程阻塞；Rust 侧后续可做 provider 代理（本阶段仅设计）

---

## 8. MVP 范围建议

| 阶段 | 内容 |
| --- | --- |
| **MVP** | Shell UI + 模型 + Mock providers + **GitHub PR 迁入**（复用现有 gh） |
| **MVP+** | GitHub Issues |
| **V1** | GitLab MR/Issue |
| **V1.1** | Linear |
| **V1.2** | Jira Cloud |
| 并行 | Settings Integrations；Mine 跨仓视图 |

---

## 9. 风险与决策

| 风险 | 决策 |
| --- | --- |
| 与 Task Runner 撞名 | 产品 **Tasks vs Launch**；代码 `work-items`/`WorkItem` vs 现 runner；Launch 代码 rename 分期 |
| 各平台状态机不同 | 只用 `status.category` 做统一筛选；原始 label 展示 |
| PR 详情已很重 | Detail 保留 Tab 扩展，不把 diff 塞进窄面板 |
| Auth 碎片化 | Provider 自己管 auth UI；壳只显示 Connect banner |
| 过度抽象 | MVP 先 2 个真实 provider，验证 registry，再铺开 |

---

## 10. 成功标准

1. 用户在一个面板看到 PR + Issue + Ticket  
2. 新增 Provider 不改列表组件  
3. GitHub PR 体验不弱于现有 PullRequestsPanel  
4. 从任务可进入 Agent / Checkout / 浏览器  
5. 命名上开发者不混淆 runner task 与 work item  

---

## 11. Local Task CRUD 交互流程（新增）

### 11.1 总览

Local Provider 是 Neeko 内置的默认任务提供者，无需连接外部服务。用户可在 Tasks 面板直接创建、编辑、删除本地任务，并通过 Board 视图的看板列进行 stage 流转。

### 11.2 创建任务（Add Task）

```
用户操作                                 UI 响应
─────────────────────────────────────────────────────────────────
1. 点击 Board 列底部 [+ Add task]     → 弹出 Create Task 对话框
   或点击面板顶部 [+ New Task] 按钮
2. 填写表单：                          → 实时校验必填字段
   - Title（必填）
   - Description（可选，textarea）
   - Stage（预选列所在 stage）
   - Priority（P0/P1/P2/P3）
   - Labels（可选，tag 式输入）
   - Assignees（可选）
3. 点击 [Create]                       → 关闭对话框，新卡片出现在对应列顶部
                                        → 列表视图同步更新
                                        → 显示 toast "Task created"
4. 点击 [Cancel] / Escape              → 关闭对话框，不保存
```

**Create Task Dialog 示意**

```
┌─────────────────────────────────────┐
│  ✕  Create Task                     │
├─────────────────────────────────────┤
│                                     │
│  Title                              │
│  ┌───────────────────────────────┐  │
│  │ e.g. Refactor auth module     │  │
│  └───────────────────────────────┘  │
│                                     │
│  Description                        │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │ (optional)                    │  │
│  │                               │  │
│  └───────────────────────────────┘  │
│                                     │
│  Stage      Priority     Labels     │
│  ┌──────┐  ┌──────┐  ┌──────────┐  │
│  │Ready │  │ P2  │  │  + Add   │  │
│  └──────┘  └──────┘  └──────────┘  │
│                                     │
│  Assignees                          │
│  ┌───────────────────────────────┐  │
│  │ tincopper                     │  │
│  └───────────────────────────────┘  │
│                                     │
│           [Cancel]  [Create]        │
└─────────────────────────────────────┘
```

### 11.3 编辑任务（Edit Task）

```
用户操作                                 UI 响应
─────────────────────────────────────────────────────────────────
1. 点击 Board 上的任务卡片            → 右侧 Detail 面板打开
   （或点击 List 视图中的行）
2. 在 Detail 面板中点击 [Edit] 按钮   → 弹出 Edit Task 对话框
                                        （表单预填当前值）
3. 修改字段，点击 [Save Changes]       → 关闭对话框
                                        → 卡片实时更新
                                        → 列间移动（若 stage 改变）
                                        → toast "Task updated"
```

**Detail 面板中的编辑入口**

Detail 面板的操作栏包含：

```
[Open in Agent] [Checkout branch] [Edit] [···]  [×]
                                            │
                                     ┌──────┴──────┐
                                     │ Edit         │
                                     │ Delete       │ ← 危险操作
                                     │ Duplicate    │
                                     │ Share…       │
                                     └──────────────┘
```

### 11.4 删除任务（Delete Task）

```
用户操作                                 UI 响应
─────────────────────────────────────────────────────────────────
1. 在 Detail 面板中点击 [···] → [Delete]
   或右键卡片 → [Delete]
                                        → 弹出确认对话框
2. 确认对话框：
   ┌─────────────────────────────────┐
   │  ✕  Delete Task                 │
   │                                 │
   │  Are you sure you want to       │
   │  delete "Refactor auth module"? │
   │  This action cannot be undone.  │
   │                                 │
   │       [Cancel]  [Delete]        │
   └─────────────────────────────────┘
3. 点击 [Delete]                      → 卡片从 Board 移除
                                        → 列表视图同步移除
                                        → Detail 面板关闭（如打开）
                                        → toast "Task deleted"
4. 点击 [Cancel] / Escape             → 关闭对话框，不删除
```

### 11.5 Stage 流转（Transition）

```
用户操作                                 UI 响应
─────────────────────────────────────────────────────────────────
方式一：拖拽卡片
1. 在 Board 视图中拖拽卡片到另一列    → 卡片动画移动到目标列
                                        → 自动保存 stage 变更
                                        → toast "Moved to In Progress"

方式二：Detail 面板 Stage Rail
1. 在 Detail 面板中点击 Stage Rail     → 显示可用的 stage 节点
   （例如 Backlog → Ready → ●In Progress● → Review → Done）
2. 点击目标 stage                      → 高亮当前 stage
                                        → 卡片在 Board 中移动到对应列
                                        → toast "Moved to Review"

方式三：右键菜单
1. 右键卡片 → [Move to]               → 子菜单列出可流转 stage
   ├── Backlog
   ├── Ready
   ├── ● In Progress
   ├── Review
   └── Done
2. 选择目标 stage                      → 同方式一
```

**Stage Rail 控件示意**

```
Backlog  ───  Ready  ───  In Progress  ───  Review  ───  Done
   ○          ○             ●                 ○          ○
                          (current)
```

- 实心圆 = 当前 stage
- 空心圆 = 可流转 stage（根据 `STAGE_TRANSITIONS` 定义可达性）
- 灰色圆 = 不可直接流转（需先经过中间 stage）
- 点击空心圆触发 transition

### 11.6 批量操作（Future）

- 多选卡片 → 批量删除
- 多选卡片 → 批量移动 stage
- 多选卡片 → 批量分配负责人

### 11.7 交互细节约定

| 场景 | 行为 |
| --- | --- |
| 空状态（无任何任务） | 显示欢迎提示 + [Create your first task] 按钮 |
| 空列（无任务但其他列有） | 列显示 "No tasks" 占位文字 |
| 创建后 | 自动滚动到新卡片位置 |
| 删除后 | 若 Detail 面板打开且被删除项是当前选中，关闭 Detail |
| 拖拽冲突 | 乐观更新 + 后端失败时回滚并 toast 错误 |
| 键盘快捷键 | `Cmd+N` 新建，`Delete` 删除选中，`Escape` 关闭对话框 |
| 数据持久化 | 每次变更自动保存到本地 JSON（无手动保存按钮） |
| 撤销 | 删除后显示 "Undo" toast（5 秒内可撤销） |
