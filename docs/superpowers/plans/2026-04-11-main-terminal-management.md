# 主终端管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现三项主终端管理改进：阻止 Ctrl+C 退出 Agent、Agent CLI 安装检测、选择 None 时重建空白终端

**Architecture:** 通过前端拦截 Ctrl+C 字节实现保护，后端批量检测 Agent 安装状态，复用 `refreshTerminal` 机制重建空白终端。涉及 3 层改动：Rust 后端命令 → React 终端组件 → Agent 选择器 UI。

**Tech Stack:** Rust (Tauri 2 commands), TypeScript/React (xterm.js), CSS

---

## 文件结构

```
src-tauri/src/
├── agent.rs                          # Task 1: 新增 check_installed + check_command_exists
├── commands/agent.rs                 # Task 1: 新增 check_agents_installed 命令
├── lib.rs                            # Task 1: 注册新命令

src/
├── components/
│   ├── terminal/
│   │   └── TerminalView.tsx          # Task 2: 新增 blockCtrlC prop + onData 过滤
│   └── layout/
│       ├── AgentSelector.tsx         # Task 3: 集成安装检测 + 状态点 + Toast
│       └── TitleBar.tsx              # Task 4: 传 onShowToast + 修改 null agent 调用链
├── hooks/
│   ├── useAppCallbacks.ts            # Task 4: None 时调 refreshTerminal 重建
│   ├── useWslActions.ts              # Task 4: None 时调 refreshWslTerminal
│   └── useRemoteActions.ts           # Task 4: None 时调 refreshRemoteTerminal
└── styles.css                        # Task 3: Agent 状态点样式
```

---

### Task 1: 后端 — 批量检测 Agent CLI 安装状态

**Files:**
- Modify: `src-tauri/src/agent.rs`
- Modify: `src-tauri/src/commands/agent.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 编写 Rust 单元测试 — `check_command_exists`**

在 `src-tauri/src/agent.rs` 的 `#[cfg(test)]` 模块中添加：

```rust
#[test]
fn should_check_command_exists_for_known_command() {
    // "echo" 在所有平台上都存在
    assert!(check_command_exists("echo"));
}

#[test]
fn should_return_false_for_nonexistent_command() {
    assert!(!check_command_exists("nonexistent_cmd_12345_xyz"));
}
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: FAIL — `check_command_exists` 未定义

- [ ] **Step 3: 在 `agent.rs` 中实现 `check_command_exists`**

在 `AgentManager` 的 `impl` 块**之前**（`impl` 块**外部**）添加：

```rust
use std::collections::HashMap;

/// 检测命令是否存在于系统 PATH 中
pub fn check_command_exists(command: &str) -> bool {
    let cmd = if cfg!(target_os = "windows") {
        std::process::Command::new("where")
            .arg(command)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
    } else {
        std::process::Command::new("which")
            .arg(command)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
    };
    cmd.map(|s| s.success()).unwrap_or(false)
}
```

- [ ] **Step 4: 在 `AgentManager` 中实现 `check_installed`**

在 `impl AgentManager` 块中添加：

```rust
/// 批量检测 Agent CLI 是否已安装
pub fn check_installed(&self, agent_ids: &[String]) -> HashMap<String, bool> {
    let mut result = HashMap::new();
    for id in agent_ids {
        if let Some(agent) = self.get_agent(id) {
            result.insert(id.clone(), check_command_exists(&agent.command));
        }
    }
    result
}
```

- [ ] **Step 5: 添加对应的单元测试**

```rust
#[test]
fn should_check_installed_returns_correct_mapping() {
    let manager = AgentManager::new();
    let ids = vec!["opencode".to_string(), "nonexistent_123".to_string()];
    let result = manager.check_installed(&ids);
    assert_eq!(result.len(), 2);
    // "opencode" 是否安装取决于环境，但 key 必须存在
    assert!(result.contains_key("opencode"));
    assert!(result.contains_key("nonexistent_123"));
    assert!(!result["nonexistent_123"]);
}
```

- [ ] **Step 6: 运行测试验证通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -- agent`
Expected: PASS

- [ ] **Step 7: 添加 Tauri 命令 `check_agents_installed`**

在 `src-tauri/src/commands/agent.rs` 末尾添加：

```rust
use std::collections::HashMap;

#[tauri::command]
pub fn check_agents_installed(
    agent_ids: Vec<String>,
    state: State<AppStateWrapper>,
) -> Result<HashMap<String, bool>, String> {
    state
        .agent_manager
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))
        .map(|am| am.check_installed(&agent_ids))
}
```

- [ ] **Step 8: 在 `lib.rs` 中注册新命令**

在 `invoke_handler` 列表中 `commands::get_agent` 之后添加 `commands::check_agents_installed`：

