# brainstorm: Enhance TitleBar with Terminal Tabs + Agent Bar

## Goal

重新设计 TitleBar 组件，将当前的单一 Agent 选择器改造成上下两层的布局：
- **上层**：Terminal Tab Bar - 多标签页管理终端会话
- **下层**：Agent Bar - 横向滚动的可用 Agent 列表

这个设计类似于 Trae / Windsurf / Cursor 等 AI IDE 的顶部栏设计，提供更直观的终端会话管理和 Agent 切换体验。

---

## What I already know

### 当前 TitleBar 结构
```
[NEEKO] [Settings] [+] | [ProjectName] [Branch] [AgentBar] [WindowControls]
```
- AgentBar 嵌入在 titlebar-right 区域内
- Agent 以按钮组形式横向排列
- 当前 Agent 通过蓝色背景高亮显示
- 支持紧凑模式（只显示图标）

### 当前 AgentBar 功能
- 从后端加载所有 enabled agents
- 检查 agent 是否已安装（check_agents_installed）
- 点击切换当前项目绑定的 agent
- 未安装的 agent 显示禁用状态并提示
- 支持紧凑/完整两种显示模式

### 数据模型
- `Project` / `WSLProject` / `RemoteProject` 都有 `selected_agent` 字段
- `AgentConfig` 包含 id, name, command, args, env, icon, enabled
- 通过 `invoke("set_project_agent", { projectId, agentId })` 持久化选择

