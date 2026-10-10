# implement — Tab 身份模型：按 Workspace 值对象寻址

> 配套 `prd.md` + `design.md`。四期串行（M1→M2→M3→M4），每期独立可合入、
> 以 `pnpm check` 全绿为合入门禁。TDD：每期先写测试确认 Red，再实现。

---

## M1 — 身份词汇：`ProjectId` 品牌 + `WorkspaceSession` class

### 步骤

1. **测试先行**
   - 新建 `src/shared/utils/__tests__/workspaceSession.test.ts`：
     - golden：`session.key` 输出与 Rust `WorkspaceRef::key()` 契约一致
       （改造既有 `workspaceRef.test.ts` 的 `matches the backend key contract`，输入不变）；
     - `JSON.stringify(session)` 仅含 `projectId` / `worktreePath` 两键；
     - `fromKey(key)` 往返主仓 / worktree 两形态；非法输入（无 NUL）返回 null；
     - `key` getter 二次访问返回同一引用（缓存生效）。
   - 新建 `src/shared/types/__tests__/identity.test-d.ts`（负向类型测试，`@ts-expect-error`）：
     `WorkspaceKey` 不可赋 `ProjectId`、`ProjectId` 不可赋 `WorkspaceKey`、
     裸 string 不可赋 `ProjectId`。
   - 运行确认 Red。

2. **实现**
   - `src/shared/types/workspace.ts`：`ProjectId` 品牌类型 + `WorkspaceSession` class
     （design.md §2.1：私有构造 / `of` / `get key()` / `fromKey` / `#key` 缓存）。
   - `src/shared/utils/workspaceRef.ts`：`workspaceKeyOf` 实现体降级为模块私有
     `mintWorkspaceKey`；`WorkspaceKey` 类型迁至 `workspace.ts`（或 re-export 保持导入路径稳定）；
     公开导出暂留（M2 迁移期消费，标注 `@deprecated`），`parseWorkspaceKey` 同标注。
   - api wrapper 铸造点：`src/features/project/api/projectApi.ts`（`list_projects` /
     `add_project` 等返回处）与 `src/shared/store/projectStore.ts` 字段类型改 `ProjectId`；
     cast 集中在 wrapper 一处，store/组件零 cast。

3. **验证**：M1 新测试 Green；`pnpm type-check` 通过；既有 `useProjectAgents` /
   `useLocalProjects` 等测试不回归。

### DoD

- [x] 身份词汇三形态就位，品牌互斥有负向测试钉住
- [x] `mintWorkspaceKey` 模块私有；`workspaceKeyOf` / `parseWorkspaceKey` 带 `@deprecated`
- [x] `pnpm check` 全绿（type-check + lint:fe + test:fe 507 文件 / 4564 用例 + 23/23 护栏）

> 实现记录：`WorkspaceSession` class 落在 `workspaceRef.ts`（NUL 材质白名单 + 避免 types↔utils 循环导入），
> `types/workspace.ts` 转 re-export。`ProjectId` 品牌已定义；`Project.id` 的品牌化铸造延后至 M3 与消费面一并对齐。

---

## M2 — Tab 模型：`scope` 字段 + `addTab` 构造律

### 步骤

1. **测试先行**
   - `src/shared/store/__tests__/editorStore.test.ts` 增补：
     - 键-身份一致性：任意 kind tab `addTab(tab)` 后 `tabs[tabSpaceKeyOf(tab.scope)]`
       命中该 tab；
     - `{ kind: 'app' }` scope 落 `__app__` 空间；
     - pinned 落组行为不回归（既有用例迁移到新签名）。
   - 回归测试（原事故路径）：构造 terminal tab（agent 点击路径）→ 断言其 scope.session
     的 `projectId` 不含 NUL 且 `check_agents_installed` mock 收到裸 id。