```rust
// ...existing...
commands::get_agent,
commands::check_agents_installed,  // ADD THIS
commands::add_agent,
// ...existing...
```

- [ ] **Step 9: 编译验证**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 编译通过

- [ ] **Step 10: Commit**

```bash
git add src-tauri/src/agent.rs src-tauri/src/commands/agent.rs src-tauri/src/lib.rs
git commit -m "feat(agent): add check_agents_installed backend command"
```

---

### Task 2: 前端 — 主终端阻止 Ctrl+C

**Files:**
- Modify: `src/components/terminal/TerminalView.tsx`

- [ ] **Step 1: 在 `TerminalViewProps` 中新增 `blockCtrlC` prop**

```typescript
interface TerminalViewProps {
  project: Project
  fontSize?: number
  shell?: string
  fontFamily?: string
  suppressResizeRef?: React.MutableRefObject<boolean>
  agentCommandOverride?: string
  blockCtrlC?: boolean  // NEW — true 时阻止用户 Ctrl+C 发送到 PTY
}
```

- [ ] **Step 2: 在 `TerminalView` 组件中解构新 prop**

```typescript
function TerminalView({
  project,
  fontSize = 14,
  shell = '',
  fontFamily = '',
  suppressResizeRef,
  agentCommandOverride,
  blockCtrlC = true,  // NEW — 默认阻止
}: TerminalViewProps) {
```

- [ ] **Step 3: 在 `createTerminalForProject` 函数中新增 `blockCtrlC` 参数**

修改 `createTerminalForProject` 签名，新增第 10 个参数：

```typescript
export async function createTerminalForProject(
  projectId: string,
  _projectPath: string,
  projectName: string,
  selectedAgentId: string | null,
  fontSize: number,
  wrapper: HTMLElement,
  shell: string,
  fontFamily: string,
  backendProjectId?: string,
  agentCommandOverrides?: Record<string, string>,
  blockCtrlC: boolean = false,  // NEW — utility 函数默认不阻止
): Promise<TerminalCache> {
```

在 `term.onData` handler 中（约 line 294），在 `sendInput(data)` 之前添加过滤：

```typescript
term.onData((data) => {
  if (isComposing) return
  if (compositionPendingText && data === compositionPendingText) {
    compositionPendingText = ''
    return
  }
  // 阻止 Ctrl+C 发送到 PTY（仅 blockCtrlC=true 时）
  if (blockCtrlC && data === '\x03') {
    term.write('\x1b[33m\r\n[Neeko] Ctrl+C is disabled. Use Agent dropdown to switch.\x1b[0m\r\n')
    return
  }
  sendInput(data)
})
```

同时需要在 `TerminalCache` 接口中存储此标志（或直接通过闭包捕获，因为 `createTerminalForProject` 是 async 函数）。

- [ ] **Step 4: 在 `TerminalView` 组件 effect 中传递 `blockCtrlC`**

在 `TerminalView` 的 `useEffect` 中（约 line 352），调用 `createTerminalForProject` 时传入 `blockCtrlC`：

```typescript
createTerminalForProject(
  projectId,
  project.path,
  project.name,
  project.selected_agent,
  fontSize,
  wrapper,
  shell,
  fontFamily,
  undefined,
  agentCommandOverride && project.selected_agent
    ? { [project.selected_agent]: agentCommandOverride }
    : undefined,
  blockCtrlC,  // NEW
).then(...)
```

- [ ] **Step 5: 更新 `React.memo` 比较函数**

```typescript
export default React.memo(TerminalView, (prev, next) =>
  prev.project.id === next.project.id &&
  prev.fontSize === next.fontSize &&
  prev.shell === next.shell &&
  prev.fontFamily === next.fontFamily &&
  prev.agentCommandOverride === next.agentCommandOverride &&
  prev.blockCtrlC === next.blockCtrlC  // NEW
)
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 7: Commit**

```bash
git add src/components/terminal/TerminalView.tsx
git commit -m "feat(terminal): add blockCtrlC to prevent Ctrl+C killing Agent"
```

---

### Task 3: 前端 — Agent 下拉选安装状态检测 + UI

**Files:**
- Modify: `src/components/layout/AgentSelector.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: 在 `AgentSelectorProps` 中新增 `onShowToast` prop**

```typescript
interface AgentSelectorProps {
  projectId: string
  currentAgentId: string | null
  onSelectAgent: (agent: AgentConfig | null) => void
  skipBackendPersist?: boolean
  onShowToast?: (message: string, type?: "info" | "error") => void  // NEW
}
```

在函数参数中解构：

```typescript
const AgentSelector: React.FC<AgentSelectorProps> = ({
  projectId,
  currentAgentId,
  onSelectAgent,
  skipBackendPersist = false,
  onShowToast,
}) => {
```

