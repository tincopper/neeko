# Instant Agent Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 切换 Agent 时立即创建新 PTY 并显示，后台异步关闭旧 PTY，消除当前"等旧 Agent 进程退出"的等待。

**Architecture:** 新增 `switchAgentInTerminal` / `switchAgentInWslTerminal` / `switchAgentInRemoteTerminal` 三个函数，统一替换原来的 `launchAgent*` 调用。切换时先摘除旧缓存条目的事件监听、从 Map 中删除旧条目，立即调用 `createTerminalForProject`（或对应 WSL/SSH 变体）在同一 cache key 下创建新 PTY 并自动启动新 Agent，再后台异步销毁旧 PTY。新增全局 `terminalWrapperRefs` Map 让命令式调用路径能拿到 DOM wrapper 节点。

**Tech Stack:** TypeScript, React, xterm.js, Tauri `invoke`, `@tauri-apps/api/event`

---

## 文件改动一览

| 文件 | 动作 | 内容 |
|------|------|------|
| `src/components/terminal/TerminalView.tsx` | 修改 | 新增 `terminalWrapperRefs` Map；新增 `switchAgentInTerminal`；在 `useEffect` 中注册/注销 wrapper ref |
| `src/components/terminal/WSLTerminalView.tsx` | 修改 | 新增 `switchAgentInWslTerminal` |
| `src/components/terminal/RemoteTerminalView.tsx` | 修改 | 新增 `switchAgentInRemoteTerminal` |
| `src/components/terminal/index.ts` | 修改 | 导出三个新函数 |
| `src/hooks/useAppCallbacks.ts` | 修改 | `handleSelectLocalAgent` 中调用 `switchAgentInTerminal` |
| `src/hooks/useWslActions.ts` | 修改 | `handleSelectWslAgent` 中调用 `switchAgentInWslTerminal` |
| `src/hooks/useRemoteActions.ts` | 修改 | `handleSelectRemoteAgent` 中调用 `switchAgentInRemoteTerminal` |

后端**零改动**。

---

## Task 1: 在 TerminalView.tsx 中新增 `terminalWrapperRefs` 与 `switchAgentInTerminal`

**Files:**
- Modify: `src/components/terminal/TerminalView.tsx`

### 背景

`switchAgentInTerminal` 需要向 `createTerminalForProject` 传入 DOM `wrapper` 节点。当前 `wrapper` 只在组件内部 `useEffect` 可见。通过新增一个全局 `terminalWrapperRefs: Map<string, HTMLDivElement>` 暴露出来，和现有的 `terminalCache`、`terminalRebuildCallbacks` 模式一致。

- [ ] **Step 1: 在全局 Map 声明区域新增 `terminalWrapperRefs`**

在 `TerminalView.tsx` 第 34 行（`terminalRebuildCallbacks` 声明之后）添加：

```typescript
// 存储每个 cacheKey 对应的 DOM wrapper，供命令式切换 Agent 时使用
export const terminalWrapperRefs = new Map<string, HTMLDivElement>()
```

- [ ] **Step 2: 在 `useEffect` 中注册/注销 wrapper ref**

在 `TerminalView` 组件的 `useEffect`（约第 350 行）中，紧跟 `terminalRebuildCallbacks.set(...)` 之后注册，在 cleanup（`return () => { ... }`）中删除：

```typescript
// 注册 wrapper ref，供命令式 switchAgentInTerminal 使用
terminalWrapperRefs.set(projectId, wrapper)

// ... 现有逻辑 ...

return () => {
  if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
  ro.disconnect()
  window.removeEventListener('resize', handleResize)
  detachAll()
  terminalRebuildCallbacks.delete(projectId)
  terminalWrapperRefs.delete(projectId)   // ← 新增
}
```

- [ ] **Step 3: 新增 `switchAgentInTerminal` 函数**

在 `launchAgentInTerminal`（第 82 行）之后插入：