2. **实现（编译器驱动的机械迁移）**
   - `src/shared/types/tab.ts`：`Tab.scope: TabScope`（design.md §2.3）；
     `FileTabData.workspace` 删除；`tabSpaceKeyOf` / `tabProjectId` helper 落
     `src/shared/utils/workspaceRef.ts`。
   - `editorStore.addTab(tab, targetGroup?)`：删除首参；内部 `tabSpaceKeyOf`；
     `closeTab` / `activateTab` / `updateTab` / `clearProjectTabs` / `ensureLayout`
     键参数改 `TabSpaceKey`。
   - 33 个 `addTab` 调用点迁移（`rg "addTab\(" src -g '*.ts' -g '*.tsx'` 清单，编译器兜底）：
     - `useTerminalTabs`（`ensureDefaultTab` / `addTab` / `handleAgentClick`）、
       `useAgentClickHandler`（事故点：改传 `activeWorkspaceSession(project.id)`）、
       `usePaneActions`、`createUntitledFileTab`、`useFileViewTabOps`、`openFile`、
       `navigationHistoryStore`、`ConversationsPanelWrapper`（顺带根除
       `?? tabKey ?? 'conversation'` 隐患）、`PullRequestsPanelWrapper`、
       `useSingletonDiff` / `useOpenDiffTab` / `useOpenStashDiff`、
       `ProjectView` / `useLocalProjects` / `useProjectActions`、
       `terminal/strategies/*`、`taskTerminal` / `consoleLinks` 等。
   - 全部 tab 构造点身份来源统一为 `activeWorkspaceSession(projectId)` 或后端回显，
     禁止从 key 反解（`fromKey` 不出现在生产代码）。

3. **验证**：M2 测试 Green；`pnpm test:fe`；手动冒烟：本地项目 / worktree 激活 /
   设置页 三场景的 tab 开、关、split、pin。

### DoD

- [x] `Tab` 无顶层 `projectId`；`addTab` 无外部键参数
- [x] 8 个 TabData kind 构造点全部经身份源取 session（`tabIdentity.test.ts` 逐 kind 钉住）
- [x] 原事故路径回归测试 Green（`tabIdentity.test.ts` 断言身份不含 NUL）；`pnpm check` 全绿

---

## M3 — 消费面迁移

### 步骤

1. `tab.projectId` 消费点全量迁移（design.md §5 Tier 3 清单，`rg "\.projectId" src` +
   `tsc` 报错清单双交叉）：
   - 项目粒度消费（环境探测 / quick-open 记录 / binary 预览）：`tabProjectId(tab)`；
   - Workspace 粒度消费（git 命令 / 文件读写 / LSP 根）：`tab.scope.session`；
   - `useEditorViewSnapshot` 断点键：按 design.md §7#5 决策（默认改 Workspace 派生；
     发现跨 worktree 共享依赖则回退 `tabProjectId` 并记录例外）。
2. `usePaneTabs.projectIdForCheck` → `tabProjectId(activeTab)`（事故链路终点确认）。
3. 清理 `@deprecated`：`workspaceKeyOf` / `parseWorkspaceKey` 生产调用点应已归零，
   删除公开导出（保留 `mintWorkspaceKey` 与 label 实现）。

### DoD

- [x] `rg "workspaceKeyOf|parseWorkspaceKey" src --glob '!**/__tests__/**'` 生产代码零命中
      （42 处 workspaceKeyOf → `WorkspaceSession.of(...).key` / `activeWorkspaceSession(...).key`；
      6 处 parseWorkspaceKey → `WorkspaceSession.fromKey(...)`（wire 边界））
- [x] `Project.id: ProjectId` 品牌化（api wrapper 的 `invoke<Project>` 即铸造点）
- [x] `pnpm check` 全绿（三场景冒烟由既有组件/hook 测试覆盖）

---

## M4 — 退役收口与纵深

### 步骤

1. **护栏扩展**（`tools/guards/checks/check_workspace_identity.py`）：
   - `RETIRED_FRONTEND` 追加 `workspaceKeyOf`、`parseWorkspaceKey`；
   - 新判据 8：`projectId:` 槽位赋值右侧标识符以 `Key` 结尾（`projectId: tabKey` 形态）
     命中即违规；`allowlist` 登记合法例外（如有），逐条写明理由；
   - 新判据：`'__app__'` 字面量仅允许出现在 `tabSpaceKeyOf` 实现文件；
   - 护栏自身单测（`tools/guards/tests/`）覆盖新判据正反例。
