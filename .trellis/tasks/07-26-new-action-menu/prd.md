# New Action Menu（终端 / Agent / 文件统一新增入口）

## Goal

替换当前 TabBar 右上角单一的 “New terminal tab”（`+` 按钮），提供一个可扩展的统一新增入口，让用户能够在当前项目/Worktree 下快速创建：

- 新终端（默认 shell / 指定 Agent / 当前任务）
- Agent 会话（先落地为“新建带 Agent 的终端 Tab”，未来可扩展为 conversation）
- 文件相关操作（新建文件、打开文件、最近文件）
- 快速项目操作（打开副终端、IDE）

## Background

- 当前 `TabBar` 的 “+” 按钮只调用 `onAddTerminalTab`，title 为 “New terminal tab”（`src/features/editor/components/TabBar.tsx:196-204`）。
- `TabKind` 已支持 `terminal | file | diff | html-preview | conversation | prDetail`（`src/shared/types/tab.ts:6`）。
- `AgentSelector` 里已有 “Add/Change agent” 下拉菜单，包含 `terminal / chat / browser` 三种模式，但 chat 仅 toast “Coming soon”，browser 切换 dock 面板（`src/features/agent/components/AgentSelector.tsx:290-307`）。
- 文件打开已有成熟的 `QuickOpenPalette`（`src/features/quick-open/QuickOpenPalette.tsx`）和 `openProjectFile`（`src/features/quick-open/openFile.ts`）。
- 项目已有键盘快捷键体系：`Ctrl+Alt+T/Ctrl+W` 副终端、`Ctrl+O` IDE、`Ctrl+N` Worktree 终端。

## Requirements

### R1 入口形态

- 保留 TabBar 右侧 “+” 按钮作为**默认入口**。
- 点击 “+” 后从按钮锚点展开一个**下拉页（Action Menu Dropdown）**，宽度 280-320px，高度自适应，最大不超过 50vh。
- 同时注册一个**全局命令面板**快捷键 `Ctrl+Shift+A`（可配置），打开居中的搜索面板，支持跨项目全局搜索可用动作。

### R2 下拉页内容

下拉页至少包含以下分组：

| 分组 | 动作 | 说明 |
|------|------|------|
| **Terminal** | New Terminal（默认 shell） | 直接新建一个无 Agent 的 terminal tab |
| **Terminal** | New Terminal with Agent → | 悬浮或嵌套展开已启用 Agent 列表，点击即新建对应 Agent 终端 |
| **Agent** | Quick Agent Bar | 与当前 `AgentBar` 一致，显示已启用 Agent，点击新建对应终端 |
| **File** | New File… | 弹出路径输入，在当前项目创建空文件并打开编辑 |
| **File** | Open File… | 打开当前项目 QuickOpen palette（gotoFile） |
| **File** | Recent Files | 列出最近 5 个文件，点击打开 |
| **Quick Actions** | Open Side Terminal | 打开/聚焦副终端 |
| **Quick Actions** | Open in IDE | 在 IDE 中打开项目 |

### R3 命令面板

- 居中模态，`max-w-[560px]`，与 `QuickOpenPalette` 视觉风格一致。
- 顶部输入框即时过滤动作列表。
- 列表项展示：图标、标题、描述、快捷键。
- 支持 ↑↓ 导航、Enter 确认、Esc 关闭。
- 打开后自动聚焦输入框。

### R4 搜索与过滤

- 下拉页顶部提供搜索框，输入时即时过滤本菜单内动作。
- 命令面板搜索范围更广，可搜索全局动作（后续可扩展）。
- 搜索关键词支持拼音/缩写匹配（后续扩展，MVP 仅做简单包含匹配）。

### R5 可访问性

- 所有交互元素支持键盘导航。
- 按钮/icon-only 按钮提供 `title` 与 `aria-label`。
- 浮层使用 `role="menu"` / `role="dialog"`，关闭时焦点返回触发按钮。
- 支持 `prefers-reduced-motion`。

### R6 扩展性

- 动作列表通过配置数组渲染，新增动作只需在配置表中追加一行，无需改动组件结构。

### R7 兼容性

- 保留现有 `useTerminalTabs.addTab` 能力，终端数量仍限制为 10 个（`src/features/terminal/hooks/useTerminalTabs.ts:130`）。
- 保留现有 `AgentSelector` 的 Agent 选择逻辑，不破坏当前项目默认 Agent 设置。
- 保留现有 QuickOpen、文件打开的所有调用路径。

## Acceptance Criteria

- [ ] 点击 TabBar “+” 按钮能展开 Action Menu Dropdown。
- [ ] 下拉页内 “New Terminal” 点击后新建默认 terminal tab 并激活。
- [ ] 下拉页内选择 Agent 后新建对应 Agent 的 terminal tab 并激活。
- [ ] 下拉页内 “New File…” 弹出路径输入，确认后创建空文件并打开编辑。
- [ ] 下拉页内 “Open File…” 打开当前项目的 QuickOpen palette。
- [ ] 下拉页内 “Recent Files” 列出最近文件，点击后打开文件 tab。
- [ ] 命令面板 `Ctrl+Shift+A` 打开后聚焦输入框，输入可过滤动作。
- [ ] 命令面板 ↑↓ 选择、Enter 执行、Esc 关闭。
- [ ] 键盘 Tab/Shift+Tab 可在下拉页/面板内所有动作间导航。
- [ ] 动作配置表新增一项后，UI 自动渲染，无需修改布局组件。
- [ ] 旧 `onAddTerminalTab` 调用点仍工作，未引入回归。
- [ ] 对应单元测试覆盖：动作过滤、快捷键处理、配置渲染。

## Out of Scope

- 不实现 conversation/chat tab（本菜单不提供 Agent Chat 入口）。
- 不实现文件系统树内右键菜单改造。
- 不实现跨项目全局文件搜索（命令面板 MVP 只搜索动作）。
- 不修改现有 `AgentSelector` 的 “Add/Change agent” 菜单（可复用其 AgentBar 子组件，但保留原入口）。

## Open Questions

- `Ctrl+Shift+A` 是否与系统/浏览器快捷键冲突？需要在 Windows/macOS 分别验证；如冲突则备选 `Ctrl+Shift+P` 或 `Ctrl+K`。
- 命令面板未来是否要合并 `QuickOpenPalette`（统一为 omnibox）？本轮保持独立，避免一次改动过大。