```typescript
/**
 * 即时切换 Agent：立即创建新 PTY + 启动新 Agent，后台异步关闭旧 PTY。
 * 替代 launchAgentInTerminal，消除"等旧 Agent 退出"的等待。
 */
export async function switchAgentInTerminal(
  projectId: string,
  projectPath: string,
  projectName: string,
  agentId: string,
  fontSize: number,
  shell: string,
  fontFamily: string,
  agentCommandOverrides?: Record<string, string>,
) {
  const wrapper = terminalWrapperRefs.get(projectId)
  if (!wrapper) {
    // wrapper 未就绪（组件未挂载），回退到旧路径
    const agent = await invoke<AgentConfig>('get_agent', { agentId }).catch(() => null)
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command
      launchAgentInTerminal(projectId, cmd, agent.args)
    }
    return
  }

  // 1. 摘除旧缓存的事件监听，防止 terminal-closed 触发意外重建
  const oldCache = terminalCache.get(projectId)
  if (oldCache) {
    oldCache.unlistenOutput?.()
    oldCache.unlistenClosed?.()
  }

  // 2. 从 Map 删除旧条目（槽位空出），新建时会重新填入同一 key
  terminalCache.delete(projectId)

  // 3. 清空 wrapper 中旧的 xterm DOM 节点
  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild)
  }

  // 4. 创建新终端（复用 createTerminalForProject，直接携带 agentId）
  try {
    const newCache = await createTerminalForProject(
      projectId,
      projectPath,
      projectName,
      agentId,
      fontSize,
      wrapper,
      shell,
      fontFamily,
      undefined,
      agentCommandOverrides,
    )
    requestAnimationFrame(() => {
      newCache.fitAddon.fit()
      if (newCache.sessionId) {
        invoke('resize_terminal', {
          sessionId: newCache.sessionId,
          cols: newCache.term.cols,
          rows: newCache.term.rows,
        }).catch(() => {})
      }
      newCache.term.focus()
    })
  } catch (err) {
    log(`switchAgentInTerminal: createTerminalForProject failed: ${err}`)
  }

  // 5. 后台异步关闭旧 PTY（不阻塞 UI）
  if (oldCache?.sessionId) {
    invoke('close_terminal_session', { sessionId: oldCache.sessionId }).catch(() => {})
  }
  oldCache?.term.dispose()
}
```

- [ ] **Step 4: 运行类型检查，确认无错误**

```bash
npx tsc --noEmit
```

期望输出：无错误（或仅有与本次改动无关的已有错误）。

- [ ] **Step 5: Commit**

```bash
git add src/components/terminal/TerminalView.tsx
git commit -m "feat: add terminalWrapperRefs and switchAgentInTerminal for instant agent switch"
```

---

## Task 2: 在 WSLTerminalView.tsx 中新增 `switchAgentInWslTerminal`

**Files:**
- Modify: `src/components/terminal/WSLTerminalView.tsx`

### 背景

WSL 终端的 cache 是模块私有的 `wslTerminalCache`，切换逻辑和本地类似，但没有 `createTerminalForProject`，而是内部通过 `rebuildCount` + `useEffect` 重建。WSL 终端的 wrapper 也是组件内部的，需要新增一个 `wslWrapperRefs` Map 对外暴露。

查看 WSLTerminalView 组件 useEffect 的创建流程（约 120 行之后），了解 WSL PTY 创建参数，然后实现。

- [ ] **Step 1: 新增 `wslWrapperRefs` Map 并在 `useEffect` 中注册/注销**

在 `wslRebuildCallbacks` 声明（第 55 行）之后添加：

```typescript
/** DOM wrapper 节点注册表，供 switchAgentInWslTerminal 使用 */
export const wslWrapperRefs = new Map<string, HTMLDivElement>()
```

在 WSLTerminalView 组件的主 `useEffect` 中（找到 `wrapperRef.current` 取值处），紧跟 `wslRebuildCallbacks.set(...)` 之后注册：

```typescript
if (wrapperRef.current) {
  wslWrapperRefs.set(cacheKey, wrapperRef.current)
}
```

在 cleanup 中删除：

```typescript
wslWrapperRefs.delete(cacheKey)
```

- [ ] **Step 2: 阅读 WSL PTY 创建参数**

阅读 `WSLTerminalView.tsx` 的主 `useEffect`（offset=120 之后），找到 `invoke('create_terminal_session', ...)` 或等价的创建调用，记录所需参数结构。

- [ ] **Step 3: 新增 `switchAgentInWslTerminal` 函数**

在 `launchAgentInWslTerminal`（第 75 行）之后插入（根据 Step 2 的参数结构填写）：