### 预想的设计（Image 2）
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [pnpm tauri dev] [OC | 修改 nee... ●] [OpenCode ●]                 [+]    │  ← Tab Bar
├─────────────────────────────────────────────────────────────────────────────┤
│ [⚙️] [claude] [codex] [copilot] [mastracode] [opencode] [pi] [gemini] [可用]│  ← Agent Bar
└─────────────────────────────────────────────────────────────────────────────┘
```

### 关键差异
| 当前设计 | 预想设计 |
|---------|---------|
| 单一会话 | 多 Tab 会话 |
| Agent 选择器在右侧 | Agent Bar 在底部横向滚动 |
| Tab 概念不存在 | 新增 Terminal Tab 概念 |
| 分支显示在 TitleBar | 需要重新安排布局 |

---

## 已确认的设计决策

基于用户的选择，以下是确定的设计方案：

### 1. Agent 点击行为：**智能判断**
- Tab 空闲（无运行命令）→ 在当前 Tab 切换到该 Agent
- Tab 运行中（有命令执行）→ 新建 Tab 并启动该 Agent

### 2. "+" 按钮行为：**直接新建空白 Tab**
- 点击 "+" 创建一个空白的 Terminal Tab
- 用户手动输入命令或从 Agent Bar 选择 Agent

### 3. Tab 标题显示：**Agent 名**
- Tab 标题优先显示当前绑定的 Agent 名
- 无 Agent 时显示 "Terminal {n}"
- 不显示分支名或命令缩写（保持简洁）

### 4. 分支信息显示：**固定位置显示**
- 保留 TitleBar 固定位置显示当前项目分支名
- 所有 Tab 共享同一个分支显示区域

### 5. 副终端处理：**简化取消**
- 取消现有的副终端（Side Terminal）设计
- 统一用 Tab Bar 管理所有终端
- 移除相关快捷键和状态管理

### 6. Tab 与项目关系：**项目可有多 Tab**
- 每个项目支持打开多个独立的 Terminal Tab
- Tab 之间可以有不同的 Agent 绑定
- 类似于 VS Code 的终端多标签设计

---

## Requirements

### Functional Requirements

#### FR1: Terminal Tab Bar（上层）
- [ ] **Tab 列表显示**：显示当前项目的所有 Terminal Tab
- [ ] **Tab 标题**：显示当前绑定的 Agent 名，无 Agent 时显示 "Terminal {n}"
- [ ] **状态指示**：运行中的 Tab 显示绿色圆点指示器
- [ ] **Tab 切换**：点击 Tab 切换到对应的终端会话
- [ ] **关闭 Tab**：每个 Tab 显示关闭按钮（hover 时显示）
- [ ] **新建 Tab**："+" 按钮创建空白 Terminal Tab
- [ ] **横向滚动**：Tab 过多时支持横向滚动（显示左右滚动按钮）
- [ ] **激活状态**：当前激活的 Tab 高亮显示

#### FR2: Agent Bar（下层）
- [ ] **Agent 列表**：显示所有 enabled 的 Agent
- [ ] **横向滚动**：Agent 数量多时支持横向滚动
- [ ] **选中高亮**：当前 Tab 绑定的 Agent 高亮显示
- [ ] **智能切换**：点击 Agent 时智能判断（空闲则切换，运行中则新建 Tab）
- [ ] **安装状态**：未安装的 Agent 显示为禁用状态并提示
- [ ] **图标显示**：每个 Agent 显示对应的图标
- [ ] **悬停提示**：hover 时显示 Agent 全称

#### FR3: 固定信息区域
- [ ] **应用标识**：左上角显示 "NEEKO" 或应用图标
- [ ] **项目名**：显示当前激活的项目名称
- [ ] **分支名**：显示当前项目的 Git 分支名（如果有）
- [ ] **设置按钮**：提供设置入口
- [ ] **窗口控制**：非 macOS 显示最小化/最大化/关闭按钮

#### FR4: 持久化
- [ ] **Tab 持久化**：所有 Tab 信息持久化到 sessions.json
- [ ] **激活状态**：记录当前激活的 Tab ID
- [ ] **Agent 绑定**：每个 Tab 绑定的 Agent ID 持久化
- [ ] **会话恢复**：重启后恢复 Tab 布局和激活状态

#### FR5: 取消副终端
- [ ] **移除组件**：删除 SideTerminalView 组件
- [ ] **移除状态**：清理 useSideTerminalState hook
- [ ] **移除快捷键**：取消 Ctrl+Alt+T / Ctrl+W 快捷键
- [ ] **数据迁移**：旧版本数据兼容处理

### Non-Functional Requirements

#### NFR1: 性能
- [ ] Tab 切换响应时间 < 100ms
- [ ] Agent Bar 滚动流畅（60fps）
- [ ] 支持最多 10 个 Tab 同时打开

#### NFR2: 可访问性
- [ ] 支持键盘导航（Tab 键切换焦点，Enter 选择）
- [ ] Tab 支持快捷键关闭（Ctrl+W）
- [ ] 适当的 ARIA 标签

#### NFR3: 视觉一致性
- [ ] 保持现有的 One Dark Pro 主题风格
- [ ] Tab Bar 高度：32px
- [ ] Agent Bar 高度：28px
- [ ] 与现有组件的圆角、阴影、间距保持一致

#### NFR4: 兼容性
- [ ] 支持 local/WSL/SSH 三种项目类型
- [ ] 向后兼容旧版本 sessions.json

---

## Acceptance Criteria

- [ ] 用户可以看到当前项目的多个 Terminal Tab，标题显示 Agent 名
- [ ] 用户可以点击 Tab 切换不同的终端会话，切换时间 < 100ms
- [ ] 用户可以点击 "+" 创建新的空白 Terminal Tab
- [ ] 用户可以点击 Tab 的关闭按钮关闭该 Tab
- [ ] 用户可以在 Agent Bar 中看到所有可用的 Agent
- [ ] 用户点击 Agent 时，空闲 Tab 切换 Agent，运行中 Tab 新建 Tab
- [ ] 运行中的 Tab 显示绿色状态指示器
- [ ] TitleBar 固定位置显示当前项目名和 Git 分支名
- [ ] Tab 布局、激活状态、Agent 绑定在重启后恢复
- [ ] 副终端功能已完全移除，不再显示
- [ ] 设计在 local/WSL/SSH 三种项目类型上正常工作

---

## Definition of Done

- [ ] 所有 Acceptance Criteria 满足
- [ ] TerminalTabBar、TerminalTab、AgentBar 组件有单元测试
- [ ] 与现有功能的集成测试通过
- [ ] 类型检查通过（npx tsc --noEmit）
- [ ] Rust 编译检查通过（cargo check）
- [ ] 手动测试验证（local/WSL/SSH 三种场景）
- [ ] 旧版本数据迁移测试通过

---

## Out of Scope (explicit)

- [ ] Chat Tab（聊天界面）- 仅预留位置
- [ ] Browser Tab（浏览器界面）- 仅预留位置
- [ ] Tab 拖拽排序
- [ ] Tab 分组/文件夹功能
- [ ] 悬浮预览 Tab 内容
- [ ] Agent 市场/发现功能
- [ ] Tab 标题自定义编辑
- [ ] 每个 Tab 独立的分支显示
- [ ] 保留副终端功能（完全移除）

---

## Technical Design

### 组件架构

```
TitleBar (重构)
├── TitleBarUpper (上层)
│   ├── AppIdentity (NEEKO + Settings)
│   ├── ProjectInfo (项目名 + 分支名)
│   ├── TerminalTabBar (Tab 列表)
│   │   └── TerminalTab (单个 Tab)
│   ├── AddTabButton (+ 按钮)
│   └── WindowControls (窗口控制)
└── TitleBarLower (下层)
    └── AgentBar (横向滚动)
        └── AgentBarButton (单个 Agent)
