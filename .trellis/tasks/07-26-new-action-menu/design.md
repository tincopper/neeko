# New Action Menu — 技术设计方案

## 1. 架构边界

```
┌─────────────────────────────────────────────────────────────────┐
│  App / ProjectWorkspace                                          │
│   ├─ 注册全局快捷键 Ctrl+Shift+A                                 │
│   ├─ 提供 onOpenActionPalette()                                  │
│   └─ 挂载 <ActionPalette />（居中命令面板）                     │
├─────────────────────────────────────────────────────────────────┤
│  TabBar                                                          │
│   ├─ “+” 按钮改为 <ActionMenuButton />                          │
│   ├─ 点击打开 <ActionMenuDropdown />（锚定下拉页）              │
│   └─ 向 ActionMenu 注入当前上下文（projectId / worktreePath）   │
├─────────────────────────────────────────────────────────────────┤
│  ActionMenu 域（新增）                                           │
│   ├─ actionRegistry.ts      ── 动作配置表                        │
│   ├─ useActionMenu.ts       ── 状态 + 过滤 + 执行封装            │
│   ├─ ActionMenuDropdown.tsx ── 锚定下拉页                        │
│   ├─ ActionMenuItem.tsx     ── 单条动作 UI                       │
│   ├─ ActionPalette.tsx      ── 居中命令面板                      │
│   └─ ActionPaletteItem.tsx  ── 面板列表项                        │
└─────────────────────────────────────────────────────────────────┘
```

- **纯展示组件**：`ActionMenuDropdown`、`ActionPalette`、`ActionMenuItem` 只接收数据与回调。
- **adapter 层**：`TabBar` / `ProjectWorkspace` 负责把项目上下文注入菜单，调用现有 `useTerminalTabs`、`useQuickOpenStore`、`openProjectFile` 等能力。
- **配置驱动**：所有可执行动作在 `actionRegistry.ts` 中声明，下拉页与命令面板共享同一份 registry，仅渲染方式不同。

## 2. 数据模型

```ts
// src/features/action-menu/types/actionMenu.ts
export type ActionId =
  | 'new-terminal'
  | 'new-terminal-with-agent'
  | 'new-file'
  | 'open-file'
  | 'recent-files'
  | 'open-side-terminal'
  | 'open-in-ide';

export interface ActionMenuItem {
  id: ActionId;
  group: 'terminal' | 'agent' | 'file' | 'quick' | 'future';
  label: string;
  description?: string;
  icon: LucideIcon;
  shortcut?: string;
  keywords: string[];          // 用于搜索过滤
  disabled?: boolean;
  visible?: (ctx: ActionContext) => boolean;
  execute: (ctx: ActionContext) => void | Promise<void>;
}

export interface ActionContext {
  projectId: string;
  worktreePath: string | null;
  tabKey: string;
  agents: AgentConfig[];
  currentAgentId: string | null;
  recentFiles: string[];
  closeMenu: () => void;
}
```

- `keywords` 同时包含中文/英文别名，便于后续做拼音/缩写匹配。
- `visible` 用于控制动作是否出现。
- `execute` 完全由调用侧注入，保证展示组件不依赖具体 store。

## 3. 状态与 Hook

### 3.1 `useActionMenu`

封装 Action Menu 通用状态：

```ts
export function useActionMenu(items: ActionMenuItem[], ctx: ActionContext) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedAgent, setExpandedAgent] = useState(false);

  const filtered = useMemo(
    () => filterActions(items, query, ctx),
    [items, query, ctx]
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { ... }
    if (e.key === 'ArrowUp') { ... }
    if (e.key === 'Enter') { executeSelected(); }
    if (e.key === 'Escape') { ctx.closeMenu(); }
  }, [...]);

  return { query, setQuery, filtered, selectedIndex, setSelectedIndex, handleKeyDown, ... };
}
```

### 3.2 命令面板状态

使用全局 Zustand store 或局部 state：

- 方案 A（推荐）：复用 `useQuickOpenStore` 模式，新增 `useActionPaletteStore`，支持 `openPalette()` / `closePalette()`。
- 方案 B：由 `ProjectWorkspace` 用 `useState` 控制 `ActionPalette` 显隐，通过 Context 暴露 toggle。

MVP 采用方案 A，便于后续与全局快捷键解耦。

## 4. 组件设计

### 4.1 `ActionMenuButton`

替换 TabBar 中现有 “+” 按钮：

- 外观保持不变（`tb-icon-btn w-6 h-6 rounded-md ...`）。
- `aria-haspopup="menu"`、`aria-expanded={open}`、`aria-label="New action"`。
- 点击切换下拉页显隐。

### 4.2 `ActionMenuDropdown`