```typescript
/**
 * 即时切换 WSL Agent：立即创建新 PTY + 启动新 Agent，后台异步关闭旧 PTY。
 */
export async function switchAgentInWslTerminal(
  cacheKey: string,
  distro: string,
  projectPath: string,
  projectName: string,
  agentId: string,
  fontSize: number,
  fontFamily: string,
  agentCommandOverrides?: Record<string, string>,
) {
  const wrapper = wslWrapperRefs.get(cacheKey)
  if (!wrapper) {
    // 回退：wrapper 未就绪，用旧路径
    const agent = await invoke<{ id: string; command: string; args: string[] }>(
      'get_agent', { agentId }
    ).catch(() => null)
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command
      launchAgentInWslTerminal(cacheKey, cmd, agent.args)
    }
    return
  }

  // 1. 摘除旧缓存事件监听
  const oldCache = wslTerminalCache.get(cacheKey)
  if (oldCache) {
    oldCache.unlisten?.()
  }

  // 2. 删除旧条目
  wslTerminalCache.delete(cacheKey)

  // 3. 清空 wrapper DOM
  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild)
  }

  // 4. 触发重建（带新 agentId）——通过 wslRebuildCallbacks 触发 setRebuildCount
  //    重建 callback 内的 useEffect 会读取最新 prop（selectedAgentId 已通过状态更新传入）
  wslRebuildCallbacks.get(cacheKey)?.()

  // 5. 后台异步关闭旧 PTY
  if (oldCache?.sessionId) {
    invoke('close_terminal_session', { sessionId: oldCache.sessionId }).catch(() => {})
  }
  oldCache?.term.dispose()
}
```

> **注意：** WSL 终端没有独立的 `createWslTerminalForProject` 函数，PTY 创建逻辑在组件 `useEffect` 内部，因此切换时通过触发 `rebuildCallbacks` 重建，新建时组件会读取最新的 `selectedAgentId` prop（状态已在 `handleSelectWslAgent` 中提前更新）。这和本地终端的 `createTerminalForProject` 直接传参稍有不同，但效果等价。

- [ ] **Step 4: 运行类型检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/terminal/WSLTerminalView.tsx
git commit -m "feat: add wslWrapperRefs and switchAgentInWslTerminal"
```

---

## Task 3: 在 RemoteTerminalView.tsx 中新增 `switchAgentInRemoteTerminal`

**Files:**
- Modify: `src/components/terminal/RemoteTerminalView.tsx`

### 背景

SSH 远程终端的 cache 是模块私有 `remoteTerminalCache`，PTY 创建逻辑同样在组件 `useEffect` 内部，切换策略与 WSL 相同：先清旧缓存，再触发 `remoteRebuildCallbacks` 重建。

- [ ] **Step 1: 新增 `remoteWrapperRefs` Map 并在 `useEffect` 中注册/注销**

在 `remoteRebuildCallbacks` 声明（第 67 行）之后添加：

```typescript
/** DOM wrapper 节点注册表，供 switchAgentInRemoteTerminal 使用 */
export const remoteWrapperRefs = new Map<string, HTMLDivElement>()
```

在 RemoteTerminalView 组件的主 `useEffect` 中（找到 `wrapperRef.current` 取值处），紧跟 `remoteRebuildCallbacks.set(...)` 之后注册：

```typescript
if (wrapperRef.current) {
  remoteWrapperRefs.set(cacheKey, wrapperRef.current)
}
```

在 cleanup 中删除：

```typescript
remoteWrapperRefs.delete(cacheKey)
```

- [ ] **Step 2: 新增 `switchAgentInRemoteTerminal` 函数**

在 `launchAgentInRemoteTerminal`（第 29 行）之后插入：

```typescript
/**
 * 即时切换 SSH Remote Agent：立即重建 PTY + 启动新 Agent，后台异步关闭旧 PTY。
 */
export async function switchAgentInRemoteTerminal(
  cacheKey: string,
  agentId: string,
  agentCommandOverrides?: Record<string, string>,
) {
  const wrapper = remoteWrapperRefs.get(cacheKey)
  if (!wrapper) {
    // 回退：wrapper 未就绪，用旧路径
    const agent = await invoke<{ id: string; command: string; args: string[] }>(
      'get_agent', { agentId }
    ).catch(() => null)
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command
      launchAgentInRemoteTerminal(cacheKey, cmd, agent.args)
    }
    return
  }

  // 1. 摘除旧缓存事件监听
  const oldCache = remoteTerminalCache.get(cacheKey)
  if (oldCache) {
    oldCache.unlisten?.()
  }

  // 2. 删除旧条目
  remoteTerminalCache.delete(cacheKey)

  // 3. 清空 wrapper DOM
  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild)
  }

  // 4. 触发重建（selectedAgentId 已由 handleSelectRemoteAgent 更新到 props）
  remoteRebuildCallbacks.get(cacheKey)?.()

  // 5. 后台异步关闭旧 PTY
  if (oldCache?.sessionId) {
    invoke('close_remote_terminal_session', { sessionId: oldCache.sessionId }).catch(() => {})
  }
  oldCache?.term.dispose()
}
```

- [ ] **Step 3: 运行类型检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/terminal/RemoteTerminalView.tsx
git commit -m "feat: add remoteWrapperRefs and switchAgentInRemoteTerminal"
```