```

### 数据模型变更

```typescript
// 新增类型：Terminal Tab
interface TerminalTab {
  id: string;
  projectId: string;        // 关联的项目 ID
  agentId: string | null;   // 绑定的 Agent ID
  title: string;            // 显示标题（由 Agent 名生成）
  status: "Idle" | "Running" | "Failed";
  createdAt: string;
  order: number;            // 排序序号
}

// Project 类型扩展
interface Project {
  // ... 现有字段
  tabs: TerminalTab[];      // 该项目的所有 Tab
  activeTabId: string | null;  // 当前激活的 Tab ID
}

// WSLProject 和 RemoteProject 同样需要扩展
interface WSLProject {
  // ... 现有字段
  tabs: TerminalTab[];
  activeTabId: string | null;
}

interface RemoteProject {
  // ... 现有字段
  tabs: TerminalTab[];
  activeTabId: string | null;
}
```

### 状态管理设计

```typescript
// 新增 Hook: useTerminalTabs
interface UseTerminalTabsReturn {
  // State
  tabs: TerminalTab[];
  activeTabId: string | null;
  
  // Actions
  addTab: (agentId?: string | null) => TerminalTab;
  closeTab: (tabId: string) => void;
  activateTab: (tabId: string) => void;
  setTabAgent: (tabId: string, agentId: string | null) => void;
  updateTabStatus: (tabId: string, status: TerminalTab["status"]) => void;
  reorderTabs: (newOrder: string[]) => void;
}

// Agent 智能切换逻辑
function handleAgentClick(agentId: string) {
  const activeTab = getActiveTab();
  
  if (activeTab.status === "Running") {
    // 当前 Tab 运行中，新建 Tab
    const newTab = addTab(agentId);
    activateTab(newTab.id);
  } else {
    // 当前 Tab 空闲，切换 Agent
    setTabAgent(activeTab.id, agentId);
  }
}
```

### 文件变更清单

#### Frontend (React/TypeScript)

**新增文件：**
- `src/components/layout/TerminalTabBar.tsx` - Tab Bar 容器组件
- `src/components/layout/TerminalTab.tsx` - 单个 Tab 组件
- `src/hooks/useTerminalTabs.ts` - Tab 状态管理 Hook
- `src/hooks/__tests__/useTerminalTabs.test.ts` - Hook 单元测试
- `src/components/layout/__tests__/TerminalTabBar.test.tsx` - 组件测试
- `src/components/layout/__tests__/TerminalTab.test.tsx` - 组件测试

**修改文件：**
- `src/components/layout/TitleBar.tsx` - 重构为双层布局
- `src/components/layout/AgentBar.tsx` - 调整样式，支持智能切换
- `src/types.ts` - 新增 TerminalTab 类型，扩展 Project/WSLProject/RemoteProject
- `src/styles.css` - 新增 TitleBar 双层样式
- `src/App.tsx` - 集成新的 Tab 管理，移除 Side Terminal
- `src/components/terminal/index.ts` - 移除 SideTerminalView export

**删除文件：**
- `src/components/terminal/SideTerminalView.tsx`
- `src/hooks/useSideTerminalState.ts`
- `src/hooks/useSideTerminalResize.ts`

#### Backend (Rust)

**修改文件：**
- `src-tauri/src/state.rs` - 新增 TerminalTab 结构体，扩展项目类型
- `src-tauri/src/storage.rs` - Tab 持久化/反持久化逻辑
- `src-tauri/src/project.rs` - Tab CRUD 操作
- `src-tauri/src/lib.rs` - 新增 Tab 管理命令

**新增命令：**
- `create_tab(project_id, agent_id?) -> TerminalTab`
- `close_tab(project_id, tab_id)`
- `activate_tab(project_id, tab_id)`
- `set_tab_agent(project_id, tab_id, agent_id)`
- `update_tab_status(project_id, tab_id, status)`
- `list_tabs(project_id) -> Vec<TerminalTab>`

### 样式设计

```css
/* TitleBar 双层布局 */
.titlebar {
  display: flex;
  flex-direction: column;
  height: 60px; /* 32px + 28px */
}