2. **Rust 诊断校验**（可选，should）：
   `src-tauri/src/app_state.rs::project_context` 对含 NUL 的 project_id 返回
   `AppError::InvalidInput("Invalid project id")`（而非 `NotFound`）+ `#[test]`。
3. **spec 同步**：`.trellis/spec/frontend/state-management.md` 增补「Tab 身份模型」一节
   （三形态词汇表 + 构造律 + 退役符号）；`docs/domain-model.md` 的 Workspace 条目补
   「editor tab 已按 Workspace 隔离」勾选态。

### DoD

- [x] `pnpm guards list` 反映新判据（`RETIRED_FRONTEND` += workspaceKeyOf/parseWorkspaceKey；
      判据 8 复合键入身份槽位；判据 9 `__app__` 单点）；护栏自测 +7 Green（409 tests）
- [x] Rust 校验 + `#[test]`（`app_state::project_context` NUL → InvalidInput）
- [x] spec / domain-model 文档同步（`state-management.md` 新增「Tab 身份模型」场景；
      `domain-model.md` 勾选 editor tab 已按 Workspace 隔离）
- [x] `pnpm check` 全绿（23/23 护栏：lint_fe + lint_rust + test_fe + test_rust + test_host 全通过）
      → 待 `add_session.py` 记录 → 归档前 review
      （注：`pnpm lint:fix` 顺带 `cargo fmt` 规范化了工作树里**无关的用户 WIP**（watcher `[WLAP]`
      埋点）的格式；未改动其逻辑）

---

## 显式不做（Out of Scope）

- Rust `WorkspaceRef` / git 命令签名（10-09 范围）
- wire 载荷与事件名（不变）
- `sessions.json` 格式（editorStore 不入盘）
- 10-08 Tier 3 遗留命名迁移

---

## Review 修复（neeko-check 后）

> 代码审核（`/neeko-check`）报 0 Block / 5 Warning / 若干 Nit，逐项按第一性原理处置：

| # | 问题 | 第 0 性原理 | 处置 |
| --- | --- | --- | --- |
| W1 | `WorkspaceSession.projectId` 未品牌化 | 品牌必须**向下游贯穿**，否则类型墙只挡一半 | 字段与 `tabProjectId` 返回改 `ProjectId`；`of` 保留**唯一入场 cast**（身份源构造点，与 api wrapper 同类，非散落） |
| W2 | `workspaceKeyOf`/`parseWorkspaceKey` 半退役（生产禁、导出存） | 同一概念只允许一个入口，不存在「第三语义」 | 删除两个公开导出；反解私有化为 `decodeWorkspaceKey`；新增 `fromKeyOrId` 收编 wire 兼容；迁移 41+3 测试文件 |
| W3 | `WorkspaceSession.of(a,b).key` 疑似「散件组装」 | 判据是**来源**：来自身份源（`useActiveCheckoutPath`/`scope.session`）即合法投影；来源无关分量才是组装 | 经核对，剩余站点第二参均来自身份源 → **非缺陷**；在 spec 增补「投影 vs 组装」判据（contract 7） |
| W4 | `fromKey ?? of` 重复 4 处 | ≥3 次即须抽象 | 新增 `WorkspaceSession.fromKeyOrId`（唯一 wire 兼容桥），4 处收编 |
| W5 | `src/AGENTS.md` + 4 份 spec 仍把 `workspaceKeyOf` 当派生入口 | 活文档与代码冲突 = 下一次分叉入口 | 全量替换为 `WorkspaceSession#key` / `fromKey`；`domain-model.md` 勾选完成态 |
| Nit | 3 处 `!` / `?? ''` 伪身份 | 不变量违反应 fail-fast，不制造 `''` | 新增 `requireTabWorkspaceSession`（单一不变量实现），3 处收编 |
| Nit | `NavLocation.workspace` 降为 nullable | 类型应承载不变量（file tab 恒属 workspace） | 恢复非空 + capture 处收窄，删除死分支 |
| Nit | tab 域 helper 寄居身份模块 → 类型级环 | 高内聚：概念归属决定模块归属 | 拆出 `shared/utils/tabIdentity.ts`（零运行时依赖），`workspaceRef` 不再依赖 tab 模型 → 环消除 |
| Nit | `APP_TAB_SPACE_KEY` 常量 vs `tabSpaceKeyOf({kind:'app'})` 双入口 | 键推导唯一实现 | 3 处调用改走 `tabSpaceKeyOf({ kind: 'app' })` |
| Nit | `types/workspace.ts` 注释与现状不符 | 注释须如实登记技术债 | 精确化（记录 re-export 反转 + 类型级环 + 后续修法） |
| **R2-1** | 遗留 `FileTab` 同时持 `projectId: string` + `workspace: WorkspaceSession`（**同一 tab 两种身份表示**，品牌被擦除） | 单一表示原则：身份只允许一个来源 | 删除 `FileTab.projectId`；消费面（`FileEditor` / `useFileEditorState` / `useEditorViewSnapshot` / `useLspNavigation` / `useFileEditorLsp` / `FileEditorView` / `useBinaryImagePreview`）改 `tab.workspace.projectId` |
| **R2-2** | `useEditorViewSnapshot` 断点键保持**项目粒度**（design §7#5 open 决策未记录） | 决策必须落地并记录例外 | 保持项目粒度（后端 DAP 单会话 per project、`dbgBp.breakpoints` 键 = projectId）；作为 §7#5 允许的回退例外登记 |