- 绝对定位，锚定在按钮下方，使用 `floating-ui` 或原生 `getBoundingClientRect` 计算位置，避免超出视口。
- 背景 `bg-popover`，边框 `border border-border`，圆角 `rounded-md`，阴影 `shadow-xl`。
- 内部分组：
  - 顶部搜索框（sticky）。
  - `group === 'terminal'` 项，含 “New Terminal with Agent” 子展开。
  - `group === 'agent'` 项，渲染 `AgentBar` 复用组件。
  - `group === 'file'` 项，含最近文件列表。
  - `group === 'quick'` 项。
- 每个动作项使用 `ActionMenuItem`。

### 4.3 `ActionPalette`

- 基于 `@/ui/Dialog`（与 `QuickOpenPalette` 一致）。
- `max-w-[560px]`、`p-0`、`gap-0`、`overflow-hidden`。
- 顶部输入框 + 标题、中部结果列表、底部快捷键提示栏。
- 列表项高亮相同时使用 `bg-accent-blue/15`。

### 4.4 `ActionMenuItem`

```tsx
interface ActionMenuItemProps {
  item: ActionMenuItem;
  selected: boolean;
  onSelect: () => void;
  shortcut?: string;
}
```

- 左侧图标、中间 label/description、右侧快捷键。
- hover / selected 状态统一使用 `bg-bg-hover` / `bg-accent-blue/15`。
- disabled 时 `opacity-40 pointer-events-none`。

## 5. 与现有能力的集成

| 动作 | 调用路径 |
|------|---------|
| new-terminal | `useTerminalTabs.addTab(tabKey)` |
| new-terminal-with-agent | `useTerminalTabs.addTab(tabKey, agent.id, agent.name)` |
| new-file | 弹出路径输入 → 后端创建空文件 → `openProjectFile({ projectId, filePath })` |
| open-file | `useQuickOpenStore.getState().openPalette('gotoFile')` |
| recent-files | `openProjectFile({ projectId, filePath })` |
| open-side-terminal | 复用现有 `Ctrl+Alt+T` 的处理函数 |
| open-in-ide | 复用现有 `Ctrl+O` 的处理函数 |

### New File 后端依赖

当前 `write_file_content` 在 Local 模式下不会自动创建父目录（`src-tauri/src/common/file/services.rs:135-148`），而 WSL/Remote 已做 `mkdir -p`。实现 “New File” 需要统一行为，建议：

- 方案 A（推荐）：新增后端命令 `create_new_file(projectId, filePath)`，Local 下使用 `std::fs::create_dir_all` + `std::fs::write`，WSL/Remote 继续使用 shell `mkdir -p`。
- 方案 B：修改 `write_file_content` 在 Local 下也执行 `create_dir_all`，但会影响现有写入语义，风险较高。
- 方案 C：前端限制只能输入已存在目录下的文件路径，体验差。

MVP 采用方案 A。

## 6. 键盘与焦点管理

- 下拉页/面板打开时 `requestAnimationFrame` 聚焦搜索框。
- 使用 `roving tabindex` 或箭头键 + Enter 选择；Tab 可离开搜索框进入列表。
- 关闭时通过 `useRef` 保存触发按钮，焦点返回。
- 全局快捷键监听统一在 `useKeyboardShortcuts` 中添加 `Ctrl+Shift+A`。

## 7. 样式规范

- 使用 Tailwind v4 + CSS 变量，UI 文本使用 `text-[var(--font-size)]`。
- 浮层背景必须使用 `bg-popover`（`component-guidelines.md` 强制）。
- 图标统一使用 Lucide，尺寸 16px。
- 动画使用 `transition-colors duration-150`。

## 8. 关键文件变更规划

| 文件 | 变更 |
|------|------|
| `src/features/action-menu/` | 新增目录，含 types、hook、registry、组件 |
| `src/features/editor/components/TabBar.tsx` | “+” 按钮替换为 `ActionMenuButton` + `ActionMenuDropdown` |
| `src/app/components/ProjectWorkspace.tsx` | 注入 ActionContext、挂载 `ActionPalette`、注册全局快捷键 |
| `src/features/keyboard/useKeyboardShortcuts.ts` | 增加 `Ctrl+Shift+A` 打开命令面板 |
| `src/features/quick-open/quickOpenStore.ts` | 可能需要暴露 `openPalette('gotoFile')` |

## 9. 风险与回滚

- **风险**：`Ctrl+Shift+A` 与系统快捷键冲突。
  - 缓解：实现时检测并降级；配置化让用户可改键。
- **风险**：下拉页定位在窗口边缘被截断。
  - 缓解：使用 floating-ui 或手动边界检测。
- **风险**：与现有 `AgentSelector` 下拉菜单样式/行为不一致。
  - 缓解：复用 `AgentBar` 子组件，视觉风格统一为 `bg-popover`。
- **回滚**：保留原 `onAddTerminalTab` 调用链，若新菜单有 bug，可快速回滚到纯 “+” 按钮。