/* 上层：Tab Bar */
.titlebar-upper {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-color);
}

/* Tab Bar 容器 */
.terminal-tab-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none; /* Firefox */
}

.terminal-tab-bar::-webkit-scrollbar {
  display: none; /* Chrome/Safari */
}

/* 单个 Tab */
.terminal-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 4px 4px 0 0;
  background: var(--tab-inactive-bg);
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
}

.terminal-tab.active {
  background: var(--tab-active-bg);
  color: var(--text-primary);
}

.terminal-tab.running::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success-color);
}

.terminal-tab .close-btn {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.terminal-tab:hover .close-btn {
  opacity: 1;
}

/* 下层：Agent Bar */
.titlebar-lower {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  background: var(--agent-bar-bg);
}

.agent-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}

.agent-bar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  white-space: nowrap;
}

.agent-bar-btn.selected {
  background: var(--agent-selected-bg);
  color: var(--agent-selected-text);
}

.agent-bar-btn.not-installed {
  opacity: 0.4;
  cursor: not-allowed;
}
```

### 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+T` | 新建 Tab |
| `Ctrl+W` | 关闭当前 Tab |
| `Ctrl+Tab` | 切换到下一个 Tab |
| `Ctrl+Shift+Tab` | 切换到上一个 Tab |
| `Ctrl+1` ~ `Ctrl+9` | 跳转到第 N 个 Tab |

### 依赖检查

- **无需新增 npm 依赖**
- **无需新增 cargo 依赖**
- 使用现有的状态管理方案

### 迁移策略

1. **数据迁移**
   - 读取旧版本 sessions.json 时，为每个项目创建默认 Tab
   - 将 `selected_agent` 迁移到第一个 Tab 的 `agentId`
   - 删除 side terminal 相关持久化数据

2. **向后兼容**
   - 保留旧版本数据读取逻辑（一个版本周期）
   - 首次升级时自动迁移并保存为新格式

---

## Implementation Plan

### Phase 1: 基础架构（PR 1）
- [ ] 新增 TerminalTab 类型定义
- [ ] 实现 Rust 后端 Tab 管理命令
- [ ] 实现 useTerminalTabs hook
- [ ] 添加数据迁移逻辑

### Phase 2: UI 组件（PR 2）
- [ ] 实现 TerminalTab 组件
- [ ] 实现 TerminalTabBar 组件
- [ ] 重构 TitleBar 为双层布局
- [ ] 调整 AgentBar 样式和位置

### Phase 3: 功能集成（PR 3）
- [ ] 集成 Tab 管理到 App.tsx
- [ ] 实现智能 Agent 切换逻辑
- [ ] 实现键盘快捷键
- [ ] 移除 Side Terminal 功能

### Phase 4: 测试与优化（PR 4）
- [ ] 单元测试
- [ ] 集成测试
- [ ] 手动测试（local/WSL/SSH）
- [ ] 性能优化

---

## Risks & Mitigation

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 数据迁移失败 | 高 | 保留旧格式读取逻辑，添加数据备份 |
| 终端状态丢失 | 中 | Tab 切换时 detach PTY，不关闭 session |
| 性能下降 | 低 | 限制最大 Tab 数（10），使用虚拟滚动 |
| 用户不习惯 | 低 | 保留快捷键操作，提供平滑过渡 |

---

## Notes

- 设计已确认，可以进入实现阶段
- 优先实现 Phase 1 和 Phase 2，确保基础架构稳定
- Side Terminal 移除需要在最后进行，避免影响现有功能