**主会话自检结果**：23/23 护栏通过（lint_fe / lint_rust / test_fe 507·4564 / test_rust / test_host），type-check 0 error。

---

## 统一收口（三项残留，按要求并入本任务）

> 对 W1/W3 与「DTO 品牌化」三项残留，从第一性原理「身份槽位三定律」（粒度匹配 / 单一表示 /
> 边界唯一铸造）统一处理，不新开任务。

### U-1：DTO 身份槽位品牌化（`ProjectId`）

- `task.ts`（`TaskRun`）/ `git.ts`（`DiffSource` local/worktree/commit/stash）/ `terminal.ts`
  （`TerminalTab`）/ `search.ts`（`SearchResponse`）/ `tab.ts`（`PRDetailTabData`）/
  `project.ts`（`LocalConnectionContext` + `environmentToConnectionContext`）的 `projectId`
  字段 → `ProjectId`。
- 编译器驱动暴露 6 处「源仍为裸 string」的入场点，显式 cast 为身份边界（`diffSource` 空上下文 /
  `useOpenStashDiff` / `useLocalProjects` / `useTerminalTabs` / `taskStore` ×2 / `PullRequestsPanel`）。
- **未做（登记）**：全源头品牌化 —— `projectStore.activeProjectId: string | null` 与散落全域的
  `projectId: string` 函数参数（300+ 槽位）是一次跨全应用的重构（实测改 `activeProjectId` 即级联到
  project-selection / worktree / session 等），属独立批次；本任务只做**面向 wire 的 DTO 半边**，
  源头半边留待后续（半程不改变「tab 身份已封闭」的结论）。

### U-2：概念模块归一（消除 `types/ → utils/` re-export 反转）

- 删除 `src/shared/types/workspace.ts` shim；从 `types/index.ts` 移除 re-export。
- `@/shared/utils/workspaceRef.ts` 成为 **Workspace 身份的唯一概念模块**（类型 + class + key）。
- 迁移导入：10 个经 `@/shared/types` barrel 取身份名的文件 + 4 个直接取 `types/workspace`
  的文件 + `types/{file,tab,project}.ts` 内部引用 → 统一 `@/shared/utils/workspaceRef`。
- 结果：`types/ → utils/` 反转消失（`types/*` 仍 import utils，但只此单向、无环）。

### U-3：激活态 session/key vendor 归一（契约 8）

