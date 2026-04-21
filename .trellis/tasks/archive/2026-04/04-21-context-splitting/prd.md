# Context 拆分优化

## Goal

解决前端状态架构的三重问题：Context 膨胀（8 个 Context 共 93 个属性）、双数据源（hooks 持有状态同时同步到 Zustand）、mega-hook 编排层（useAppContainer 617 行）。

核心方向：**Zustand 作为唯一数据源，消除同步层，Context 仅保留 Tauri invoke 副作用注入**。

分三阶段增量迁移，每阶段独立可交付。

## Current State

### Context 架构（8 个 Context，7 层嵌套）

| Context | 属性数 | 状态 | 回调 | 核心问题 |
|---------|--------|------|------|----------|
| AppContext | 5 | 4 | 1 | 可接受 |
| SidebarContext | 4 | 2 | 2 | 合理，不动 |
| **SkillContext** | **18** | 7 | 11 | 数据 + UI 对话框 + CRUD 混杂 |
| ProjectStateContext | 11 | 11 | 0 | 项目状态和文件树状态混合 |
| **ProjectActionsContext** | **17** | 0 | 17 | 项目/文件/Worktree 回调全塞一起，7 个 optional |
| **WslContext** | **16** | 6 | 10 | 与 RemoteContext 结构几乎一致 |
| **RemoteContext** | **16** | 6 | 10 | 与 WslContext 并行重复 |
| EditorContext | 10 | 6 | 4 | 中度膨胀 |

### 数据流架构（当前问题的根源）

```
hooks (useState 持有状态)
  ↓ 产出原始状态
useAppContainer (617 行 mega-hook，调用 15+ 子 hooks)
  ↓ 编排 + 跨域协调
useSyncToStore (20+ 字段镜像到 Zustand)  ← 双数据源的来源
  ↓
buildContextValues (纯直传，无转换)       ← 无效抽象
  ↓
AppProviders (7 层嵌套)
  ↓
组件同时从 Context 和 Store 读取          ← 消费端混乱
```

**关键发现**：

1. **Zustand 并非闲置**：`useLocalProjects`、`useRemoteProjects` 等 hooks 已直接从 store 读取状态（如 `projects`、`activeProjectId`），同时这些值又被 `useSyncToStore` 从 hooks 写回 store — 形成双向同步
2. **`useAppContainer` 是最大的膨胀源**：617 行，调用 15+ hooks，承担状态编排、跨域清理、Context 构建、Props 分发四重职责
3. **`buildContextValues` 是纯直传**：输入即输出，零转换逻辑，应在迁移中移除
4. **`useSyncToStore` 是过渡产物**：将 hooks 的 useState 数据镜像到 Zustand，属于双源同步，迁移后应消除

### 已有基础设施

- **Zustand store** (`src/store/appStore.ts`)：已有 20+ 字段，部分 hooks 已直接读取，但写入仍由 `useSyncToStore` 镜像
- **Context 分两个目录**：`src/context/`（旧：App, Sidebar, Skill）和 `src/contexts/`（新：ProjectState, ProjectActions, Wsl, Remote, Editor），需统一
- **Provider 嵌套**：AppProviders.tsx 中 7 层嵌套

## Decision (ADR-lite)

### D1: Zustand 作为唯一数据源，消除双向同步

**Context**: 当前 hooks 用 useState 持有状态，再通过 `useSyncToStore` 镜像到 Zustand，组件同时从两处读取。
**Decision**: 让 hooks 直接操作 Zustand store（`useAppStore.setState` / `useAppStore.getState`），移除 hooks 内部的 useState 和 `useSyncToStore` 同步层。
**Consequences**: 数据源归一，消除同步开销和一致性风险。hooks 从"状态持有者"变为"action 提供者"。

### D2: WSL + Remote 合并为泛型 Connection 抽象

**Context**: WslContext（16 属性）和 RemoteContext（16 属性）结构高度相似。
**Decision**: 合并为统一的 Connection 抽象，使用 discriminated union 区分 WSL/SSH 类型。
**Consequences**: 改动面较广（需要改消费者组件的类型判断），但长期维护成本显著降低，为新增连接类型（Docker 等）预留扩展点。

### D3: 分三阶段增量迁移

**Context**: 一次性重构风险过大。
**Decision**: 按域拆分为三个 Phase，每个 Phase 独立可交付。
**Consequences**: 中间状态会有新旧模式短暂并存，但每个 Phase 都可以独立测试和回滚。

