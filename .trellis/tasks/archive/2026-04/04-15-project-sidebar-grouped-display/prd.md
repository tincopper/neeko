# Project Sidebar Grouped Display

## Goal

将本地项目侧边栏改为三层结构：`Project 分组头` -> `local primary 行` -> `worktree 行列表`。该结构需要保留现有 terminal、diff、git、快捷键与会话持久化行为。

## What I already know

* 需求目标是先完成方案设计，当前阶段不修改代码。
* 当前本地项目渲染入口在 `src/components/panels/ProjectsPanel.tsx`，本地项目通过 `projects.map(project => <ProjectItem ... />)` 输出。
* 当前 `ProjectItem` 头部同时承担“项目组头 + local 主项目入口”职责；其展开体中展示 `Changes` 与 `WorktreeList`。
* worktree 数据来源是 `project.git_info.worktrees`，不是独立 `Project` 实体。
* worktree 活跃态与打开态由 `useWorktreeState` 维护，键为 `projectId` + `worktreePath`。
* worktree diff 状态由 `App.tsx` 的 `worktreeDiffState` 维护，切换项目时会重置。
* 项目排序能力已存在，`reorder_projects` 仅对顶层 `project.id` 生效。
* 会话持久化里仅保存顶层项目与 `worktree_state: HashMap<projectId, wtPath>`，当前需求无需新增后端字段。

## Constraints from Repo

* 需要保持 `Project`、`GitInfo`、`Worktree` 的 TS/Rust 结构兼容。
* `onSelectProject`、`onBackToMainTerminal`、`onOpenWorktreeTerminal`、`onSelectWorktreeFile` 回调链路已在 `useAppCallbacks` 固化。
* 侧边栏 hover 操作按钮、激活态样式依赖 `gh-project*` 类名与 `src/styles/index.css` 规则。
* 项目拖拽排序在 `ProjectItem` 内实现，改造后仍需保留顶层拖拽语义。

## Research Notes

### In-repo comparable patterns

* `RemoteItems.tsx` 已实现“分组头 + 子项卡片”层级渲染，可复用其展开/折叠与层级缩进思路。
* 本地 `WorktreeList.tsx` 已具备 worktree 行能力：打开 terminal、显示分支、删除、重命名、读取 changed files。

### Feasible approaches

**Approach A: 在 `ProjectItem` 内拆分视觉层级（推荐）**

* How
  * 保持 `ProjectItem` 的输入输出接口不变。
  * 将现有头部拆成 `ProjectGroupHeader` 与 `LocalPrimaryRow` 两个可读性更高的局部渲染块。
  * `WorktreeList` 改为“直接行列表”模式，移除 `Worktrees` 小节标题，使结构与参考图一致。
* Pros
  * 最小改动，回归面小。
  * 不触及后端与跨域状态。
  * 易于和现有交互保持一致。
* Cons
  * `ProjectItem` 体积继续增长，需要额外约束组件职责。

**Approach B: 新增本地侧边栏 ViewModel 层**

* How
  * 在 `ProjectsPanel` 先把 `Project` 转成 `SidebarProjectGroup`，再由展示组件消费。
  * `ProjectItem` 变为纯展示，worktree/local 统一走节点渲染。
* Pros
  * 结构清晰，后续支持更多子节点类型更容易。
* Cons
  * 需要改动更多文件与类型，验证面更大。

**Approach C: 抽象本地/WSL/Remote 为统一分组渲染内核**

* How
  * 将 `ProjectItem` 与 `RemoteItems` 中重复结构抽为共享 GroupCard + ChildRow 体系。
* Pros
  * 长期复用价值最高。
* Cons
  * 超出当前需求范围，重构风险高。

## Expansion Sweep

### Future evolution

* 可能增加 “Project 分组级统计” 展示，例如子项数量、总变更数。
* 可能增加节点级筛选与搜索，层级结构需保持稳定键。

### Related scenarios

* WSL/Remote 未来可能希望保持同一层级语义。
* 键盘导航当前以顶层项目为单位，后续可能扩展到子节点焦点导航。

### Failure and edge cases

* 非 Git 项目没有 `git_info` 时，`local` 行仍需可点击打开 terminal。
* worktree 被删除后，若该 worktree 正在激活，需要回退到 `local`。
* 同名 worktree 显示需避免和项目名冲突，建议以目录名显示、路径作 tooltip。