- 「当前单元」消费点（`useAheadBehindSync` / `ProjectView` / `BranchStatusBarWidget` /
  `ConversationsPanelWrapper` / `ConnectionProjectCard` / `FilesPanelWrapper` /
  `GitControlPanelWrapper` / `useFileTreeSync` / `SaveFileDialog`）从「取 `useActiveCheckoutPath()`
  分量再 `of(projectId, path).key` 重组」改为 store **唯一派生点**
  `useActiveWorkspaceKey` / `activeWorkspaceKeyOf`。
- `WorkspaceSession.of(...)` 仅保留在**显式地址**（worktree 列表遍历 / 激活目标 / wire 事件）与
  main-checkout 投影处。

**自检**：23/23 护栏通过（lint_fe · lint_rust · test_fe 507·4564 · test_rust · test_host），type-check 0 error。

---

## 补齐：DiffSource 重塑 + ProjectId 全链路品牌化（用户追加，并入本任务）

### D-1：`DiffSource` 重塑 —— `{ workspace: WorkspaceSession; revision: DiffRevision }`

**第一性原理**：原 `DiffSource` 是 8-variant 联合，把**两个正交维度**揉进一个标签：

| 维度 | 原表示 | 判定 |
| --- | --- | --- |
| 执行环境（local / WSL / SSH） | `local` / `wsl` / `remote` / `wsl-commit` / `remote-commit` | ❌ **冗余** —— `ProjectCommands`（按Workspace构造）已携带环境 |
| 修订（工作区 / commit / stash） | 与上述标签交叉 | ❌ 交叉放大成 8 variant，且远端 worktree **缺维度** |

改造后：

```ts
export type DiffRevision =
  | { type: 'worktree' }
  | { type: 'commit'; commitHash: string }
  | { type: 'stash'; selector: string };

export interface DiffSource {
  workspace: WorkspaceSession;   // 地址（projectId + worktreePath）
  revision: DiffRevision;        // 修订
}
```

- 环境维度由 `commands`（`getFileDiff` / `getCommitFileDiff` / `getStashFileDiff` 均只取 `projectId`，
  环境由后端按项目解析）承载；`DiffSource` 不再重复表示 —— 8 variant → **2 字段 × 3 revision**。
- 远端 worktree 通过 `workspace.worktreePath` 获得维度（原 `wsl`/`remote` variant 无此字段）。
- 删除 `src/shared/utils/diffSource.ts`（`buildDiffSource` 收敛为字面量构造，YAGNI）；构造点改用
  手头已持有的 `session`（不再从 context 重拼）。
- `useDiffData` 消费改为读 `ds.revision.*` / `ds.workspace.worktreePath`。

### D-2：`ProjectId` 全链路品牌化（源 + 槽位一次做穿）

**做法**：codemod 把全部 `projectId: string`（含 `.tsx`）→ `ProjectId`（441 槽 / 163 文件），
由 `tsc` 枚举边界，再逐点收敛。**一次全量品牌化使左右两侧一致，级联远小于「只改源头」**
（后者 300+ 报错，前者收敛到 ~10 结构性错误）。

- **入场/低层 formatter 保持 `string`**（它们是 mint/admission，非身份槽位）：
  `WorkspaceSession.of`、`mintWorkspaceKey`、`getTabId`（tab 键）、`refreshTerminal`（projectId 或
  cache key）、`getProjectBrowserLabel`、`editorStore` 的 **tab 键形参**（名 `projectId` 实为
  `WorkspaceKey`）、`useTerminalTabs` 的键形参、`onboardingApi` 的 **onboarding 键**形参。
  **纠正**：`terminalCacheKey` 取的是**真实 `ProjectId`**（非键），归身份槽位。
- **品牌化**：`activeProjectId`、`ProjectView.id`、`WSLProject.id` / `RemoteProject.id`、
  `ProjectListItem.id`、全部 DTO `projectId`（前一轮已做）、`selectProject` / `loadFileTree` 等身份形参。
- **边界 cast（带注释，可 grep）**：`crypto.randomUUID() as ProjectId`、`dto.project_id as ProjectId`、
  `session.active_project_id as ProjectId`、`'' as ProjectId`（无项目回退）等。