- [ ] **Step 2: 新增 `installedMap` state + 下拉打开时批量检测**

```typescript
const [installedMap, setInstalledMap] = useState<Map<string, boolean>>(new Map())

useEffect(() => {
  if (!isOpen || agents.length === 0) return
  invoke<Record<string, boolean>>("check_agents_installed", {
    agentIds: agents.map(a => a.id),
  }).then((result) => {
    const map = new Map<string, boolean>()
    for (const [id, installed] of Object.entries(result)) {
      map.set(id, installed)
    }
    setInstalledMap(map)
  }).catch(() => {
    // 检测失败时假设全部已安装
    setInstalledMap(new Map())
  })
}, [isOpen, agents])
```

- [ ] **Step 3: 修改下拉列表渲染，添加安装状态点**

将现有的 agents map 渲染替换为：

```tsx
{agents.map((agent) => {
  const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true)
  return (
    <div
      key={agent.id}
      className={`agent-option ${selectedAgentId === agent.id ? "selected" : ""} ${!installed ? "not-installed" : ""}`}
      onClick={() => {
        if (!installed) {
          onShowToast?.(`${agent.name} (${agent.command}) is not installed`, "error")
          return
        }
        if (agent.enabled) handleSelectAgent(agent.id)
      }}
    >
      <AgentIcon icon={agent.icon} />
      <span className="agent-name">{agent.name}</span>
      <span className="agent-command">{agent.command}</span>
      {installedMap.size > 0 && (
        <span className={`agent-status-dot ${installed ? "installed-dot" : "not-installed-dot"}`} />
      )}
    </div>
  )
})}
```

- [ ] **Step 4: 在 `styles.css` 中添加状态点样式**

在 `.agent-dropdown` 相关样式之后添加：

```css
.agent-option.not-installed {
  opacity: 0.5;
  cursor: not-allowed;
}

.agent-option.not-installed:hover {
  background: rgba(224, 108, 117, 0.15); /* red tint */
}

.agent-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: auto;
  flex-shrink: 0;
}

.agent-status-dot.installed-dot {
  background-color: #98c379;
}

.agent-status-dot.not-installed-dot {
  background-color: #e06c75;
}
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/AgentSelector.tsx src/styles.css
git commit -m "feat(agent): show CLI installation status in dropdown"
```

---

### Task 4: 前端 — None 选项重建空白终端 + TitleBar 传 Toast

**Files:**
- Modify: `src/components/layout/TitleBar.tsx`
- Modify: `src/hooks/useAppCallbacks.ts`
- Modify: `src/hooks/useWslActions.ts`
- Modify: `src/hooks/useRemoteActions.ts`

- [ ] **Step 1: 修改 TitleBar 接收 `showToast` 并传给 AgentSelector**

在 `TitleBarProps` 中新增：

```typescript
interface TitleBarProps {
  // ...existing props...
  showToast: (message: string, type?: "info" | "error") => void  // NEW
}
```

在 `TitleBar` 函数参数中解构 `showToast`，并传给每个 AgentSelector：

```tsx
{/* 三个 AgentSelector 都添加 onShowToast={showToast} */}
<AgentSelector
  projectId={activeProject.id}
  currentAgentId={activeProject.selected_agent}
  onSelectAgent={(agent) => {
    onSelectLocalAgent(agent)
    invoke("save_session").catch(() => {})
  }}
  onShowToast={showToast}
/>
```

同时修改 TitleBar 中本地 Agent 的 `onSelectAgent` 回调——当前只在 `agent` 非 null 时调用：

```tsx
onSelectAgent={(agent) => {
  if (agent) onSelectLocalAgent(agent)  // CURRENT
}}
```

改为始终调用：

```tsx
onSelectAgent={(agent) => {
  onSelectLocalAgent(agent)  // Always call, even for null
}}
```

- [ ] **Step 2: 在 App.tsx 中传 `showToast` 给 TitleBar**

在 `<TitleBar ...>` props 中添加：

```tsx
<TitleBar
  // ...existing props...
  showToast={showToast}
/>
```

- [ ] **Step 3: 修改 `useAppCallbacks.ts` 中的 `handleSelectLocalAgent`**

将现有的实现：

```typescript
const handleSelectLocalAgent = useCallback((agent: AgentConfig | null) => {
  if (agent && activeProject) {
    const cmd = agentCommandOverrides?.[agent.id] ?? agent.command
    launchAgentInTerminal(activeProject.id, cmd, agent.args)
  }
}, [activeProject, agentCommandOverrides])
```

替换为：