## Requirements

* 本地项目区采用三级层级展示：`Project` 头、`local` 行、`worktree` 行。
* 每个 Project 分组内 `local` 永远排在第一项，代表 Primary Project。
* worktree 行来源于 `project.git_info.worktrees`，排序规则可配置为创建顺序或按名称排序。
* 点击 `local` 行行为等同当前点击项目头进入主 terminal。
* 点击 worktree 行行为等同当前打开 worktree terminal。
* `local` 与 worktree 均展示分支徽标；保持现有 hover 动作按钮能力。
* 顶层项目拖拽排序保持有效，子项不参与顶层拖拽。
* 不修改 Rust 命令与持久化结构。

## Acceptance Criteria

* [ ] 本地项目在视觉上明确呈现 Project -> local -> worktree 层级。
* [ ] 现有快捷键与回调行为保持：项目切换、worktree 打开、diff 查看。
* [ ] 删除或重命名 worktree 后，列表刷新与状态回退正确。
* [ ] 非 Git 项目显示兼容，不出现空白异常区块。
* [ ] 顶层拖拽排序行为与持久化顺序保持正确。

## Definition of Done

* 新增或更新前端测试覆盖以下行为：层级渲染、点击 local、点击 worktree。
* `pnpm test` 与 `npx tsc --noEmit` 通过。
* 与现有 WSL/Remote 展示逻辑互不影响。

## Out of Scope

* 不改动 WSL/Remote 侧边栏结构。
* 不新增后端字段与存储迁移脚本。
* 不进行全局视觉重设计。

## Technical Approach draft

采用 Approach A 作为 MVP：

1. `ProjectItem.tsx` 仅调整为“分组头 + local 子行 + worktree 子行”，保持外部 props 不变。
2. `WorktreeList.tsx` 提供简化模式，直接渲染 worktree 行，不展示 `Worktrees` 标题。
3. 样式改动限定在本地项目相关 class，复用现有 `gh-project` 语义，避免影响 WSL/Remote。
4. 补充 `ProjectItem` 级测试，覆盖三层渲染和点击路由行为。

## Decision ADR-lite

Context: 需要在最小风险下完成显示语义重构。
Decision: 采用 Approach A。
Consequences: 交付速度快，代码抽象度中等；后续如果扩展跨域统一，再评估 Approach B/C。

### 交互决策（已确认 2026-04-15）

1. **组头点击行为**：仅折叠/展开子内容，不触发 `onSelectProject`。选中项目必须点击 `local` 行。
2. **Changes 归属**：Changes 作为 `local` 行的子内容，展开 `local` 行后显示。worktree 行各自有独立的 Changes。
3. **非 Git 项目**：统一显示 `local` 行（无分支标签），保持一致的视觉语言。折叠后隐藏，展开后只有一个 `local` 子项。
4. **Branch dropdown**：从组头移到 `local` 行右侧。checkout 只影响 local primary，放在 `local` 行语义更精确，组头更简洁。

### 视觉结构确认

```
Git 项目:
  ProjectGroupHeader (click = toggle collapse)
    ├─ local 行 [branch:main v] (click = onSelectProject)
    │   └─ Changes (3)          ← local 展开后显示
    │       ├─ src/foo.ts
    │       └─ src/bar.ts
    └─ worktree-A 行 [feat-x]  (click = onOpenWorktreeTerminal)
        └─ Changes (1)          ← worktree 展开后显示
            └─ src/baz.ts

非 Git 项目:
  ProjectGroupHeader (click = toggle collapse)
    └─ local 行 (无分支标签)   (click = onSelectProject)
```

## Technical Notes

* 关键文件
  * `src/components/panels/ProjectsPanel.tsx`
  * `src/components/project/ProjectItem.tsx`
  * `src/components/project/WorktreeList.tsx`
  * `src/hooks/useAppCallbacks.ts`
  * `src/hooks/useWorktreeState.ts`
  * `src/styles/index.css`
* 后端约束
  * `src-tauri/src/state/project.rs`
  * `src-tauri/src/state/session.rs`
  * `src-tauri/src/project.rs`
  * `src-tauri/src/commands/git.rs`