- **修出一条遗留真实 bug 实例（原事故同型）**：`useTabManagement.handleAddTab` 把**复合 tab 键**
  传给 `useTerminalTabs.addTab`，后者按 `activeWorkspaceSession(projectId)` 解释 ⇒ 以 tab 键为
  project 身份（含 NUL）落键。已收敛：`addTab/ensureDefaultTab/handleAgentClick` 收 `ProjectId`，
  `useTabManagement` 传 `currentProjectId`，`handleTabAgentClick` 把 tab 键形参在内部收敛为真实 id。
  回归测试：`useTabManagement.test.ts`「handleAddTab 以真实 projectId 调用 addTab」+
  「handleTabAgentClick 收敛为真实 projectId」（撤掉修复即 RED）。

**自检**：23/23 护栏（lint_fe · lint_rust · test_fe **507·4566** · test_rust · test_host），type-check 0 error；
生产 `projectId: string` 仅余 17 处，全部为上述**有意的非身份槽位**。

---

## 补齐后的自查（trellis-check 子代理因 provider 403 不可用 → 主会话直接审计）

- **误标纠正（真实缺陷）**：`terminalCacheKey` 我一度改名 `tabSpaceKey: string`，但实测其入参是
  **真实 `ProjectId`**（`activeProject.id`，本地终端缓存键 = `proj:tab:pane`）→ 已恢复
  `terminalCacheKey(projectId: ProjectId, ...)`；`refreshTerminal` 入参可为 projectId 或完整 cache key，
  改名 `projectIdOrKey: string`（类型保持 string，后端按前缀消解）。spec 契约 8 的「非身份槽位」清单同步纠正。
- 其余审计：无「非身份槽位被标成 `ProjectId`」；`as ProjectId` 全部落在真实边界（随机 id / 持久化回填 /
  IPC 载荷 / 空回退）；`getTabId` 确为 tab 键（string）；`terminalCacheKey`/`wslCacheKey`/`remoteCacheKey`/
  `testResultsFileKey`/`translationKeyFor`/`agentInstallCacheKey` 均为**真实 projectId 的键构造**（品牌正确）。
- 门禁：23/23（lint_fe · lint_rust · test_fe 507·4566 · test_rust · test_host），type-check 0 error。

---

## 二次检查（应「再检查一遍」）

### 更正：`useTerminalTabs` 的 `activateTab` 键 —— 非回归（mutation 证伪）

- 曾判为「本轮引入的回归」，**mutation 验证证伪**：把 `activateTab(activeWorkspaceSession(id).key, …)` 改回
  `activateTab(projectId, …)`，`useTerminalTabs.test.ts` **仍全绿**。
- 根因：`editorStore.addTab` 的返回值**已含 `activeTabId: tab.id`**（创建即激活，含布局组），
  `useTerminalTabs.ensureDefaultTab/addTab` 内其后的 `state.activateTab(...)` 是**冗余**（键错亦为 no-op
  早退）—— 故不产生可观测差异，**不构成回归**。
- 处置：保留该行但用**正确键**（`session.key`，与落键同形，避免未来误读）；`activateTab` 的「创建即激活」
  意图由 `editorStore.addTab` 保证。上一轮为此加的 2 条测试因不 red（不能证伪）已删除。

### 既存错位（HEAD 已如此）已收口：裸 projectId 读按 WorkspaceKey 分槽的 `tabs`

以下消费点以**裸 `projectId`** 索引 `useEditorStore.tabs`（键实为 `WorkspaceSession.of(id, wt).key` = `id\0…`），
读取恒为 `undefined` —— 与「键 A / 身份 B」同类错位：