---

## Task 4: 更新 barrel export（index.ts）

**Files:**
- Modify: `src/components/terminal/index.ts`

- [ ] **Step 1: 读取当前 index.ts 内容**

读取 `src/components/terminal/index.ts`，确认当前导出的函数列表。

- [ ] **Step 2: 新增三个函数的导出**

在现有导出中增加：

```typescript
export { switchAgentInTerminal, terminalWrapperRefs } from './TerminalView'
export { switchAgentInWslTerminal, wslWrapperRefs } from './WSLTerminalView'
export { switchAgentInRemoteTerminal, remoteWrapperRefs } from './RemoteTerminalView'
```

- [ ] **Step 3: 运行类型检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/components/terminal/index.ts
git commit -m "feat: export new switch-agent functions from terminal barrel"
```

---

## Task 5: 更新 `useAppCallbacks.ts`（本地项目）

**Files:**
- Modify: `src/hooks/useAppCallbacks.ts`

### 背景

`handleSelectLocalAgent` 目前在 `agent != null` 时调用 `launchAgentInTerminal`（第 104 行），改为调用 `switchAgentInTerminal`。`switchAgentInTerminal` 是 async，但 `handleSelectLocalAgent` 是同步回调，直接 `void` 调用即可（fire-and-forget）。

需要额外传入：`project.path`、`project.name`、`fontSize`、`shell`、`fontFamily`——这些当前不在 `UseAppCallbacksParams` 中。为保持接口稳定，把它们作为新增可选参数传入。

- [ ] **Step 1: 在 `UseAppCallbacksParams` 中新增终端配置字段**

在 `UseAppCallbacksParams` interface 中新增：

```typescript
// 用于 switchAgentInTerminal 的终端参数
terminalFontSize?: number;
terminalShell?: string;
terminalFontFamily?: string;
```

- [ ] **Step 2: 更新 `useAppCallbacks` 函数体，解构新参数**

在 `const { ... } = params;` 中新增：

```typescript
terminalFontSize = 14,
terminalShell = '',
terminalFontFamily = '',
```

- [ ] **Step 3: 更新 import，引入 `switchAgentInTerminal`**

将第 4 行的 import 从：

```typescript
import { launchAgentInTerminal, refreshTerminal } from "../components/terminal";
```

改为：

```typescript
import { switchAgentInTerminal, refreshTerminal } from "../components/terminal";
```

- [ ] **Step 4: 更新 `handleSelectLocalAgent` 中的调用**

将第 102–104 行：

```typescript
if (agent) {
  const cmd = agentCommandOverrides?.[agent.id] ?? agent.command;
  launchAgentInTerminal(activeProject.id, cmd, agent.args);
```

改为：

```typescript
if (agent) {
  void switchAgentInTerminal(
    activeProject.id,
    activeProject.path,
    activeProject.name,
    agent.id,
    terminalFontSize,
    terminalShell,
    terminalFontFamily,
    agentCommandOverrides,
  );
```

- [ ] **Step 5: 在 `App.tsx` 中找到 `useAppCallbacks` 调用处，传入新参数**

搜索 `App.tsx` 中 `useAppCallbacks(` 的调用，添加三个新参数：

```typescript
terminalFontSize: config.fontSize ?? 14,
terminalShell: config.shell ?? '',
terminalFontFamily: config.fontFamily ?? '',
```

（其中 `config` 是 `useAppConfig` 返回的配置对象，字段名以实际 App.tsx 中的变量名为准）

- [ ] **Step 6: 运行类型检查**

```bash
npx tsc --noEmit
```

期望：无新增错误。

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAppCallbacks.ts src/App.tsx
git commit -m "feat: use switchAgentInTerminal in handleSelectLocalAgent for instant switch"
```

---

## Task 6: 更新 `useWslActions.ts`（WSL 项目）

**Files:**
- Modify: `src/hooks/useWslActions.ts`

- [ ] **Step 1: 更新 import，引入 `switchAgentInWslTerminal`**

将第 3 行的 import 从：

```typescript
import { launchAgentInWslTerminal, wslCacheKey, refreshWslTerminal } from "../components/terminal";
```

改为：

```typescript
import { switchAgentInWslTerminal, wslCacheKey, refreshWslTerminal } from "../components/terminal";
```

- [ ] **Step 2: 更新 `handleSelectWslAgent` 中的调用**

将第 115–117 行：

```typescript
if (agent) {
  const cmd = deps.config.agentCommandOverrides?.[agent.id] ?? agent.command;
  launchAgentInWslTerminal(key, cmd, agent.args);
}
```

改为：

```typescript
if (agent) {
  void switchAgentInWslTerminal(
    key,
    proj.distro,
    proj.project.path,
    proj.project.name,
    agent.id,
    deps.config.fontSize ?? 14,
    deps.config.fontFamily ?? '',
    deps.config.agentCommandOverrides,
  );
}
```

- [ ] **Step 3: 运行类型检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useWslActions.ts
git commit -m "feat: use switchAgentInWslTerminal in handleSelectWslAgent"
```

---

## Task 7: 更新 `useRemoteActions.ts`（SSH 项目）

**Files:**
- Modify: `src/hooks/useRemoteActions.ts`

- [ ] **Step 1: 更新 import，引入 `switchAgentInRemoteTerminal`**

将第 3 行的 import 从：

```typescript
import { launchAgentInRemoteTerminal, remoteCacheKey, refreshRemoteTerminal } from "../components/terminal";
```

改为：

```typescript
import { switchAgentInRemoteTerminal, remoteCacheKey, refreshRemoteTerminal } from "../components/terminal";
```

- [ ] **Step 2: 更新 `handleSelectRemoteAgent` 中的调用**

将第 152–154 行：

```typescript
if (agent) {
  const cmd = deps.config.agentCommandOverrides?.[agent.id] ?? agent.command;
  launchAgentInRemoteTerminal(key, cmd, agent.args);
}
```

改为：

```typescript
if (agent) {
  void switchAgentInRemoteTerminal(
    key,
    agent.id,
    deps.config.agentCommandOverrides,
  );
}
```

- [ ] **Step 3: 运行类型检查**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRemoteActions.ts
git commit -m "feat: use switchAgentInRemoteTerminal in handleSelectRemoteAgent"
```

---

## Task 8: 端到端验证

**Files:** 无代码改动，仅验证。

- [ ] **Step 1: 运行完整类型检查**

```bash
npx tsc --noEmit
```

期望：零错误。

- [ ] **Step 2: 运行前端单元测试**

```bash
pnpm test
```

期望：所有已有测试通过（本次改动不涉及纯函数，无需新增单测）。

- [ ] **Step 3: 运行 Rust 编译检查**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

期望：编译成功。

- [ ] **Step 4: 手动功能验证清单（开发模式下）**

启动 `pnpm tauri dev`，依次验证：

1. **本地项目 AgentA → AgentB**：点击 Agent 切换，应立即看到新终端创建并启动 AgentB，无需等待旧 Agent 退出。
2. **本地项目 AgentA → None**：应走原有 `refreshTerminal` 路径，终端重建为纯 shell。
3. **本地项目 None → AgentA**：应走 `switchAgentInTerminal` 路径，立即创建新 PTY 并自动启动 AgentA。
4. **连续快速切换两次**：第二次切换时旧的新 PTY 可能还在建立中，验证不会出现双重终端或崩溃。
5. **WSL 项目切换 Agent**：同本地项目验证。
6. **SSH 项目切换 Agent**：同本地项目验证。
7. **切换项目后重新进入**：缓存 reattach 正常，不受影响。

- [ ] **Step 5: 最终 commit（如有遗漏文件）**

```bash
git status
# 确认无遗漏的未暂存文件
```

---

## 边界情况备忘

| 场景 | 处理方式 |
|------|------|
| wrapper 未就绪（组件未挂载）| 回退到 `launchAgent*` 旧路径 |
| 旧 PTY 已自然退出 | `close_terminal_session` 报错 → `catch(() => {})` 静默忽略 |
| 连续快速切换 | 第二次切换时 cache 已空 → `oldCache` 为 undefined → 正常新建，不双重创建 |
| None → AgentA | `switchAgentInTerminal` 同样处理（旧 cache 是 shell PTY，异步关闭） |
| AgentA → None | 保持原有 `refreshTerminal` 路径不变 |
