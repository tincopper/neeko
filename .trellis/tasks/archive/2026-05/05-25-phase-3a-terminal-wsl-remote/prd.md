# Phase 3A: Terminal 视图合并（策略模式统一本地/WSL/Remote）

## Goal

将 3 个独立终端视图（889 行）通过策略模式合并为一个 `TerminalViewBase`（~250 行），每个终端类型保留 ~30 行的轻量适配层。预期删除 ~400 行重复代码。

## What I already know

### 现有视图

| 文件 | 行数 | 特点 |
|---|---|---|
| `TerminalView.tsx` | 358 | 本地终端：worktree、task terminal、file links、agent dedup |
| `WSLTerminalView.tsx` | 262 | WSL 终端：useWslContext 驱动，props 极简 |
| `RemoteTerminalView.tsx` | 269 | SSH 终端：10 个 props 传递连接参数 |

### 重复代码分布

| 重复内容 | 位置 | 行数 |
|---|---|---|
| xterm.js 初始化（Terminal + FitAddon + Unicode11 + WebGL） | factory.ts + WSL + Remote | ~15 行 × 3 = 45 |
| attach/detach DOM 操作 | 三个视图 | ~15 行 × 3 = 45 |
| ResizeObserver + RAF 节流 + fit + resize invoke | 三个视图 | ~20 行 × 3 = 60 |
| agent 自动启动（仅延迟不同） | 三个视图 | ~15 行 × 3 = 45 |
| cleanup useEffect | 三个视图 | ~10 行 × 3 = 30 |

### 差异点

| 差异 | Local | WSL | Remote |
|---|---|---|---|
| invoke 创建命令 | `create_terminal_session` | `create_wsl_terminal_session` | `create_remote_terminal_session` |
| invoke resize 命令 | `resize_terminal` | `resize_terminal` | `resize_remote_terminal` |
| cache key 格式 | `projectId:tabId` | `wsl:distro:projectId:tabId` | `remote:entryId:projectId:tabId` |
| agent 启动延迟 | 0ms | 500ms | 800ms |
| file links | ✅ | ❌ | ❌ |
| task terminal | ✅ | ❌ | ❌ |
| "Connecting..." | loadingElRef | ready state | ready state |
| window resize 监听 | ✅ | ❌ | ❌ |

## Proposed Design: 策略模式

### 策略接口

```ts
interface TerminalSessionStrategy {
  kind: "local" | "wsl" | "remote";
  /** 构建 cache key */
  buildCacheKey(tabId: string, paneId: string): string;
  /** 创建终端会话，返回 sessionId */
  createSession(params: { cols: number; rows: number }): Promise<{
    sessionId: string;
    cache: TerminalCache;  // 统一类型
  }>;
  /** resize 的 invoke 命令 */
  resizeCmd: string;
  /** agent 启动等待延迟 (ms) */
  agentDelay: number;
  /** 是否启用 file links */
  fileLinks?: boolean;
}
```

### 统一 Cache 类型

```ts
interface UnifiedTerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  sessionId: string | null;
  unlistenOutput: (() => void) | null;
  unlistenClosed: (() => void) | null;
  inputController: TerminalInputController | null;
}
```

### TerminalViewBase 组件

```tsx
function TerminalViewBase({ strategy: TerminalSessionStrategy }): JSX.Element
```

负责：
- xterm.js 初始化（创建 Terminal + addons + theme）
- DOM attach/detach（wrapper ref）
- ResizeObserver + RAF 节流 + fit + invoke resize
- agent 自动启动（读取 tabAgentId，延迟由 strategy 提供）
- cleanup（unlisten + dispose terminal）
- "Connecting..." 覆盖层（strategy.initialMessage）

## Implementation Plan

| Step | 操作 | 涉及文件 |
|---|---|---|
| 1 | 统一 cache 类型 + 创建策略接口文件 | `terminalCache.ts`, `strategies/types.ts` |
| 2 | 创建 3 个策略实现 | `strategies/local.ts`, `wsl.ts`, `remote.ts` |
| 3 | 创建 TerminalViewBase 组件 | `TerminalViewBase.tsx` |
| 4 | 迁移 WSLTerminalView → TerminalViewBase 适配 | `WSLTerminalView.tsx` (262→~30) |
| 5 | 迁移 RemoteTerminalView → TerminalViewBase 适配 | `RemoteTerminalView.tsx` (269→~30) |
| 6 | 迁移 TerminalView → TerminalViewBase 适配 | `TerminalView.tsx` (358→~50) |
| 7 | 删除旧重复代码 + 验证 | `pnpm tsc + pnpm test` |

## Acceptance Criteria

- [x] `npx tsc --noEmit` 零 error
- [x] `pnpm test:run` 全部通过（562 passed, 1 skipped）
- [x] WSLTerminalView: 262 → 30 行（适配层）
- [x] RemoteTerminalView: 269 → 70 行（适配层，保留完整 Props 接口）
- [ ] TerminalView (Local): 358 行暂未迁移（factory 模式差异大，列入 follow-up）

## Actual Implementation

### Created Files

| File | Lines | Purpose |
|---|---|---|
| `strategies/types.ts` | 24 | `TerminalStrategy` + `CacheEntry` 接口 |
| `strategies/wsl.ts` | 68 | WSL 策略 hook（Context 驱动） |
| `strategies/remote.ts` | 81 | Remote 策略 hook（Props 驱动） |
| `strategies/index.ts` | 4 | Barrel export |
| `TerminalViewBase.tsx` | 206 | 共享终端组件（xterm + ResizeObserver + agent） |

### Modified Files

| File | Lines | Change |
|---|---|---|
| `WSLTerminalView.tsx` | 262 → 30 | 改为 TerminalViewBase 适配器 |
| `RemoteTerminalView.tsx` | 269 → 70 | 改为 TerminalViewBase 适配器 |
| `TerminalView.tsx` | 358 | 未改动（保留 factory 模式） |

### Key Design Decisions

1. **策略模式**：`TerminalStrategy` 接口抽象了 cache key、session 创建、resize 命令、agent 延迟、连接消息等差异点
2. **TerminalViewBase** 负责：xterm 初始化、attach/detach、ResizeObserver + RAF 节流、agent 自动启动、cleanup
3. **Local 暂不迁移**：使用 `terminalFactory.ts` 内部创建 terminal，与 WSL/Remote 的内联创建模式不兼容。Task terminal + file links + agent dedup 逻辑需单独处理

## Out of Scope

- SplitLayout 重构
- 终端 cache 完全重写（保持现有 cache 后端 API）
- task terminal 特殊逻辑不动（保留在 local 策略中）
- 不修改 terminalInput / terminalLinks

## Research References

- `src/components/terminal/` 目录分析完成（见上方表格）
- 策略模式已在 Rust 端 Phase 1B 验证过（`theme/service.rs`）