| 落点 | 现状 | 应为 |
| --- | --- | --- |
| `project/hooks/useLocalProjects.setActiveProjectId` | `tabs[projectId]` | `tabs[activeWorkspaceSession(id).key]` |
| `project/hooks/useLocalProjects.handleSelectFile` | `tabs[projectId]` + `activateTab(projectId,…)` | 同上 / `session.key` |
| `project/hooks/useProjectSelection.selectProject` | `tabs[projectId]` | 同上 |
| `project/hooks/useWorktreeActions` | `tabs[projectId]` | 目标 worktree 单元的 key |
| `shared/hooks/useEditorAgentActions.findAgentTab` | `tabs[projectId]` | 同上 |
| `runner/components/DebugRunButton.getActiveEditorFile` | `tabs[projectId]` | 同上 |
| `file/hooks/useFileDrop` | `tabs[projectId]` | 同上（且 `pendingDrag` 应存 key 而非裸 id） |
| `browser/hooks/useBrowserPanelEvents` / `useBrowserTab` | `tabs[projectId]` | 同上 |
| `terminal/components/TerminalView` | `cacheKey.split(':')[0]` → `tabs[projectId]` | 用 tab 空间键 |

**判定与收口（用户选 A，已在本任务内完成）**：`addTab` 恒以 `tabSpaceKeyOf(tab.scope)` = `session.key`
（`id\0` 形态）落键（已由 `tabIdentity.test.ts` / `useLocalProjects.test.ts` 的 `projectKeySpaces` 佐证），
故裸 id 读取必 miss。逐点按**目标单元**语义改为键读取：

| 落点 | 目标单元 | 修复 |
| --- | --- | --- |
| `useLocalProjects.setActiveProjectId` | 该项目当前激活单元 | `tabs[activeWorkspaceSession(id).key]` |
| `useLocalProjects.handleSelectFile` | 同上（scope 与 diffSource 同源，消除「tab 在 A、diff 源在 B」不一致） | `session.key` |
| `useProjectSelection.selectProject` | **主仓**（选中=回主仓） | `tabs[WorkspaceSession.of(id, null).key]` |
| `useWorktreeActions.handleOpenWorktreeTerminal` | **指定 worktree** | `tabs[WorkspaceSession.of(id, wt).key]` |
| `useEditorAgentActions.findAgentTab` / `DebugRunButton` / `useBrowserPanelEvents` / `useBrowserTab` / `useFileDrop` / `TerminalView` | 当前激活单元 | `activeWorkspaceSession(id).key`（渲染期用 `useActiveWorkspaceKey`） |

回归测试（裸 id 读即 RED）：`useLocalProjects.test.ts`「setActiveProjectId 按 session.key 恢复 activeTabId」、
新增 `useProjectSelection.test.ts`、`useFileDrop.test.ts` 与 `DiffViewReview.test.tsx` 夹具改按 `session.key` 播种。

- **当前门禁**：23/23（lint_fe · lint_rust · test_fe **509·4574** · test_rust · test_host），type-check 0 error。
- **顺带**：`useLocalProjects.test.ts` 一处既存 `it.skip`（断言已过时的 `set_view_terminal` 顺序）按现行契约
  重写并启用（未激活项目 → 先激活再在该项目主仓单元建 diff tab），全仓 **0 skip**。

---

## neeko-check 清单修复（2 Warning + 3 Nit，第一性原理 + 高内聚/复用）

