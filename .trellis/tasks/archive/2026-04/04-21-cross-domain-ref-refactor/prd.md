# 消除跨域 Ref 反模式

## Goal

消除 `useAppRefSync` + 15+ MutableRef 的"手工状态同步"模式，引入 Zustand 作为跨域状态快照层，降低认知负担和维护成本。

## What I already know

### 问题现状

1. **`useAppRefSync.ts`**：一个 useEffect 把 15 个 state 同步到 15 个 ref，作用是让事件回调能读到最新值
2. **`useKeyboardShortcuts.ts`**：useEffect 依赖 `[projects, activeProjectId]`，内部通过 `.current` 读取 ref 来避免 stale closure
3. **`useAppContainer.ts`** (667 行)：ref 的创建、传递、同步全部在这里编排，导致参数列表极长
4. **`selectProjectRef` / `selectWslProjectRef` / `selectRemoteProjectRef`**：函数 ref，在渲染阶段直接赋值 `.current =`，用于键盘快捷键调用

### 受影响的 Ref 分类

| 类别 | Ref 列表 | 用途 |
|------|----------|------|
| 项目选择函数 | `selectProjectRef`, `selectWslProjectRef`, `selectRemoteProjectRef` | keydown handler 中调用 |
| 当前活跃状态 | `activeWslKeyRef`, `activeRemoteKeyRef`, `activeProjectRef`, `isTerminalViewRef` | keydown handler 中读取判断 |
| 连接列表 | `wslEntriesRef`, `remoteEntriesRef` | keydown handler 中遍历 |
| Worktree 状态 | `activeWorktreePathRef`, `openedWorktreesRef`, `wslOpenedWtRef`, `remoteOpenedWtRef`, `activeWslWorktreePathRef`, `activeRemoteWorktreePathRef` | keydown handler 中读取 |
| 持久化用 | `wslEntriesRefForSave`, `remoteEntriesRefForSave`, `worktreeStateRef` | saveSession 回调中读取最新值 |

### 根因分析

Ref 反模式的根本原因是 **useEffect 事件监听器的 stale closure 问题**：

- `useKeyboardShortcuts` 注册了全局 keydown 监听器
- 如果把所有状态放入依赖数组，每次状态变化都会卸载/重新注册监听器
- 所以用 ref 绕过闭包，让 handler 始终读到最新值

## Decision (ADR-lite)

**Context**: 15+ 个 ref 通过 useAppRefSync 手工同步，是绕过 stale closure 的 workaround，但认知负担极高，参数列表爆炸。

**Decision**: 采用方案 B — 引入 Zustand 作为集中式 store。

**Consequences**:
- 新增 `zustand` 依赖（~2KB gzipped，零依赖）
- `store.getState()` 天然返回最新值，彻底消除 stale closure 问题
- 为后续 Context 拆分（TODO #5）铺路 — store 可逐步替代膨胀的 Context
- 需要将 ref 对应的状态同步到 store，改动面较广但每步可验证

## Technical Approach

### 设计原则

1. **最小 Store 范围**：只将"被 ref 同步的状态"放入 store，不迁移所有 state。Store 是跨域快照层，不是全局状态管理器。
2. **单向同步**：state 所有权仍在原 hook（useState），通过一个集中的 `useSyncToStore` effect 单向写入 store（替代 `useAppRefSync` 写 ref）。不做 setter wrapper 双写，避免同步不一致。
3. **函数 action 用 `set` 更新**：`selectProject` 等函数 action 在 `useAppContainer` 中通过 `useAppStore.setState({ selectProject: fn })` 注册，store 内不定义业务逻辑，只存最新引用。

### Store 设计

创建 `src/store/appStore.ts`：

