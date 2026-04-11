# 主终端管理 — 设计文档

> 日期：2026-04-11
> 状态：待批准

## 概述

Neeko 的主终端管理需要三项改进：
1. 阻止 Ctrl+C 在主终端中杀死 Agent 进程
2. Agent 下拉选检测 CLI 安装状态并提示
3. 选择 "None" 时重建空白终端

---

## 需求 1：阻止 Ctrl+C 退出主终端中的 Agent

### 问题

用户在主终端中按 Ctrl+C 会发送 SIGINT 给 Agent 进程，导致 Agent 被终止。当前行为是 3 秒后自动重建终端（`terminal-closed` 事件），但用户应该只能通过 Agent 下拉选切换 Agent。

### 设计

在 `TerminalView.tsx` 中新增 `blockCtrlC` prop（默认 `true`）：

```typescript
interface TerminalViewProps {
  project: Project
  fontSize?: number
  shell?: string
  fontFamily?: string
  suppressResizeRef?: React.MutableRefObject<boolean>
  agentCommandOverride?: string
  blockCtrlC?: boolean  // NEW — 默认 true，阻止 Ctrl+C 发送到 PTY
}
```

**过滤逻辑**：在 `onData` handler 中，当 `blockCtrlC` 为 true 时，过滤 `\x03`（Ctrl+C）字节，不发送到 PTY：

```typescript
term.onData((data) => {
  if (isComposing) return
  if (compositionPendingText && data === compositionPendingText) {
    compositionPendingText = ''
    return
  }
  // 阻止 Ctrl+C 发送到 PTY
  if (blockCtrlC && data === '\x03') {
    term.write('\x1b[33m\r\n[Neeko] Ctrl+C is disabled. Use Agent dropdown to switch.\x1b[0m\r\n')
    return
  }
  sendInput(data)
})
```

**副终端不受影响**：`SideTerminalView.tsx` 传入 `blockCtrlC={false}` 即可。

**影响范围**：
- `src/components/terminal/TerminalView.tsx` — 新增 prop + 过滤逻辑
- `src/components/terminal/SideTerminalView.tsx` — 传 `blockCtrlC={false}`
- `src/components/terminal/WorktreeTerminalView.tsx` — 传 `blockCtrlC={false}`（Worktree 终端不需要此限制）
- `src/components/terminal/WSLTerminalView.tsx` — 传 `blockCtrlC={false}`（WSL 终端同理）
- `src/components/terminal/RemoteTerminalView.tsx` — 传 `blockCtrlC={false}`（远程终端同理）

### 不变量

- 副终端、Worktree 终端、WSL 终端、SSH 终端的 Ctrl+C 行为不变
- `launchAgentInTerminal` 仍然可以发送 `\x03`（这是程序触发的，不是用户按的），用于切换 Agent 时中断旧 Agent

---

## 需求 2：Agent CLI 安装检测

### 问题

当前 Agent 下拉选选择任意 Agent 后直接发送命令，不管 Agent CLI 是否已安装。如果未安装，终端会显示 "command not found"，体验不好。

### 设计

#### 2a. 后端：新增 `check_agents_installed` Tauri 命令

在 `src-tauri/src/agent.rs` 中新增方法：

```rust
pub fn check_installed(&self, agent_ids: &[String]) -> HashMap<String, bool> {
    let mut result = HashMap::new();
    for id in agent_ids {
        if let Some(agent) = self.get_agent(id) {
            let installed = check_command_exists(&agent.command);
            result.insert(id.clone(), installed);
        }
    }
    result
}
```

`check_command_exists` 实现：
- Windows: `where <command>` 返回 exit code 0
- Unix: `which <command>` 返回 exit code 0

在 `lib.rs` 中注册：

```rust
#[tauri::command]
async fn check_agents_installed(
    state: State<'_, AppStateWrapper>,
    agent_ids: Vec<String>,
) -> Result<HashMap<String, bool>, String> {
    let state = state.0.lock().unwrap();
    Ok(state.agent_manager.check_installed(&agent_ids))
}
```

#### 2b. 前端：AgentSelector 集成检测

**修改 `AgentSelector.tsx`**：

1. 新增 `onShowToast` prop（用于弹 Toast）：
```typescript
interface AgentSelectorProps {
  projectId: string
  currentAgentId: string | null
  onSelectAgent: (agent: AgentConfig | null) => void
  skipBackendPersist?: boolean
  onShowToast?: (message: string, type?: "info" | "error") => void  // NEW
}
```

2. 新增 `installedMap` state（`Map<string, boolean>`），在下拉打开时批量检测：
```typescript
useEffect(() => {
  if (!isOpen || agents.length === 0) return
  invoke<Record<string, boolean>>("check_agents_installed", {
    agentIds: agents.map(a => a.id),
  }).then(setInstalledMap)
}, [isOpen, agents])
```

3. 下拉列表显示安装状态：
```tsx
{agents.map((agent) => {
  const installed = installedMap.get(agent.id) ?? true  // 未检测时假设已安装
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
      {!installed && <span className="agent-status-dot not-installed-dot" title="Not installed" />}
      {installed && <span className="agent-status-dot installed-dot" title="Installed" />}
    </div>
  )
})}
```

4. "None" 选项不需要安装检测，始终可用。

**修改 `TitleBar.tsx`**：传入 `onShowToast`：
```tsx
<AgentSelector
  projectId={activeProject.id}
  currentAgentId={activeProject.selected_agent}
  onSelectAgent={(agent) => { ... }}
  onShowToast={/* 需要从 props 传入 showToast */}
/>
```