### D4: Action 分类决定归属

**Context**: ProjectActionsContext 有 17 个回调，拆成 3 个 Context 会增加嵌套层数（与目标矛盾）。
**Decision**: 按 action 类型决定归属：
- **纯状态变更**（如 `selectProject`、`closeTab`）→ Zustand action，不需要 Context
- **Tauri invoke 副作用**（如 `onRefreshGit`、`onOpenIde`、`onFileSave`）→ 保留在 Context 中注入

**Consequences**: Context 只保留真正需要依赖注入的副作用操作，属性数大幅减少，同时不增加 Provider 嵌套。

## Requirements

### 通用原则

- **R1. Zustand 唯一数据源**：所有共享状态由 Zustand store 持有，hooks 通过 `useAppStore.setState` 写入，组件通过 selector 读取
- **R2. Context 仅注入 Tauri 副作用**：Context 只保留需要 Tauri invoke / event 等外部副作用的 action 函数
- **R3. 消除同步层**：移除 `useSyncToStore` 和 `buildContextValues`
- **R4. 拆解 useAppContainer**：每个 Phase 同步简化此 hook，最终目标是消除或缩减为轻量编排
- **R5. 统一目录结构**：合并 `src/context/` 和 `src/contexts/` 为 `src/contexts/`

### Phase 1：Project 域（ProjectState + ProjectActions → Zustand + 精简 Context）

**目标**：消除 ProjectActionsContext 的 17 属性膨胀，将 ProjectStateContext 的状态完全迁移到 Zustand

**R1.1 重构 Zustand project slice**
- store 已有 `projects`、`activeProjectId`、`activeProject` 字段
- 将这些字段的写入从 hooks 的 useState → 直接 `useAppStore.setState`
- 新增 worktree 状态：`activeWorktreePath`、`activeWorktreeBranch`、`worktreeDiffState`
- 新增 Zustand actions：`setActiveProject(id)`、`removeProject(id)`、`clearWorktreeForProject(id)` 等纯状态变更

**R1.2 创建 Zustand file slice**
- 迁移文件状态：`fileTree`、`fileTabs`、`activeFileTabId`、`fileViewLoading`、`activeFilePath`
- 新增 Zustand actions：`selectFile(path)`、`closeTab(tabId)`、`activateTab(tabId)`、`updateTabContent(tabId, content)` 等纯状态变更

**R1.3 瘦身 ProjectActionsContext**
- 移除纯状态变更（已成为 Zustand actions）
- 仅保留 Tauri invoke 副作用：

```typescript
interface ProjectActionsContextValue {
  onRefreshGit: (projectId: string) => void;
  onOpenIde: (projectId: string) => void;
  onSaveProjectSettings: (projectId: string, agentId: string | null, ideCommand: string | null) => void;
  onDragEnd: (draggedId: string, targetId: string) => void;
}
```

**R1.4 移除 ProjectStateContext**
- 所有状态已在 Zustand，Context 无存在必要
- 消费者组件从 `useProjectState()` 切换到 `useAppStore(selector)`

**R1.5 文件操作保留为 Context（需要 Tauri invoke）**

```typescript
interface FileActionsContextValue {
  onFileSave: (content: string) => Promise<boolean>;
  onLoadFileTree: (projectId: string) => void;
}
```

文件选择、关闭、激活等纯状态操作 → Zustand actions。

**R1.6 同步简化 useAppContainer**
- 移除 `useSyncToStore` 中 project/file 相关字段的同步
- 移除 `buildContextValues` 中 projectState/projectActions 的构建
- 从 useAppContainer 中抽出 project 域的编排逻辑

### Phase 2：Connection 域统一（WSL + Remote → 统一 Connection）

**目标**：消除 WslContext / RemoteContext 的并行重复（各 16 属性），建立统一 Connection 抽象

**R2.1 设计 Connection 类型系统**

```typescript
type ConnectionType = 'wsl' | 'ssh';

interface BaseConnectionEntry {
  id: string;
  projects: ConnectionProject[];
}

interface WslConnectionEntry extends BaseConnectionEntry {
  type: 'wsl';
  distro: string;
}

interface SshConnectionEntry extends BaseConnectionEntry {
  type: 'ssh';
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
}

type ConnectionEntry = WslConnectionEntry | SshConnectionEntry;
```