```typescript
import { create } from 'zustand';

interface AppSnapshot {
  // --- 只读快照（由 useSyncToStore 单向写入）---

  // 项目
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  isTerminalView: boolean;

  // WSL
  wslEntries: WSLEntrySession[];
  activeWslKey: ActiveWslKey;

  // Remote
  remoteEntries: RemoteEntrySession[];
  activeRemoteKey: ActiveRemoteKey;

  // Worktree（本地 + WSL + Remote）
  activeWorktreePath: string | null;
  openedWorktrees: WorktreeItem[];
  wslOpenedWt: WorktreeItem[];
  activeWslWorktreePath: string | null;
  remoteOpenedWt: WorktreeItem[];
  activeRemoteWorktreePath: string | null;

  // 持久化用
  worktreeState: Record<string, string>;

  // --- 函数引用（由 useAppContainer 注册）---
  selectProject: (id: string) => void;
  selectWslProject: (distro: string, project: WSLProject) => void;
  selectRemoteProject: (host: string, project: RemoteProject) => void;
}

export const useAppStore = create<AppSnapshot>(() => ({
  // 所有字段初始值...
  projects: [],
  activeProjectId: null,
  activeProject: null,
  isTerminalView: false,
  wslEntries: [],
  activeWslKey: null,
  remoteEntries: [],
  activeRemoteKey: null,
  activeWorktreePath: null,
  openedWorktrees: [],
  wslOpenedWt: [],
  activeWslWorktreePath: null,
  remoteOpenedWt: [],
  activeRemoteWorktreePath: null,
  worktreeState: {},
  selectProject: () => {},
  selectWslProject: () => {},
  selectRemoteProject: () => {},
}));
```

**关键设计点**：
- `create(() => ...)` 不传 `set`/`get`：store 本身无业务逻辑，只是一个类型安全的可订阅快照
- 函数 action 初始为空函数，在 `useAppContainer` 渲染后通过 `useAppStore.setState()` 注册最新引用
- 这比在 store 内定义 action 更安全，因为 `selectProject` 的实现依赖 React hook 状态（如 `clearWorktreeForProject`），无法在 store create 中定义

### 同步层：useSyncToStore

替代 `useAppRefSync`，同样是一个集中 useEffect，但写入 store 而非 15 个独立 ref：

```typescript
// src/hooks/useSyncToStore.ts
export function useSyncToStore(params: SyncParams): void {
  useEffect(() => {
    useAppStore.setState({
      wslEntries: params.wslEntries,
      activeWslKey: params.activeWslKey,
      remoteEntries: params.remoteEntries,
      // ... 所有快照字段
    });
  }, [params.wslEntries, params.activeWslKey, ...]);
}
```

**这一步改动最小**：只是把 `ref.current = value` 替换为 `useAppStore.setState({ ... })`，参数列表减半（不再传 ref 本身）。

### 消费模式

```typescript
// useKeyboardShortcuts — 通过 getState() 在 handler 中读取最新值
export function useKeyboardShortcuts(params: {
  updateWtPath: (path: string | null, branch: string) => void;
  setWslWorktreePath: (path: string | null) => void;
  setWslWtBranch: (branch: string) => void;
  setRemoteWorktreePath: (path: string | null) => void;
  setRemoteWtBranch: (branch: string) => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const snap = useAppStore.getState();
      // 使用 snap.activeWslKey, snap.wslEntries 等
      // 调用 snap.selectProject(id)
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []); // 零依赖！handler 始终读到最新值
}

// saveSession — 通过 getState() 读取最新值
const saveSession = useCallback(async () => {
  const { wslEntries, remoteEntries } = useAppStore.getState();
  await invoke("save_session", { wslEntries, remoteEntries });
}, []);
```

### 迁移步骤（单 PR，分步验证）

**Step 1: 安装 + Store 定义**
1. `pnpm add zustand`
2. 创建 `src/store/appStore.ts`

**Step 2: 替换同步层**
1. 创建 `useSyncToStore.ts`，将 `useAppRefSync` 的逻辑改为写 store
2. 在 `useAppContainer` 中用 `useSyncToStore` 替换 `useAppRefSync`
3. 在 `useAppContainer` 中注册函数 action：`useAppStore.setState({ selectProject: handleSelectProjectWithClear, ... })`

**Step 3: 重写 useKeyboardShortcuts**
1. 参数列表从 18 个缩减到 5 个（只保留 setter 函数）
2. handler 内通过 `useAppStore.getState()` 读取所有状态和函数
3. 依赖数组改为 `[]`
4. 更新测试