**修改 `useAppCallbacks.ts`**：`showToast` 已经在 App 层可用，需传递到 TitleBar。

**CSS 新增**（`styles.css`）：
```css
.agent-option.not-installed {
  opacity: 0.6;
  cursor: not-allowed;
}

.agent-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: auto;
  flex-shrink: 0;
}

.agent-status-dot.installed-dot {
  background-color: #98c379; /* green */
}

.agent-status-dot.not-installed-dot {
  background-color: #e06c75; /* red */
}
```

### 不变量

- 未检测完成前（loading 状态），假设所有 Agent 已安装，避免闪烁
- 未安装的 Agent 仍然可以显示在列表中，只是有红色状态点且点击无效
- "None" 选项始终可用

---

## 需求 3：选择 "None" 时重建空白终端

### 问题

当前选择 "None" 不会重置终端，Agent 进程仍在运行，终端不是"干净"的 shell。

### 设计

**修改 `useAppCallbacks.ts` 中的 `handleSelectLocalAgent`**：

```typescript
const handleSelectLocalAgent = useCallback((agent: AgentConfig | null) => {
  if (agent) {
    // 选择 Agent：在当前终端中启动
    if (activeProject) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command
      launchAgentInTerminal(activeProject.id, cmd, agent.args)
    }
  } else {
    // 选择 None：重建空白终端
    if (activeProject) {
      // 1. 先更新 project.selected_agent 为 null
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
      // 2. 重建终端（refreshTerminal 会销毁旧终端 + 触发重建）
      //    重建时 selected_agent 为 null，不会自动启动 Agent
      refreshTerminal(activeProject.id)
    }
  }
}, [activeProject, agentCommandOverrides, setProjects, setActiveProject])
```

同时需要修改 `AgentSelector` 中选择 "None" 时的 `onSelectAgent(null)` 调用链。当前在 TitleBar 中：
```tsx
onSelectAgent={(agent) => {
  if (agent) onSelectLocalAgent(agent)
  // 当前 agent === null 时不调用任何东西
}}
```

需要改为始终调用：
```tsx
onSelectAgent={(agent) => {
  onSelectLocalAgent(agent)  // null 也会触发重建
}}
```

### 不变量

- `refreshTerminal` 复用已有机制，不引入新函数
- 重建后的终端 `selected_agent` 为 null，不会自动启动 Agent
- WSL/SSH 项目的 "None" 行为也需同步修改（各自 action hook 中）

---

## 数据流总结

```
用户点击 Agent 下拉选
    │
    ├─ 打开时 → check_agents_installed → 返回安装状态 → 渲染状态点
    │
    ├─ 点击已安装 Agent → handleSelectAgent → launchAgentInTerminal
    │                                              ├─ 发送 \x03 中断旧 Agent（程序触发，不被阻止）
    │                                              └─ 发送新 Agent 命令
    │
    ├─ 点击未安装 Agent → onShowToast("xxx not installed") → 不切换
    │
    └─ 点击 None → onSelectAgent(null) → handleSelectLocalAgent(null)
                                              ├─ setProjects(selected_agent: null)
                                              └─ refreshTerminal → 重建空白终端

用户在终端按 Ctrl+C
    │
    └─ onData 收到 \x03 → blockCtrlC=true → 过滤并提示 → 不发送到 PTY
```

---

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/components/terminal/TerminalView.tsx` | 新增 `blockCtrlC` prop，onData 中过滤 `\x03` |
| `src/components/terminal/SideTerminalView.tsx` | 传 `blockCtrlC={false}` |
| `src/components/terminal/WorktreeTerminalView.tsx` | 传 `blockCtrlC={false}` |
| `src/components/terminal/WSLTerminalView.tsx` | 传 `blockCtrlC={false}` |
| `src/components/terminal/RemoteTerminalView.tsx` | 传 `blockCtrlC={false}` |
| `src/components/layout/AgentSelector.tsx` | 集成安装检测、状态点显示、Toast |
| `src/components/layout/TitleBar.tsx` | 传 `onShowToast`，修改 null agent 调用链 |
| `src/hooks/useAppCallbacks.ts` | None 时调 `refreshTerminal` |
| `src-tauri/src/agent.rs` | 新增 `check_installed` 方法 + `check_command_exists` |
| `src-tauri/src/lib.rs` | 注册 `check_agents_installed` Tauri 命令 |
| `src/styles.css` | Agent 状态点样式、not-installed 样式 |

---

## 测试策略

### 前端（Vitest）
- `TerminalView` 的 `blockCtrlC` prop：验证 `\x03` 被过滤
- `AgentSelector` 安装检测：mock `invoke` 返回状态，验证渲染
- `handleSelectLocalAgent(null)`：验证 `refreshTerminal` 被调用

### 后端（Rust #[test]）
- `check_command_exists("nonexistent_command_12345")` → false
- `check_command_exists("node")` 或 `"echo"` → true（系统命令）
- `check_installed` 批量检测返回正确映射

### E2E
- 手动测试：运行 Agent 后按 Ctrl+C，确认 Agent 不退出
- 手动测试：下拉选显示红/绿状态点
- 手动测试：选择 None 后终端重建为空白 shell

---

## 自审检查

- [x] 无占位符或 TBD
- [x] 架构一致：复用 `refreshTerminal`、`launchAgentInTerminal` 等已有函数
- [x] 副终端不受 Ctrl+C 限制影响
- [x] 安装检测失败（命令不存在）有明确 UI 反馈
- [x] WSL/SSH 终端同步支持"None"重建逻辑