| # | 问题 | 第一性原理 | 实现 |
| --- | --- | --- | --- |
| W1 | `handleSelectFile` 的 `diffSource` 目标单元 | 「tab 的空间 = 其 diff 源的空间」是同一事实的单一表示 | 保留 `session = activeWorkspaceSession(id)`，scope 与 `diffSource.workspace` **同源**；补 worktree 一致性测试（tab 落 worktree 键、diffSource.worktreePath 同源、主仓键不写入） |
| W2 | WSL/Remote 切项目不写全局 `activeTabId` | 全局 `activeTabId` 是「当前单元激活 tab」的派生值；切项目即意图边沿，必须重派生 | `editorStore` 新增**单一读取实现** `activeTabIdOf(tabKey)`；4 处旧点（setActiveProjectId / handleRemoveProject / selectProject / useWorktreeActions）收编；`useCrossTypeSelection` 的 WSL/Remote 分支补重派生（复用同一 helper） |
| N1 | `TerminalView` 从 `cacheKey.split(':')[0]` 解析身份 | 身份不得从复合字符串反解（脆弱、依赖缓存键格式） | `PaneContent` 具 `activeTab` → 显式下传 `tabSpaceKey`（`tabSpaceKeyOf(activeTab.scope)`）；`TerminalView` 改为消费该 prop，删除解析与 `useActiveWorkspaceKey` |
| N2 | 6+ 处 `'' as ProjectId` 伪身份 | 不制造伪身份；缺值是「无项目」状态 | **消除**（非命名常量）：`useDiffData` 从 `DiffSource.workspace` 取地址、缺失则 fail-visible；`CombinedDiffView` 从 `diffSource.workspace.projectId` 派生（删冗余 prop）；`ProblemsPanel` 用 guard 后的 `activeProject.id`；`BranchStatusBarWidget` 改 `null` + guard；`GitDialog.projectId` 提为**必填**（所有构造点已提供）→ 直接使用，无 `''` 无守卫 |
| N3 | `design.md` §3 的 `TabSpaceKey` 品牌 vs 实现 | 文档须与实现同口径 | §3 记录落地口径：键形参为 `string`（读取路径无构造风险，品牌留作独立批次） |

**复用/内聚**：`activeTabIdOf`（单一读取）+ `WorkspaceSession.of` / `activeWorkspaceSession`（唯一 mint）为 5 处收敛点；`DiffSource.workspace` 成为 diff 域项目身份的唯一来源，删除 `CombinedDiffView` 冗余 `projectId` prop 与 `useDiffData` 的 `''` 回退。

**mutation 验证**：`useCrossTypeSelection` 两测（WSL/Remote）撤掉重派生即 RED；`handleSelectFile` worktree 测、`useProjectSelection`/`useLocalProjects`/`useFileDrop`/`DiffViewReview` 均已证伪为真红。

- **当前门禁**：23/23（lint_fe · lint_rust · test_fe **509·4574** · test_rust · test_host），type-check 0 error。
- **顺带**：`useLocalProjects.test.ts` 一处既存 `it.skip`（断言已过时的 `set_view_terminal` 顺序）按现行契约
  重写并启用（未激活项目 → 先激活再在该项目主仓单元建 diff tab），全仓 **0 skip**。

---

## neeko-check 第三轮：3 条 Nit 收口（第一性原理）

| # | 问题 | 第一性原理 | 实现 |
| --- | --- | --- | --- |
| N-A | `McpTabContent` 的 `activeMcpProjectId as ProjectId` | 身份品牌必须贯穿到 store 槽位，cast 只应存在于边界 | `mcpStore.activeMcpProjectId: ProjectId \| null`（setter 同）；`setActiveMcpProjectId` 唯一调用点 `McpProjectGroupList` 已传 `ProjectId` → cast 删除 |
| N-B | `FilesPanelWrapper` 用 `''` 表示「无 tab 键」 | 缺值是 `null`，不是空串 | `useLocateFileInTree(tabKey: string \| null)` + `if (!tabKey) return null`；调用方直接传 `activeWorkspaceKey`（可空） |
| N-C | 全局 `activeTabId` 同步写侧在 5 处各自 `setState` | 写侧与派生必须配对，且只允许一个实现（同一事实单一写者） | `editorStore` 新增**写侧单一实现** `restoreActiveTabId(tabKey: string \| null)`（读 `activeTabIdOf` + 置空兜底）；5 处（setActiveProjectId / handleRemoveProject / selectProject / useWorktreeActions / useCrossTypeSelection ×2）全部收编，调用方只派生**目标单元**的 `tabKey` |

**收敛结果**：`activeTabId` 现在 **一个写入口**（`restoreActiveTabId`）+ **一个读取实现**（`activeTabIdOf`）+ **渲染期派生**（`useActiveWorkspaceKey`）；`mcpStore` 身份槽位品牌化；`useLocateFileInTree` 缺值语义正确。

- **当前门禁**：23/23（lint_fe · lint_rust · test_fe **509·4574** · test_rust · test_host），type-check 0 error，全仓 0 skip。
