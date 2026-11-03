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
| `conversation` / Agent tabs | AI 会话 | Work Item 可派 `single` 执行（Open in Agent + 上下文前置），见 §3.4 |
| `agent/team/**`（**已实现**） | 队长 + 成员 + 共享任务板（SQLite + 租约） | **不合并**；Work Item 可派 `team` 执行，hub 只存指针（§3.4） |
| Git branch/worktree | 代码线 | PR 类 Work Item 可关联 branch/checkout |

---

## 2.1 产品命名（已拍板）

### 四元组（2026-11-01：加入 Run）

```text
Tasks   → 工作项 inbox（PR / Issue / Linear / Jira / …）
Launch  → 启动配置（脚本、命令、可扩展启动项；原 Task Runner）
Agent   → 执行者（会话 / 模型）
Run     → 执行派生（WorkItemRun：single / team / flow）
```

> `Run` 在这里是**名词**（一次执行记录），与 `Launch` 的进行时态 *Running…* 不是同一层：
> Launch 是“拉起什么”，Run 是“这次干得怎么样”。两者只在按钮文案上可能相邻，**不得**合并为同一模块。

| 场景 | 选用 | 不用 | 理由 |
| --- | --- | --- | --- |
| 侧栏 / Dock 工作项面板 | **Tasks** | Work | Tasks = 可处理事项列表；Work 过宽，易与 workspace/worktree 混 |
| 脚本与一键启动模块 | **Launch** | Task Run、Tasks | 与 TitleBar 的 Run/Debug/Open IDE「启动」语义一致；扩展面大于 “run script” |
| 进行中按钮态 | Running… / Stop | Launching…（可短暂） | 进行时仍可用 run 语义，模块名保持 Launch |
| 领域模型（工作项） | **`WorkItem`** | `Task` | 避免与 `TaskConfig` / `run_task` / store 撞名 |
| 领域模型（启动配置） | 现 `TaskConfig`/`TaskRun`，分期 **`LaunchConfig`** | 继续叫 Task | 产品先改文案；代码 rename 不阻塞 MVP |
| 中文 | **工作项** / 启动（启动配置） | 运行任务（易混） | 工作项=Tasks；启动=Launch；**「任务」单用只指 TeamTask** |
| 团队任务 | **团队任务**（`TeamTask`） | 任务、子任务 | 与 WorkItem 分属两个域：一个是一次执行，一个是人的工作项 |
| 人侧进度轨 | **Stage / 阶段** | workflow、workflow stage | 与「执行流程 Flow」区分；两者都叫 workflow 就是第四处撞车 |
| 执行流程 | **Flow / 流程** | Workflow、Pipeline | 人预先编排的静态图；Pipeline 易与 CI 管线混 |

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
  | 'local_task'     // Neeko 本地工作项（默认内置）
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
  // 本地工作项的阶段轨：stage + 可执行 transition（**不叫 workflow**，见 §2.1）
  progress?: {
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
- **阶段轨**: 每个 Local WorkItem 可绑定 `progress`（stage 定义 + 当前索引 + 可执行 transitions）；
  **不能**叫 `workflow`（与执行侧的 `flow` 撞车，见 §2.1）
- **存储**: **SQLite**（复用 `common/db` 的 `user_version` 迁移链，见 §8.3），不依赖外部 API
- **与第三方 Provider 的关系**: 本地工作项与 GitHub/Linear 等工作项在同一列表混排，通过 `provider` 字段区分；第三方 Provider 需要用户在 Settings → Integrations 中主动添加/连接

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

### 3.4 WorkItemRun（执行派生与执行契约）

**WorkItem 是意图，Run 是执行。** 一个 WorkItem 可派生 0..N 次执行，两者一对多、生命周期独立
（外部平台把 WorkItem 关掉了，Run 可能还在跑；Run 失败不影响 WorkItem 存在）。

```ts
type ExecutionMode =
  | 'single'   // 一个 agent 会话干完（默认，成本最低）
  | 'team'     // 交给团队：队长经 MCP 拆活、成员认领（域已实现：agent/team/）
  | 'flow';    // 用户预先编排的固定流程（人决定下一步；本期不实现引擎）

interface WorkItemRun {
  id: string;
  workItemId: string;          // `${providerId}:${providerItemId}`
  mode: ExecutionMode;
  // 指针：真相源在执行域，本字段只用于跳转与反查。
  // `single` 档的 `id` 是 **终端 tab id**（用户可见、可 `activateTab`、与 tab 同生共死），不是 PTY session id ——
  // PTY session 在 tab 挂载时才生成、应用重启 / 终端重建后不复存在，拿它当锚点会让执行记录
  // 指向一个不存在的会话（详见下方「`single` 档的指针为何是 tab id」）。
  ref:
    | { kind: 'session'; id: string /* terminal tab id（本期语义） */ }
    | { kind: 'team'; id: string; sub?: string /* teamId + 队内 taskId */ }
    | { kind: 'flow'; id: string; sub?: string /* flowId + runId */ };
  // 只读快照：离线渲染与列表徽标用，**永远不参与判定**
  snapshot: {
    state: 'queued' | 'running' | 'awaiting' | 'done' | 'failed' | 'unknown';
    label: string;             // 原域文案（如「空闲 ⚠ 未声明」），短文本 ≤ 120 字符
    capturedAt: string;        // UI 拿它算陈旧度
  };
  createdAt: string;
}
```

#### `single` 档的指针为何是终端 tab id（2026-11-02，`run-single` 落地）

| 候选 | 问题 |
| --- | --- |
| PTY session id | 在 tab 挂载时才生成。应用重启 / 终端重建后它就不存在了 —— 执行记录会指向一个**已经没有的会话**，而用户看到的是「跳转按钮点了没反应」 |
| **终端 tab id** ✅ | 由我们自己 mint（`generateTerminalTabId()`）、从建 tab 那刻就存在、`activateTab` 能据此定位。它是这条链路上唯一**可寻址**的定位点（关掉 tab 则失效，UI 如实置灰） |

字段形状不变（仍是 `{ kind, id, sub }`），收窄的只是 `single` 档的 `id` 语义：**写入面**（`work_item_run_record`）只接受这一类指针，读面按 `ref.kind` 分流跳转。

#### 决策：快照存 hub 侧，真相源在执行域（2026-11-01）

| 方案 | 代价 | 裁决 |
| --- | --- | --- |
| hub 侧不存，每次现查 | 两个域都要活着才渲染；列表 N 次跳域查询 | ❌ |
| hub 侧存全量镜像（含成员/任务明细） | 双写 + 必然漂移；任务明细过 IPC 顶红线 4 | ❌ |
| **hub 侧只存指针 + 轻量快照 + `capturedAt`** | 需要刷新策略；快照会过期 | ✅ |

`snapshot.state` 是**缓存**：列表徽标、离线渲染、跳转目标用得上；任何「做完了没有」的判定必须回域侧查
—— 团队的完成权威是任务板显式声明（`10-30` R4 / 不变量 2），`snapshot` 不得参与判定。
`unknown` 是合法状态：域侧已不存在（团队被删）时**不得**假装 `failed`。

#### 三档阶梯（按「需要多少确定性」递增）

| 档 | 谁决定下一步 | 完成判定 | 何时用 | 成本 |
| --- | --- | --- | --- | --- |
| `single` | 人（一次会话） | 会话结束 | 5 分钟的修复；探索 | 低 |
| `team` | 队长 LLM（运行时拆活） | 任务板显式声明 | 多文件并行 / 需 worktree 隔离 / 长链路 | 高（建队 + 准入 + 租约） |
| `flow` | 人（预先编排静态图） | 步退出码 / 门禁 | 反复执行的固定套路（实现→测试→lint→PR） | 中（一次性编排） |

**不得把三档压成一个视图**：`flow` 的可观测面是 run graph，`team` 是板列 + 成员六态（含「未声明」）。
压平就丢掉「未声明 ≠ 完成」这条不变量。

#### 执行契约（面板 ↔ 执行域）

```ts
interface WorkItemExecutor {
  mode: ExecutionMode;
  // 面板只给意图，不给步骤
  dispatch(input: WorkItemDispatch): Promise<WorkItemRun>;
  // 只读：刷新快照
  refresh(run: WorkItemRun): Promise<WorkItemRun['snapshot']>;
}

interface WorkItemDispatch {
  workItem: WorkItem;         // 意图（标题/正文/仓库/分支）
  projectId: string;          // 执行环境归属（项目 id，不是路径）
  workspaceRoot: string;      // 既有派生点给出的工作区根，不自拼
  agentId?: string;           // single / team 的队长 CLI
  flowId?: string;            // flow 模式
}
```

- 面板不认识 `TeamTask`、不认识 PTY —— 三个 executor 各自封装自己的域（`src/AGENTS.md` 导入防火墙）。
- `flow` 引擎未实现期间不注册该 executor，入口**置灰 + 说明原因**，不做假按钮。

#### 收敛：`flow` 的步骤执行器 = 团队的「一次性工人」（架构约束）

`10-30` 的 worker primitive 已经是「spawn 一个 CLI → 等完成信号 → 收产物引用」
（`team_spawn` + sentinel；准入只有 `admission.rs` 一处判据）。`flow` 的每一步**就是**这个 primitive：

- `flow` = 把它按**静态图**串起来（人已定序）
- `team` = 让**队长**动态排图（LLM 定序）

⇒ **两个模式共享 worker primitive，但不共享完成判定**（team 的完成必须走板声明，flow 的完成是步退出码）。
实现顺序上先抽 primitive 的下游复用点，再写 flow 引擎；**不要**为 flow 另写一套 spawn / 准入 / 完成判定
（那就是红线 15 的地方版本：同一个能力两处判据）。

补一句诚实话：`flow` 的确定性只在**控制流**上成立。步长是 agent 时，第 3 步输出什么仍然不可预测
—— 所以 v1 只做线性 + fan-out/join + 重试/门禁，**不做条件分支与循环**。

#### 回链方向：边存在 hub 侧（2026-11-01）

`TeamTask` 今天**没有**外部引用字段（`types.rs:353-370` 只有 `artifacts: Path | Commit | PullRequest`），
团队库又有 `user_version` 迁移链，所以：

- **不**给 `TeamTask` 加 `source` / `workItemRef` 列；边写在 hub 的 `WorkItemRun.ref` 上
- **不**把 `TeamTask` 注册成 WorkItem Provider（不合并模型）
- 团队板卡片上的 source badge **二期**：那需要团队侧读到 WorkItem，代价是一次迁移；v1 回链只在 hub 详情「执行」区块（§4.6）

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
│ · GH PR #128  draft      │ Stage rail（本地工作项）  │
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
| local_task | Transition（按 stages）、Assign、Comment、Run with agent |
| pull_request | Open、Checkout、Open Diff、Merge、Request Review、Agent: review |
| issue | Open、Create branch、Comment、Close、Agent: implement |
| ticket | Open、Transition、Assign、Link PR、Agent: implement |

**禁止** 在 React 组件写死 `if (provider === 'jira')`；改为：

```ts
const actions = registry.resolveActions(item) // 按 capabilities ∩ kind
```

**执行类动作**（`Run with agent` / `Dispatch to team` / `Run flow…`）不走 capability 表，统一由
`WorkItemExecutor` 发起（§3.4）并写一条 `WorkItemRun`。它们对**任何** provider 的工作项都可用（工作项只提供意图），
所以能力判据是「这档执行器在不在 + 项目环境行不行」，不是「这个 provider 支不支持」。

### 4.5 看板首页（Board View）设计

**作为 Tasks 默认首页**，Board View 以卡片列式展示任务状态分布：

| 元素 | 说明 |
| --- | --- |
| **列 = Stage** | Backlog → Ready → In Progress → Review → Done；列头显示该阶段任务数 |
| **卡片 = WorkItem** | 展示 kind icon、provider badge、标题、标签、优先级（P1/P2/P3）、指派人头像 |
| **本地工作项** | 默认显示，可直接在看板中创建（每列底部 `+ Add task`） |
| **第三方任务** | 按 `status.category` 映射到对应 stage 列混排 |
| **状态映射** | `open/draft` → Backlog/Ready；`in_progress/blocked` → In Progress；`done/merged` → Done |
| **阻塞标记** | `blocked` 任务在卡片上显示红色 `⛔ BLOCKED` 标记，但仍位于 In Progress 列 |
| **交互** | 点击卡片打开详情面板；右键卡片 [Move to] 可流转 stage（已实现，§11.5 方式三）；**拖拽改变 stage 是未来支持**（§11.5 方式一） |
| **视图切换** | Board / List 通过顶部 tab 切换；记忆用户上次选择（`localStorage` key = `neeko.work-items.view`，已实现） |
| **执行态标记** | 卡片显示最近一次执行的 mode 徽标 + 状态 chip（数据来自 `WorkItemRun.snapshot`，不参与完成判定） |

### 4.6 执行区（Detail → Executions）

详情面板底部固定一块「执行」，与字段区分离 —— **字段是外部平台的真相，执行是本机的行为**：

| 元素 | 说明 |
| --- | --- |
| 动作入口 | `Run with agent` / `Dispatch to team` / `Run flow…`；不可用时**置灰 + 一行原因**，不隐藏。2026-11-02：`Run with agent` 已可点，旁边给一个只列「有 `command` 的 agent」的原生下拉（缺省 = 项目 `selected_agents[0]`；列表拉不到时只用缺省值，**不禁用**按钮）；另两档置灰且**原因各占一行**（它们不可用的理由不同，共用一句话必定有一句是假的） |
| 执行记录 | 按 `createdAt` 倒序；每行：mode 徽标 · 状态 chip · `capturedAt` **绝对时间**（`toLocaleString`，悬停给 ISO）· **跳转按钮（✅ 2026-11-02 随 `run-single` 落地，规则见下）** |
| 陈旧标记 | `snapshot.capturedAt` 超阈（`RUN_STALE_THRESHOLD_MS` = 60s）显示「· 已过期」并给刷新按钮；**不自动轮询**。陈旧只是**渲染提示**，不参与任何完成判定 |
| `unknown` | 域侧已不存在（团队被删）时显示「已不可查」+ 最后快照时间，不得显示失败 |
| 空态 | 「还没有执行记录」+ 三个动作入口 |
| 载荷 | 一行一条摘要，`label` ≤ 120 字符；不在此渲染成员 / 团队任务明细（红线 4） |

**为什么时间用绝对值，不是「N 分钟前」**

相对时间需要一个「现在」，而渲染期读时钟是非纯渲染（同一份 props 两次渲染会给两个字符串）；
靠定时器刷相对时间又正是本节禁止的自动轮询。所以时间只呈现绝对值，陈旧度由一个**独立**的
布尔标记表达（`utils/runFreshness.ts` 的 `isStale`），「现在」只在**打开详情与手动刷新**两个
瞬间读一次。代价说清楚：敞着详情十几分钟不刷新时，徽标不会自己亮。

**跳转按钮的落地形态（2026-11-02）**

跳转目标按 `ref.kind` 分流：

| `ref.kind` | 目标 | 今天的行为 |
| --- | --- | --- |
| `session` | 终端 tab（`ref.id` = tab id，见 §3.4） | 给 [Open] 按钮：`activateTab(activeWorkspaceSession(projectId).key, ref.id)`。tabKey **必须**走 `activeWorkspaceSession(projectId).key`，不自己拼 `projectId + worktreePath` |
| `team` | 团队面板 | **不渲染按钮**（没有目标）。`run-team` 落地时补 |
| `flow` | flow run 视图 | **不渲染按钮**（引擎未实现） |

**已关闭的 tab 不当作可跳目标**：执行记录是历史，它指向的终端可能早已被关掉。渲染期用
`useEditorStore` 判断 tab id 是否还在，不在则按钮 `disabled` + `title="该会话已关闭"`。
不隐藏、不弹错：一条**看得见但置灰**的按钮与一句说明，比“点一下没反应”诚实。

**重启后这一档全部变成「已关闭」**（如实记账，不是缺陷）：编辑器 tab 不跳重启持久化
（`save_session` 只存 sidebar 宽度与 worktree 状态），所以应用重启后所有 `session` 记录都指向已不存在的 tab。
这时它们是**历史**：mode 徽标、状态、摘要、时间照常渲染，只是不再可跳。要真正“重启后还能回到那个会话”，
需要的是终端会话持久化（另一个域的能力），不是把 `ref.id` 换回 PTY session id。

**`unknown` 不参与跳转判定**：`snapshot.state === 'unknown'` 只说明域侧已不可查（团队被删 / 会话丢了），
按真实状态色渲染「已不可查」+ 保留最后快照时间；它不把按钮改成别的形态 —— 会话只要还在，历史记录就该跳得过去。

`record_run` 已由 `work_item_run_record` 开放（**只接受 `mode = single`**，见
`.trellis/spec/backend/work-items-domain.md` §5），所以这一排按钮不再是「永远点不到东西的假按钮」——
US-RUN-3 的约束到今天才被满足。

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
│ │            Always available. Stage tracks,    │ │
│ │            assign, transition.                  │ │
│ │            [Configure stages]                  │ │
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

## 8. MVP 范围（已裁决 2026-11-01）

### 8.1 里程碑与 Provider 范围

| 里程碑 | Provider | 新鉴权 | 后端要写的 | Exit 条件 |
| --- | --- | --- | --- | --- |
| **MVP** | **Local（内置）+ GitHub PR** | 无（复用 `gh auth`） | Local CRUD + stage/transition + `WorkItemRun`；GitHub 只做 **DTO 映射** | `workItems.githubProvider` 打开后 PR 体验不弱于现 `PullRequestsPanel`；Local CRUD 全通；Board/List/Detail 可用 |
| **MVP+1** | GitHub Issue | 无 | `gh issue` 读取路径（PR 的 trait 不覆盖 issue） | Issue 与 PR 同列混排、筛选正确 |
| **V1** | GitLab（MR + Issue） | `glab` CLI 或 token | 实现 `gitlab.rs`（现为 `Err` stub）+ 项目绑定映射 | 两套鉴权并存时列表组件仍无 `if (provider===…)` |
| **V1.1** | Linear | OAuth/token | tickets + transition（写） | 状态机映射不丢原始 label |
| **V1.2** | Jira Cloud | OAuth/token | tickets + transition（写） | 同上 |

**为什么 MVP 是这两个**：`common/git/pr/dispatch.rs:20-30` 的 `PrProvider` factory 里 GitHub 已全实现
（list/view/create/merge/files/commits/comments/reviews），GitLab/Gitee 是 `Err("not yet supported")` 的 stub
—— GitHub 这一档的后端成本只剩 DTO 映射；而 Local 是自有源、零外部依赖。两个源刚好把 registry 的
「能力过滤 / 状态映射 / 动作裁剪」验证一遍，不必凭原型想象第四个 provider。

### 8.2 不进 MVP（也不做半成品）

| 项 | 原因 |
| --- | --- |
| Gitee | `GitProvider` 枚举里有 ≠ 要实现；无用户诉求 |
| Review 详情子视图 | 现 `pr-detail` 已够用；迁入只做 WorkItem detail 的 PR tab |
| 跨仓 Mine 视图 | 需多仓连接态聚合，属 UI 打磨期 |
| 第三方写操作（comment / assign / merge / transition） | 一律后置到各自 provider 的里程碑内 |
| Settings 里的 GitLab/Linear/Jira 卡片 | **连「未连接」都不显示** —— 契约未验证前摆空卡片就是承诺 |

### 8.3 默认值与回滚

- `workItems.githubProvider` **默认关闭**；开发期只在本地打开，验收后再翻默认。
  迁完仍需**并联一轮**（旧 Pull Requests dock 项与 Tasks 并存），确认无回退才删旧入口。
- Local 工作项存储：**SQLite（复用 `common/db` 的 `user_version` 迁移链）**，不自造 JSON 文件
  —— `WorkItemRun` / stage / transition 都是关系型数据，JSON 单文件并发写无迁移。

---

## 9. 风险与决策

| 风险 | 决策 |
| --- | --- |
| 与 Task Runner 撞名 | 产品 **Tasks vs Launch**；代码 `work-items`/`WorkItem` vs 现 runner；Launch 代码 rename 分期 |
| 各平台状态机不同 | 只用 `status.category` 做统一筛选；原始 label 展示 |
| PR 详情已很重 | Detail 保留 Tab 扩展，不把 diff 塞进窄面板 |
| Auth 碎片化 | Provider 自己管 auth UI；壳只显示 Connect banner |
| 过度抽象 | MVP 先 2 个真实 provider，验证 registry，再铺开 |
| **命名四撞车**（2026-11-01） | WorkItem=工作项 · `TeamTask`=团队任务 · 人侧 **Stage** · 执行侧 **Flow**；`workflow` 一词禁用 |
| **执行态与团队板双真相** | hub 侧 `snapshot` 只是缓存（带 `capturedAt`）；完成判定只回执行域查（§3.4） |
| **flow 另写一套 spawn/完成判定** | 硬约束：复用 `team_spawn` 的 worker primitive，完成判定各自分开（§3.4） |

---

## 10. 成功标准

1. 用户在一个面板看到 PR + Issue + Ticket  
2. 新增 Provider 不改列表组件  
3. GitHub PR 体验不弱于现有 PullRequestsPanel  
4. 从任务可进入 Agent / Checkout / 浏览器  
5. 命名上开发者不混淆 runner task 与 work item  
6. 同一个工作项可走 single / team / flow 三种执行，三档在详情「执行」区块里可辨且互不冒充  

---

## 11. Local Task CRUD 交互流程（新增）

### 11.1 总览

Local Provider 是 Neeko 内置的默认任务提供者，无需连接外部服务。用户可在 Tasks 面板直接创建、编辑、删除本地工作项，并通过 Board 视图的看板列进行 stage 流转。

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

> **2026-11-02 修订**：本节原写「删除前弹确认对话框」，实现改成了**乐观删除 + 5 秒撤销窗口**。
> 设计写的是 A，落地的是 B，且 B 更好 —— 所以把设计改成事实，而不是把代码改回去。

```
用户操作                                 UI 响应
─────────────────────────────────────────────────────────────────
1. 在 Detail 面板中点击 [Delete]
   或选中一行按 Delete / Backspace
   或右键卡片 → [Move to] 旁边的入口     → 不弹确认框
                                        → 卡片从 Board 立即移除
                                        → 列表视图同步移除
                                        → Detail 面板关闭（如打开）
                                        → 底部出现 Undo 条：「已删除「<标题>」」
2. 5 秒内点 [撤销]                    → 该行放回**原位**（不是追加到末尾）
                                        → 后端一次删除请求都没发过
3. 5 秒过去                           → 真的提交 work_item_delete
                                        → 失败：该行自己回到列表 + 顶部错误位给原因
```

**为什么不是确认对话框**

| 方案 | 防误点 | 救「误点之后的什么」 | 额外代价 |
| --- | --- | --- | --- |
| 确认对话框 | ✅ | ❌（确认了就没退路了） | 每次删除多一次点击；对话框写「This action cannot be undone」还会**反过来**降低信任 |
| **乐观删除 + 5s 撤销** | ✅（窗口内一切可逆） | ✅（连点两下、删错行、删完才想起里面有分支名） | 一个 5 秒的延迟提交路径（见 `workItemsStore.ts` 的「延迟提交」文件头） |

两条不变量跟着这条决定一起固化：

1. **撤销窗口里那行仍然在后端**：本地只是先藏起来，5 秒后才真发删除。反过来做（立刻删、撤销时
   `create` 回来）会得到新 `id` 与新 `createdAt`，那是**偷偷改数据** —— 执行记录（
   `work_item_run.work_item_id` 外键）指向的行会直接消失，而用户以为自己只是按了「撤销」。
2. **撤销条是面板内的，不是 shared toast**：`shared/hooks/useToast` 是 3 秒且无动作按钮，
   与 5 秒窗口必然漂移；「还能不能撤销」只以 `undoDelete()` 的返回值为准（`false` = 窗口已过）。

「Escape 关闭对话框、不删除」这条旧语义仍然成立 —— 但今天的 Escape 关的是**详情面板**
（对话框的 Escape 归 Radix Dialog，一处所有），而不是一个不存在的确认框。

### 11.5 Stage 流转（Transition）

```
用户操作                                 UI 响应
─────────────────────────────────────────────────────────────────
方式一：拖拽卡片（**未来支持 —— 本期不实现**）
1. 在 Board 视图中拖拽卡片到另一列    → 卡片动画移动到目标列
                                        → 自动保存 stage 变更
                                        → toast "Moved to In Progress"

> 本期不做拖拽：①§4.5 已把拖拽标为「未来支持」；②HTML5 `dataTransfer` 在 jsdom 里不可靠，
> 为它写下的交互测试只会变成易碎品。本期落地的是方式二与方式三（Stage Rail + 右键 [Move to]），
> 两条入口共用同一个 `transition` 与同一条可达性判据（`utils/stageRail.ts`）。
方式二：Detail 面板 Stage Rail
1. 在 Detail 面板中点击 Stage Rail     → 显示可用的 stage 节点
   （例如 Backlog → Ready → ●In Progress● → Review → Done）
2. 点击目标 stage                      → 高亮当前 stage
                                        → 卡片在 Board 中移动到对应列
                                        → toast "Moved to Review"

方式三：右键菜单（**已实现**：`ui/ContextMenu` + `StageMoveMenu`）
1. 右键卡片 → [Move to]               → 菜单列出**可直接流转**的 stage
                                        （current / locked 不出现：菜单是可执行命令清单，
                                         不是阶段进度表；「为什么不能跳过去」归 Stage Rail）
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

> 2026-11-02 与实现对齐（每一项后面标了落地的实现点；口语与代码不一致时以本表为准）。

| 场景 | 行为 |
| --- | --- |
| 空状态（无任何任务） | 显示欢迎提示 + [Create your first task] 按钮 |
| 空列（无任务但其他列有） | 列显示「暂无工作项」占位文字 |
| 创建后 | 自动滚动到新卡片位置（`scrollIntoView({ block: 'nearest' })`）。**只对**本面板发起的 create 生效 —— 列表因别的原因多出一行（延迟提交的删除失败把行放回来）时**不滚**（`hooks/useRevealRow`） |
| 删除前 | **不弹确认框**：乐观移除 + 5 秒撤销窗口（§11.4） |
| 删除后 | 若 Detail 面板打开且被删除项是当前选中，关闭 Detail（由 `selectedId` 派生，不需要同步代码） |
| 拖拽冲突 | 乐观更新 + 后端失败时回滚并 toast 错误（拖拽本身本期不做，见 §11.5 方式一） |
| 键盘快捷键 | `Cmd/Ctrl+N` 新建；`Delete` / `Backspace` 删除选中；`Escape` 关闭详情（对话框的 Escape 归 Radix Dialog，一处所有）。**只在面板有焦点且焦点不在 input / textarea / contentEditable 里时生效**（判据：`utils/shortcuts.ts`；接线：`hooks/usePanelShortcuts.ts`） |
| 视图记忆 | Board / List 上次选择持久化到 `localStorage`（key = `neeko.work-items.view`）；非法值 / 存储不可用时静默回落 Board（`utils/viewPreference.ts`） |
| 数据持久化 | 每次变更自动保存到 **SQLite**（复用 `common/db` 迁移链；无手动保存按钮） |
| 撤销 | 删除后显示面板内 **Undo 条**（`components/UndoBar.tsx`，5 秒内可撤销，**不是** shared toast） |
| 快照陈旧 | `capturedAt` 超 60s 标「· 已过期」（`utils/runFreshness.ts`）；不自动轮询 |