**R2.2 创建 Zustand connection slice**
- 统一存储：`entries: ConnectionEntry[]`、`activeKey`、`openSessions`、`activeProject`、`activeWorktreePath`、`diffState`
- 用 discriminated union 区分类型，消除 `wslEntries` / `remoteEntries` 的并行字段
- 移除 `useSyncToStore` 中连接相关字段的同步

**R2.3 统一为 ConnectionActionsContext**
- 合并 WSL/SSH 的 Tauri invoke 副作用：

```typescript
interface ConnectionActionsContextValue {
  onSelectFile: (entryId: string, projectPath: string, filePath: string) => void;
  onRefreshGit: (entryId: string, projectId: string, projectPath: string) => void;
  onOpenIde: (entryId: string, projectPath: string, ide: string) => void;
  onOpenWorktreeTerminal: (entryId: string, worktreePath: string, branch: string) => void;
}
```

- 内部按 `entry.type` 分发到对应的 Tauri 命令（`wsl_*` / `remote_*`）

**R2.4 消除 useAppContainer 中的跨域清理重复**
- 当前 `clearWslTransientState` 和 `clearRemoteTransientState` 是镜像逻辑
- 统一为 `clearConnectionTransientState(type)`

**R2.5 更新消费者组件**
- WSLItem / RemoteItem 从统一 Connection 接口消费
- 提供类型守卫 helper：`isWslEntry(entry)` / `isSshEntry(entry)`

### Phase 3：Skill 域分离

**目标**：解决 SkillContext（18 属性）的数据/UI 混杂

**R3.1 创建 Zustand skill slice**
- 迁移数据状态：`skills`、`tagGroups`、`tools`、`loading`、`searchQuery`、`activeSkillView`、`activeTagGroupId`
- 将 Tauri invoke 的 CRUD 操作作为 Zustand async actions（直接在 action 内调用 invoke）

**R3.2 对话框状态下沉到组件本地**
- `editSkillDialogOpen/Data`、`viewSkillDialogOpen/Data`、`selectedSkillId` 移入使用它们的组件
- 用 `useState` 管理

**R3.3 移除 SkillContext**
- 数据读取 → Zustand selector
- CRUD 操作 → Zustand actions（内部调 Tauri invoke）
- 无需保留 Context

**R3.4 最终清理**
- 移除 `useSyncToStore`（所有字段已迁移）
- 移除 `buildContextValues`（不再需要）
- 评估 `useAppContainer` 剩余职责，拆分或移除

## Acceptance Criteria

### Phase 1
- [ ] ProjectStateContext 移除，消费者改用 Zustand selector
- [ ] ProjectActionsContext 属性数从 17 降至 ≤4（仅 Tauri invoke 副作用）
- [ ] 文件操作拆分为 FileActionsContext（≤2 个 Tauri invoke 属性）+ Zustand file slice（纯状态）
- [ ] `useSyncToStore` 中 project/file 相关同步移除
- [ ] `useAppContainer` 减少 30% 以上行数
- [ ] `npx tsc --noEmit` 通过
- [ ] `pnpm test:run` 通过
- [ ] 无功能回归

### Phase 2
- [ ] WslContext 和 RemoteContext 合并为 ConnectionActionsContext（≤4 个属性）
- [ ] 连接状态统一到 Zustand connection slice
- [ ] Provider 嵌套层数减少 2 层（移除 WslProvider + RemoteProvider，新增 1 个 ConnectionActionsProvider）
- [ ] `clearWslTransientState` / `clearRemoteTransientState` 合并
- [ ] 重复代码减少 50% 以上
- [ ] 类型检查 + 测试通过
- [ ] 无功能回归

### Phase 3
- [ ] SkillContext 移除，改用 Zustand skill slice
- [ ] 对话框 UI 状态移入组件本地
- [ ] `useSyncToStore` 完全移除
- [ ] `buildContextValues` 完全移除
- [ ] 类型检查 + 测试通过
- [ ] 无功能回归

### 全局
- [ ] `src/context/` 目录消除，统一到 `src/contexts/`
- [ ] Provider 嵌套层数从 7 层降至 4 层（App → Sidebar → ProjectActions → ConnectionActions → FileActions）
- [ ] `useAppContainer` 行数从 617 降至 200 以内，或拆分为多个领域 hook

## Definition of Done