**Step 4: 重写 useSessionPersistence**
1. `saveSession` 从 `store.getState()` 读取 wslEntries / remoteEntries
2. `saveWorktreeState` 从 `store.getState().worktreeState` 读取
3. 删除 `wslEntriesRefForSave`、`remoteEntriesRefForSave`、`worktreeStateRef`

**Step 5: 清理子 hook 导出的 ref**
1. `useLocalProjects`：删除 `activeProjectIdRef`, `selectProjectRef`, `activeProjectRef`, `isTerminalViewRef` 导出
2. `useWslProjects`：删除 `wslEntriesRef`, `activeWslKeyRef`, `selectWslProjectRef` 导出
3. `useRemoteProjects`：删除 `remoteEntriesRef`, `activeRemoteKeyRef`, `selectRemoteProjectRef` 导出
4. `useWorktreeState`：删除 `activeWorktreePathRef`, `openedWorktreesRef` 导出
5. `useWslActions` / `useRemoteActions`：删除 worktree ref 导出
6. 简化 `useAppContainer` — 不再解构和传递 ref

**Step 6: 删除 useAppRefSync.ts**

每步完成后运行 `npx tsc --noEmit` + `pnpm test` 验证。

## Requirements

- 引入 Zustand，创建 `src/store/appStore.ts` 作为只读快照 store
- 创建 `useSyncToStore.ts` 替代 `useAppRefSync.ts`（单向同步 state → store）
- `useKeyboardShortcuts` 通过 `store.getState()` 读取状态，参数从 18 个缩减到 5 个
- `useSessionPersistence` 的 saveSession 通过 `store.getState()` 读取最新值
- 函数 action（selectProject 等）通过 `useAppStore.setState()` 在 `useAppContainer` 中注册
- 消除渲染阶段的 `ref.current = value` 直接赋值
- 各子 hook 不再导出 MutableRef
- 删除 `useAppRefSync.ts`
- 不改变任何用户可见行为

## Acceptance Criteria

- [ ] `useAppRefSync.ts` 被删除
- [ ] `useKeyboardShortcuts` 参数不超过 5 个
- [ ] `useAppContainer` 中无 `xxxRef.current = value` 渲染阶段赋值
- [ ] 子 hook（useLocalProjects, useWslProjects, useRemoteProjects, useWorktreeState）不再导出 MutableRef
- [ ] 所有键盘快捷键功能不变（Ctrl+1~9, Ctrl+Q, Ctrl+N, Ctrl+O, Ctrl+R）
- [ ] 会话持久化功能不变
- [ ] `npx tsc --noEmit` 通过
- [ ] `pnpm test` 通过

## Definition of Done

- Zustand store 创建并集成
- 所有跨域 ref 迁移到 store 快照
- useAppRefSync.ts 删除
- 测试通过 + 类型检查通过

## Out of Scope

- 将 useState 所有权迁移到 Zustand（state 仍由原 hook 管理，store 只是快照层）
- 组件通过 `useAppStore(selector)` 订阅状态（本任务只用 `getState()`，不改变组件渲染逻辑）
- Context 拆分（TODO #5，后续任务可基于 store 进一步简化）
- Prop 穿透优化（TODO #3）
- Hook 复杂度降低（TODO #4）
- useAppCallbacks 拆分

## Technical Notes

- 核心文件：`useAppRefSync.ts`, `useKeyboardShortcuts.ts`, `useAppContainer.ts`
- 相关文件：`useLocalProjects.ts`, `useWslProjects.ts`, `useRemoteProjects.ts`, `useWorktreeState.ts`, `useWslActions.ts`, `useRemoteActions.ts`, `useSessionPersistence.ts`
- 键盘快捷键测试：`src/hooks/__tests__/useKeyboardShortcuts.test.ts`
- Zustand 体积：~2KB gzipped，零依赖，与 React 18 完全兼容
- `store.getState()` 是同步调用，在事件 handler 中安全使用，不触发 re-render
- Store 定位：只读快照层 + 函数引用注册点，不是全局状态管理器
- 后续演进路径：本任务完成后，Context 拆分任务可将 store 从"快照层"升级为"状态所有者"，届时删除 useSyncToStore 和原 hook 中的 useState