```typescript
const handleSelectLocalAgent = useCallback((agent: AgentConfig | null) => {
  if (!activeProject) return
  if (agent) {
    const cmd = agentCommandOverrides?.[agent.id] ?? agent.command
    launchAgentInTerminal(activeProject.id, cmd, agent.args)
  } else {
    // 选择 None：重建空白终端
    setProjects(prev =>
      prev.map(p => p.id === activeProject.id
        ? { ...p, selected_agent: null }
        : p
      )
    )
    setActiveProject(prev =>
      prev && prev.id === activeProject.id
        ? { ...prev, selected_agent: null }
        : prev
    )
    refreshTerminal(activeProject.id)
  }
}, [activeProject, agentCommandOverrides, setProjects, setActiveProject])
```

在文件顶部添加 import：

```typescript
import { launchAgentInTerminal, refreshTerminal } from "../components/terminal"
```

- [ ] **Step 4: 修改 `useWslActions.ts` 中的 `handleSelectWslAgent`**

当前实现不处理 `agent === null` 的情况。修改为：

```typescript
const handleSelectWslAgent = useCallback((agent: AgentConfig | null) => {
  const proj = deps.activeWslProject;
  if (!proj) return;
  const key = wslCacheKey(proj.distro, proj.project.id);
  if (agent) {
    const cmd = deps.config.agentCommandOverrides?.[agent.id] ?? agent.command;
    launchAgentInWslTerminal(key, cmd, agent.args);
  } else {
    // 选择 None：重建 WSL 空白终端
    refreshWslTerminal(key);
  }
  const agentId = agent?.id ?? null;
  // ...后面的 entries 更新逻辑不变...
```

在文件顶部添加 import：

```typescript
import { launchAgentInWslTerminal, wslCacheKey, refreshWslTerminal } from "../components/terminal"
```

- [ ] **Step 5: 修改 `useRemoteActions.ts` 中的 `handleSelectRemoteAgent`**

同理：

```typescript
const handleSelectRemoteAgent = useCallback((agent: AgentConfig | null) => {
  const proj = deps.activeRemoteProject;
  if (!proj) return;
  const key = remoteCacheKey(proj.entry.id, proj.project.id);
  if (agent) {
    const cmd = deps.config.agentCommandOverrides?.[agent.id] ?? agent.command;
    launchAgentInRemoteTerminal(key, cmd, agent.args);
  } else {
    // 选择 None：重建 Remote 空白终端
    refreshRemoteTerminal(key);
  }
  const agentId = agent?.id ?? null;
  // ...后面的 entries 更新逻辑不变...
```

在文件顶部添加 import：

```typescript
import { launchAgentInRemoteTerminal, remoteCacheKey, refreshRemoteTerminal } from "../components/terminal"
```

- [ ] **Step 6: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/TitleBar.tsx src/hooks/useAppCallbacks.ts src/hooks/useWslActions.ts src/hooks/useRemoteActions.ts
git commit -m "feat(agent): rebuild blank terminal on None selection"
```

---

### Task 5: 前端 — WSL/Remote 终端的 Ctrl+C 拦截

> **注意**: WSL 和 Remote 终端通过 `AgentSelector` 选择 Agent 时也会调用 `launchAgentInWslTerminal` / `launchAgentInRemoteTerminal`，这些函数会先发 `\x03` 中断当前进程。用户在 WSL/Remote 终端里按 Ctrl+C 不会被阻止（它们是独立终端，不在 main terminal 里），所以此任务**不需要改动**。

确认：WSL 和 Remote 终端不使用 `TerminalView`，它们各自有 `WSLTerminalView` 和 `RemoteTerminalView`，且不需要 Ctrl+C 保护。`blockCtrlC` 仅应用于本地主终端（`TerminalView`）。

- [ ] **Step 1: 无需改动，记录确认**

此任务跳过，无代码变更。

---

### Task 6: 端到端验证

- [ ] **Step 1: 完整类型检查**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 2: Rust 编译检查**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: 编译通过

- [ ] **Step 3: 运行所有测试**

Run: `pnpm test`
Expected: 所有前端测试通过

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 所有后端测试通过

- [ ] **Step 4: Commit 验证完成**

```bash
git status
```

确认所有改动已提交。

---

## 自审

| 检查项 | 状态 |
|--------|------|
| 无 TBD/TODO/占位符 | ✅ |
| 所有类型/方法名称一致 | ✅ |
| `blockCtrlC` 默认值：TerminalView=true, createTerminalForProject=false | ✅ |
| `refreshTerminal` 在 barrel export 中已有导出 | ✅ |
| `refreshWslTerminal` 在 barrel export 中已有导出 | ✅ |
| `refreshRemoteTerminal` 在 barrel export 中已有导出 | ✅ |
| TitleBar 已有 showToast 传入路径（App.tsx → TitleBar） | ✅ |
| WSL/Remote 终端不需 Ctrl+C 阻止 | ✅ |
| TDD 流程：先写 Rust 测试再实现 | ✅ |