- 类型检查通过（`npx tsc --noEmit`）
- 现有测试通过（`pnpm test:run`）
- 无功能回归（UI 行为不变）
- Context 目录统一到 `src/contexts/`
- 每个 Phase 独立提交，可独立回滚

## Out of Scope

- 不新增功能
- 不改变 Tauri IPC 层（命令签名不变）
- 不改变后端 Rust 代码
- 不改变组件的外部行为/UI
- 不处理 TODO.md 中的其他问题（barrel export、类型组织、命名规范等）
- AppContext（5 属性）和 SidebarContext（4 属性）暂不改动
- EditorContext（10 属性）暂不改动（视 Phase 1-3 效果决定是否追加）

## Technical Notes

### 迁移后的目标架构

```
Zustand Store (唯一数据源)
├── projectSlice    — 项目/worktree 状态 + 纯状态 actions
├── fileSlice       — 文件树/标签页 状态 + 纯状态 actions
├── connectionSlice — WSL/SSH 连接状态 + 纯状态 actions
└── skillSlice      — Skill 数据 + invoke CRUD actions

Context (仅 Tauri invoke 副作用注入)
├── AppContext          — config/agents/toast（不动）
├── SidebarContext      — panel 状态（不动）
├── ProjectActionsCtx   — refreshGit/openIde/saveSettings/dragEnd
├── FileActionsCtx      — fileSave/loadFileTree
└── ConnectionActionsCtx — selectFile/refreshGit/openIde/openWorktreeTerminal (按 entry.type 分发)

组件消费
├── 状态读取 → useAppStore(selector)
└── 副作用调用 → useXxxActions() (from Context)
```

### Zustand Store 文件结构

```
src/store/
├── index.ts              # 组合 store（create + slices）
├── projectSlice.ts       # Phase 1
├── fileSlice.ts          # Phase 1
├── connectionSlice.ts    # Phase 2
└── skillSlice.ts         # Phase 3
```

### Selector 使用规范

```typescript
// 单字段 selector — 自动引用比较
const activeProject = useAppStore((s) => s.activeProject);

// 多字段 selector — 必须用 shallow
import { useShallow } from 'zustand/react/shallow';
const { projects, activeProjectId } = useAppStore(
  useShallow((s) => ({ projects: s.projects, activeProjectId: s.activeProjectId }))
);
```

### 每个 Phase 的迁移步骤

1. 重构/新建 Zustand slice（将 hooks 内的 useState 改为直接操作 store）
2. 更新消费者组件：`useContext(XxxContext)` → `useAppStore(selector)`
3. 瘦身/移除对应 Context
4. 从 `useSyncToStore` 中移除已迁移字段
5. 从 `useAppContainer` 中抽出已迁移域的编排逻辑
6. 清理 AppProviders 中的 Provider 层
7. 验证：类型检查 + 测试 + 手动回归

### 风险点

- **渐进一致性**：迁移过程中部分域用 Zustand、部分域仍用 Context，需要确保 `useSyncToStore` 的残余字段不与已迁移字段冲突
- **Zustand selector 稳定性**：多字段 selector 必须用 `useShallow`，否则导致无限 re-render
- **Connection 泛型复杂度**：discriminated union 的类型守卫会增加消费者组件代码量，需提供 `isWslEntry` / `isSshEntry` helper
- **Skill CRUD 迁移**：将 Tauri invoke 调用从 Context 移到 Zustand action 中，需要处理错误提示（showToast 的注入方式）

### 关键文件

| 文件 | 角色 | 迁移中的变化 |
|------|------|-------------|
| `src/store/appStore.ts` | 现有 store | 拆分为 slices，成为唯一数据源 |
| `src/hooks/useAppContainer.ts` | 617 行 mega-hook | 每个 Phase 逐步缩减，最终消除或拆分 |
| `src/hooks/useSyncToStore.ts` | 双源同步层 | 每个 Phase 逐步移除字段，Phase 3 后完全删除 |
| `src/hooks/buildContextValues.ts` | 纯直传函数 | Phase 3 后完全删除 |
| `src/AppProviders.tsx` | 7 层 Provider 嵌套 | 每个 Phase 减少层数，最终 4 层 |
| `src/context/` | 旧 Context 目录 | 统一到 `src/contexts/` |
| `src/contexts/` | 新 Context 目录 | 保留精简后的 Action Context |
