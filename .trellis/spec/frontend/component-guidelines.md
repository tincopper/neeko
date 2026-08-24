# 组件指南

> 本项目中组件的构建方式。

---

## 概述

组件使用 **React 18** + **TypeScript** 构建。大多数组件用 `React.memo` 包裹以优化性能。样式使用 **Tailwind CSS v4**（`src/tailwind.css`）——通过 `@theme` 映射 CSS 变量到 Tailwind 主题色。

---

## 组件结构

### 标准组件文件布局

```tsx
// 1. 导入
import React from "react";
import { listProjects } from "@/features/project/api/projectApi";  // 通过 API wrapper
import { SomeType } from "../types";

// 注意：不在组件中直接 import { invoke } from "@tauri-apps/api/core"
// 所有 IPC 调用通过 features/<domain>/api/<domain>Api.ts 封装

// 2. Props 接口（在同一文件中）
interface MyComponentProps {
  title: string;
  onAction: (id: string) => void;
  isActive?: boolean;
}

// 3. 组件定义
const MyComponent: React.FC<MyComponentProps> = ({ title, onAction, isActive = false }) => {
  // hooks、事件处理、渲染
  return <div className="my-component">...</div>;
};

// 4. 使用 memo 包裹并默认导出
export default React.memo(MyComponent);
```

### 两种可接受的组件声明模式

**模式 A —— `React.FC` + 箭头函数**（适用于小/中型组件，首选）：

```tsx
// src/components/layout/AgentIcon.tsx
interface AgentIconProps {
  icon?: string | null;
  size?: number;
  fallback?: string;
}

const AgentIcon: React.FC<AgentIconProps> = ({ icon, size = 16, fallback = "🤖" }) => {
  // ...
};

export default React.memo(AgentIcon);
```

**模式 B —— 具名函数**（用于较大的组件）：

```tsx
// src/components/layout/TitleBar.tsx
interface TitleBarProps {
  activeProject: Project | null;
  onOpenSettings: () => void;
  // ...
}

function TitleBar({ activeProject, onOpenSettings, ... }: TitleBarProps) {
  // ...
}

export default React.memo(TitleBar);
```

### 根组件 App（例外）

`App.tsx` 是唯一**不**用 `React.memo` 包裹的组件。当前职责是壳层编排，状态协调逻辑位于 `useAppContainer`。

---

## Props 约定

### 规则

1. **始终使用 `interface`** 定义 Props（不使用 `type` 别名）
2. **Props 接口定义在组件同一文件中**，紧邻组件上方
3. **回调 Props** 使用 `onXxx` 命名：`onSelectAgent`、`onToggleAddMenu`、`onAddProject`
4. **可选 Props** 使用 `?`，通过解构赋默认值
5. **领域模型类型** 从 `types.ts` 导入（`Project`、`AgentConfig` 等）

### 大型组件 Props 分组约定

当 Props 数量接近两位数时，优先按职责分组，避免继续扩张扁平接口：

```tsx
interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  actions: ProjectItemActions;
  viewConfig?: ProjectItemViewConfig;
}
```

分组建议：

1. `actions`：事件回调与命令式操作
2. `state`：仅当子组件需要外部状态快照时使用
3. `viewConfig`：样式、图标、可选 UI 配置

### 示例

```tsx
interface ProjectItemProps {
  project: Project;                           // 从 types.ts 导入
  isActive: boolean;                          // 组件特有的 prop
  onSelect: (id: string) => void;
  onRemove?: (id: string) => void;            // 可选回调
  collapsed?: boolean;                        // 可选，带默认值
}

const ProjectItem: React.FC<ProjectItemProps> = ({
  project,
  isActive,
  onSelect,
  onRemove,
  collapsed = false,
}) => { ... };
```

---

## 多 Tab 面板 + 内嵌现有组件模式

### 适用场景

新建统一面板需要整合多个资源域（如 Resource Library 整合 Skills / Prompts / Actions），且需要内嵌已有独立面板（如现有 `SkillsPanel`）作为其中一个 Tab 内容。

### 模式结构

```tsx
// LibraryPanel.tsx —— 壳层（v7 两栏 master-detail 布局）
const LibraryPanel: React.FC = React.memo(() => {
  const activeKind = useLibraryStore((s) => s.activeKind);
  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-bg-primary">
      <div className="flex-1 min-h-0 flex gap-0.5 p-0.5">
        <div className="flex flex-col shrink-0 w-60 rounded-lg shadow-sm bg-bg-secondary overflow-hidden">
          <LibraryActivityBar />   {/* 资源类型导航（Skills/Prompts/Actions/MCP/Commands） */}
          <LibraryNavTree />       {/* 按 activeKind 切换导航树 */}
        </div>
        <div className="flex-1 min-w-0 rounded-lg shadow-sm bg-bg-secondary overflow-hidden">
          <LibraryDetail />        {/* 工具栏 + 搜索 + 内容路由 */}
        </div>
      </div>
      <PromptEditorDialog />
      <PromptInsertDialog onInsert={handleInsert} />
      ...
    </div>
  );
});

// LibraryDetail.tsx —— 详情岛：面包屑 + 动作按钮 + 搜索 + 内容
const LibraryDetail: React.FC = React.memo(() => {
  return (
    <div className="flex flex-col h-full min-h-0">
      <LibraryToolbar />                          {/* 面包屑 + New/Import/Export */}
      <LibrarySearchBar value={searchQuery} onChange={setSearchQuery} ... />
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeKind === 'skill' && <SkillContent titleless />}
        {activeKind === 'prompt' && <PromptListSection onInsert={handleInsert} />}
        {activeKind === 'action' && <ActionsTabContent />}
        ...
      </div>
    </div>
  );
});

// SkillsTabContent.tsx —— 内嵌现有面板（列表岛 + 内容岛，不复制业务逻辑）
const SkillsTabContent: React.FC = React.memo(() => (
  <div className="flex h-full min-h-0 overflow-hidden gap-1">
    <div className="w-44 shrink-0 rounded-lg shadow-sm bg-bg-secondary overflow-hidden">
      <SkillsPanel />
    </div>
    <div className="flex-1 min-w-0 rounded-lg shadow-sm bg-bg-secondary overflow-hidden">
      <SkillContent />
    </div>
  </div>
));
```

### 关键规则

1. **壳层不重复实现业务逻辑**：内嵌 Tab 内容仅做透传，不复制内部逻辑
2. **状态隔离**：壳层 store 与内嵌面板的 store 独立，通过 props/context 通信
3. **Tab 切换不丢失内嵌面板状态**：用 CSS `display` 控制显隐，不要 unmount
4. **双视图模式**：网格/列表切换通过 `viewMode` 状态控制

### 示例

`features/library/components/LibraryPanel.tsx`（2026-07-29）

---

## 样式模式

### Tailwind CSS v4 + CSS 自定义属性

样式使用 **Tailwind CSS v4**，入口文件为 `src/tailwind.css`。CSS 自定义属性通过 `@theme` 块映射到 Tailwind 主题色：

```css
@theme {
  --color-primary: var(--bg-primary);
  --color-accent: var(--accent);
  --color-text: var(--text-primary);
}
```

### 实用类优先

组件内直接使用 Tailwind 实用类，不写自定义 CSS：

```tsx
<div className="flex items-center gap-2 px-3 py-1">
  <span className="text-sm text-accent">{name}</span>
  <button className="p-1 hover:bg-white/10 rounded">
    <Icon />
  </button>
</div>
```

### 动态类合并：`cn()`

需要条件组合类名时使用 `cn()`（`clsx` + `tailwind-merge`）：

```tsx
import { cn } from "../utils/cn";

<div className={cn(
  "flex items-center gap-1 px-2 py-0.5 rounded",
  isActive && "bg-accent/10",
  isDragging && "opacity-50 ring-2 ring-accent",
)} />
```

### 动态样式

仅在运行时需要计算的值仍使用内联 `style` 属性：

```tsx
<div style={{ display: isVisible ? "block" : "none" }}>
<img width={size} height={size} style={{ display: "inline-block", verticalAlign: "middle" }} />
```

### 复杂 CSS

无法用实用类表达的样式（`:has()` 选择器、伪元素 `::after`、动画、滚动条样式、xterm 终端覆盖等）保留在 `src/tailwind.css` 的 `@layer components` 中。

### Tauri 拖拽区域

可拖拽窗口的区域使用 `data-tauri-drag-region`：

```tsx
<div className="titlebar" data-tauri-drag-region>
```

---

## 拖拽排序模式（@dnd-kit）

项目列表拖拽排序使用 `@dnd-kit` 库实现。每个独立排序区域使用一个 `DndContext` + `SortableContext`，卡片组件内部使用 `useSortable` hook。

```tsx
// 父级容器（ProjectsPanel / WSLItem / RemoteItem）
<DndContext
  collisionDetection={closestCenter}
  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
  onDragEnd={(event) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onDragEnd(String(active.id), String(over.id));
    }
  }}
>
  <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
    {items.map(item => <SortableCard key={item.id} item={item} />)}
  </SortableContext>
</DndContext>
```

```tsx
// 可排序卡片（ProjectItem / ConnectionProjectCard）
const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
  useSortable({ id: item.id });

const style = {
  transform: CSS.Transform.toString(transform),
  transition: transition ?? undefined,
};

return (
  <div ref={setNodeRef} style={style} {...attributes} {...listeners}
    className={cn(
      "relative mb-0.5 rounded-md overflow-visible",
      isDragging && "opacity-50 scale-[1.02] shadow-lg shadow-black/20 z-50",
      !isDragging && "cursor-grab",
    )}
  >
    {children}
  </div>
);
```

**设计原则**：
1. **DndContext 按独立列表分布**：每个可排序区域独立，不支持跨区域拖拽
2. **Modifier 约束**：`restrictToVerticalAxis` 锁定垂直、`restrictToParentElement` 限定范围
3. **业务逻辑在域 hook**：DndContext.onDragEnd 只提取 id 并调用域 hook handler
4. **视觉反馈通过 isDragging**：使用 Tailwind class 切换 opacity/scale/shadow

详见 [交互模式指南](./interaction-patterns.md)。

---

## 展示组件 + 数据 adapter 跨域复用模式

当多个领域（local / WSL / SSH）需要同款视觉，但底层数据形态与 IPC 命令不同时，把视觉抽成纯展示组件，由各域调用方做 adapter（数据 normalize + 回调注入）。

**实例**：`ProjectGroup` + `SessionRow` + `SessionChips`（`src/components/project/`）三端共用，`ProjectItem`（local，`src/components/project/ProjectItem.tsx`）与 `ConnectionProjectCard`（wsl/remote，`src/components/connections/ConnectionProjectCard.tsx`）各自做 adapter。

**纯展示组件契约**：
1. 不直接 `invoke` Tauri 命令、不读写 store
2. 接收的 props 只有数据（值）+ 回调（函数）
3. 回调按语义命名（`onAddWorktree` 而非 `onPlusClick`）
4. `React.memo` 包装

**adapter 调用方契约**：
1. 数据 normalize：把领域模型映射成展示组件期望的 props（如把 `git_info.worktrees` 映射成 `SessionRow` 数组）
2. 回调注入：把领域 IPC 包装成展示组件期望的回调（如 `onAddWorktree = () => onOpenDialog("new-worktree", ...)`）
3. store 读写在 adapter 层完成（如 `aheadBehind` 用 `aheadBehindKey()` 查表）

**反模式**：让纯展示组件 import `invoke` 或 `useAppStore`——会立刻丧失三端复用能力，把 wsl/remote 路径推回写另一份并行实现。

**好坏对照**：

```tsx
// Wrong —— 展示组件直接读 store，硬编码 local key 形态
const SessionRow = ({ project }) => {
  const ahead = useAppStore((s) => s.aheadBehind[project.id]?.ahead);
  // wsl/remote 永远 lookup 失败
};
```

```tsx
// Correct —— 展示组件只接收数据
interface SessionRowProps {
  ahead?: number;
  changes?: { add: number; del: number };
}

// adapter（local）
<SessionRow
  ahead={
    useAppStore((s) => s.aheadBehind[aheadBehindKey("local", id, id)])?.ahead
  }
/>;
// adapter（wsl）
<SessionRow
  ahead={
    useAppStore((s) => s.aheadBehind[aheadBehindKey("wsl", distro, id)])?.ahead
  }
/>;
```

---

## 视觉层级：Section header vs Project header

侧边栏中两类容器有显著的语义差异，对应不同的视觉强度。

| 角色 | 强度 | 实例 | 关键样式 |
|------|------|------|----------|
| **Project header** | 强 | 单个项目卡（含 avatar + 名 + count + hover IDE/Git/Trash 槽） | `text-[var(--font-size)] font-semibold`、28×28 头像、行高 ≈ 40px |
| **Section header** | 弱 | WSL/SSH 外层 distro/server 分组 | `text-[10.5px] font-bold tracking-[0.16em] uppercase text-text-muted`、无头像、行高 ≈ 22px、hover 才显示 +/Trash |

**取舍准则**：
- 该层只是"分类容器、无独立操作"——用 section header
- 该层是"用户主要交互目标，含独立 CRUD"——用 project header
- 同屏避免出现两层强 header（视觉抢中心、识别成本高）

**实例参考**：
- Section header：`src/components/connections/RemoteItems.tsx` 的 `WSLItem` / `RemoteItem` 顶部
- Project header：`src/components/project/ProjectGroup.tsx`

---

## 大文本输出统一容器模式（OutputScroll）

**问题**：agent 工具输出（bash 命令输出、文件 diff 等）可能达数千行。直接 `<pre>` 渲染 + `white-space: pre-wrap` 会在长文本上产生严重卡顿（布局、换行、滚动全量）。

**解决方案**：统一封装 `OutputScroll`（`src/features/agent-chat/components/OutputScroll.tsx`），按行数分级：

| 行数 | 策略 |
|------|------|
| < `OUTPUT_VIRTUALIZE_THRESHOLD`(500) | 直接渲染（小文本零开销） |
| ≥ 500 | `@tanstack/react-virtual` 按行虚拟化（固定 `OUTPUT_LINE_HEIGHT`=20px、视口 `OUTPUT_VIEWPORT_HEIGHT`=320） |
| ≥ `OUTPUT_COLLAPSE_THRESHOLD`(1000) | 默认折叠 + 展开按钮（用户主动才渲染） |

**关键约定**：
1. 阈值/行高/视口导出为**模块级常量**（`OUTPUT_*`），测试按常量断言，禁止硬编码魔法数。
2. 虚拟化按固定行高计算（`rowVirtualizer` + `estimateSize: () => OUTPUT_LINE_HEIGHT`），jsdom 无 `getBoundingClientRect` 结果时用 `initialRect` 兜底，避免测试环境崩溃。
3. 大文本所有 `<pre>` 输出消费方（命令卡、文件卡、通用行）统一走 `OutputScroll`，不各自写 `<pre>` —— DRY。

> **测试要点**：边界行数必须精确覆盖（499 直渲 / 500 虚拟化、999 不折叠 / 1000 折叠）；断言语义而非字节（`toHaveTextContent`）。

## 分组渲染禁止二次分组（递归陷阱）

**问题**：工具行列表按「连续同类工具」分组折叠（如 `chunkToolGroups`）。若分组**展开**时递归渲染 `<WorkRows tools={group.tools} />`，组内 ≥2 个连续同类工具会再次被分组 → 无限递归，最终栈溢出崩溃。原有单组测试不覆盖「连续同类」场景，缺陷潜伏。

**正确做法**：分组内直接渲染**原始工具行**，绝不二次分组。抽离单行组件 `ToolRow`，分组展开与单工具路径共用：

```tsx
// Correct —— 单行组件 + 直接渲染原始行，不二次 chunk
function ToolRow({ tool, onOpenFile }) {
  if (tool.name === 'run_command' || tool.name === 'bash') return <CommandCard tool={tool} />;
  if (tool.name === 'read_file' || tool.name === 'edit_file' || tool.name === 'write_file')
    return <FileCard tool={tool} onOpenFile={onOpenFile} />;
  // ...
}
// 分组展开
<ToolGroupSummaryRow summary={group.summary} defaultOpen={group.hasRunning}>
  {group.tools.map((t) => <ToolRow key={t.callId} tool={t} onOpenFile={onOpenFile} />)}
</ToolGroupSummaryRow>
```

**检查清单**：
- [ ] 分组展开路径是否可能再次进入分组逻辑？
- [ ] 测试是否覆盖「≥2 连续同类工具」的分组场景？
- [ ] 分组内的回调（`onOpenFile` 等）是否透传？

## 回调透传链完整性

**问题**：容器给子组件注入回调（如 `onOpenFile`）时，若某一层子组件内部又渲染了同一消费组件（如 `WorkedCard` 内部渲染 `WorkRows`），遗漏透传会导致**同一类卡片在不同上下文表现不一致**（消息级可点、话轮摘要不可点），用户需求未完全打通。

**规则**：
1. 容器层回调下发给**所有**渲染该消费组件的路径（`WorkRows` 与 `WorkedCard` 内嵌的 `WorkRows` 都要传 `onOpenFile`）。
2. 中间层组件把回调列为**可选 props**（`onOpenFile?:`）并透传，消费方组件做**无回调回退**（如路径退化为不可点击 span），保持向后兼容。
3. 测试同时覆盖「消息级链路」与「内嵌上下文链路」两条透传路径。

---

## 即时保存 vs 显式 Save：两种"项目设置"语义

本仓库有两种"项目设置"入口，**语义截然不同**，新增字段时要选对位置或两者同步实现。

| 入口 | 文件 | 语义 | UX |
|------|------|------|-----|
| **全局 Settings → Project 子面板** | `src/components/settings/ProjectPanel.tsx` | **即时保存**：每个控件 onChange 立即 `invoke` + `patchProject` 更新 store；无 Save / Cancel 按钮 | 用户改一个字段→实时落盘+实时反映；适合"调试式探索" |
| **项目右键菜单 → Settings dialog** | `src/components/project/ProjectSettingsDialog.tsx` | **显式 Save / Cancel**：受控 state 暂存改动，Save 按钮一次性 invoke 多个 setter；Cancel 丢弃 | 用户可以试错；适合"提交式确认" |

### 选择规则

- **新增字段属于"反复调整、马上看效果"类型**（如颜色、Agent、IDE 选择）→ 优先放 ProjectPanel.tsx，即时保存
- **新增字段属于"批量决策、确认提交"类型**（如同时改名 + 切 IDE + 切 Agent）→ 优先放 dialog，受控 + Save
- **两类都需要** → 抽出共享子组件（如 `<AppearanceSwatches>`），ProjectPanel 直接渲染，Dialog 受控包一层

### 即时保存模式落地（ProjectPanel）

```tsx
// src/components/settings/ProjectPanel.tsx
import { setProjectColor } from "@/features/project/api/projectApi";

const handleAvatarColorChange = useCallback(
  (color: string | null) => {
    setProjectColor(projectId, color);  // 通过 API wrapper
    patchProject({ avatar_color: color }); // store 同步，避免等下一次 listen
  },
  [projectId, patchProject],
);
```

要点：
1. **没有受控 state**：直接读 `project.avatar_color`，写入即更新 store
2. **`patchProject` 立即同步 store**：避免依赖后端事件回流造成的 UI 滞后
3. **invoke 不 await**：与现有 `handleAgentChange` / `handleIdeChange` 风格一致；如果失败由 toast 在 store 同步层处理

### 显式 Save 模式落地（Dialog）

```tsx
// src/components/project/ProjectSettingsDialog.tsx
const [selectedAgentId, setSelectedAgentId] = useState<string | null>(currentAgent);
const [selectedIdeId, setSelectedIdeId] = useState<string | null>(null);

const handleSave = useCallback(async () => {
  await setProjectAgent(projectId, selectedAgentId);
  await setProjectIde(projectId, ideCommand);
  onSave(selectedAgentId, ideCommand);
  onClose();
}, [...]);
```

要点：
1. **受控 state 暂存所有字段**，不实时同步
2. **Save 按钮一次性提交**多个 invoke
3. **Cancel 直接 onClose** 即丢弃

### 反模式

❌ **在 ProjectPanel 里加 Save 按钮**：与既有 Agent / IDE / Tasks 即时保存模式冲突，用户体验割裂

❌ **在 Dialog 里某个字段即时保存、其他字段需要 Save**：用户认知负担极高，"为什么这个字段我点了就生效，那个字段非要 Save"

❌ **新增字段时同时 patch 两边但语义不一致**：参考 `avatar_color` 任务的修正——上轮把 Appearance 加到了 Dialog（错），用户期望在 Settings 子面板（对），最终 Dialog 完全还原、Appearance 只在 ProjectPanel

### 检查清单

- [ ] 该字段属于即时调整还是批量提交？
- [ ] 与该入口已有字段的保存语义一致？
- [ ] 如两边都要支持，是否抽出了共享子组件？

---

## Props 塌缩约定：优先从 Context/Store 获取数据

### 核心原则

当组件需要的数据已在 Context 或 Store 中可用时，**不应通过 Props 传递**。按以下优先级获取：

1. **领域 Context**：`useEditorContext()`、`useWslContext()`、`useRemoteContext()` 等
2. **全局 Context**：`useAppContext()` — 配置、toast
3. **Store 快照**：`useAppStore(s => s.field)` — 带 memo 的响应式
4. **Store 门面**：`useAppStore.getState()` — 一次性读取，用于事件回调
5. **领域 Hook**：`useEditorGroupLayout(tabKey)` 等

### Props 塌缩步骤

```tsx
// Before（Prop 缠绕）
<EditorGroupLayout
  agents={agents}
  config={config}
  showToast={showToast}
  ...
/>
  └─ <EditorGroupPane
        agents={agents}
        config={config}
        showToast={showToast}
        onActivateTab={handleActivateTab}
        ...
      />

// After（直接读取 Context/Store）
// ProjectWorkspace 不再传递 agents/config/showToast
<EditorGroupLayout ... />
  └─ <EditorGroupPane ... />  // 内部调用 useEditorContext() / useAppContext()

// Pane 内部
const { agents } = useEditorContext();
const { config, showToast } = useAppContext();
const store = useAppStore.getState();
store.activateTab(tabKey, tabId);  // 代替 onActivateTab prop
```

### 保留哪些 Props

塌缩后保留的 Props 通常属于：
- **实例差异**：`groupId`、`layoutId`、`wslProject`、`remoteProject`
- **布局级回调**：`onSplitRight`、`onMoveToRight`、`onMoveToLeft`、`onFocusGroup`
- **扩展点**：`contextMenuExtras`

### 示例：EditorGroupPane 塌缩

| Props 原数量 | 塌缩后 | 移除了什么 |
|-------------|--------|-----------|
| 30+ | ~13 | `tabKey`, `tabs`, `activeTabId`, `pinnedTabId`, `isFocused`, `onActivateTab`, `onCloseTab`, `agents`, `compactMode`, `showAgentBar`, `hiddenAgentIds`, `onToggleHiddenAgent`, `onAgentClick`, `config`, `showToast` |

删除路径：`EditorGroupPaneProps` → `EditorGroupLayoutProps` → `sharedPaneProps` → `ProjectWorkspace` JSX。每一层都同步删除。



**错误做法** —— `TitleBar.tsx` 局部重新声明自己的 `Project` 和 `AgentConfig` 接口：

```tsx
// 不要这样做：重新声明 types.ts 中已有的类型
interface Project {
  id: string;
  name: string;
  // ... 真实类型的部分拷贝
}
```

**正确做法** —— 从 `types.ts` 导入：

```tsx
import { Project, AgentConfig } from "../../types";
```

### 2. 忘记使用 `React.memo`

除 `App.tsx` 外的所有组件都应使用 `React.memo` 导出，以避免在 Props 与 Context 混合分发架构中的不必要重渲染。

### 3. 在 JSX 中内联 SVG 图标

项目中将小型 SVG 图标直接嵌入 JSX（参见 `TitleBar.tsx`）。对于简单图标这是可接受的。对于可复用的图标，考虑提取为独立组件或资源文件。

### 4. 字体大小使用硬编码 Tailwind 类

**错误做法** —— 在侧边栏、文件树、Tab 等 UI 元素中使用 `text-xs`、`text-sm` 等固定类：

```tsx
// 不要这样做：硬编码字体大小，无法响应用户设置
<span className="text-sm font-semibold">{project.name}</span>
<div className="text-xs cursor-pointer">{fileName}</div>
```

**正确做法** —— 使用 CSS 变量，确保元素跟随用户在 Settings 中的字体大小设置：

```tsx
// UI 元素（侧边栏、文件树、Tab 标签等）→ --font-size（由 appearanceFontSize 驱动）
<span className="text-[var(--font-size)] font-semibold">{project.name}</span>

// 终端区域元素（终端 Tab、Agent 按钮等）→ --terminal-font-size（由 terminalFontSize 驱动）
<span style={{ fontSize: "var(--terminal-font-size)" }}>{tabTitle}</span>
```

---

## CSS 字体大小变量规范

项目使用三套独立的字体大小配置，均由用户在 Settings → Appearance/Editor/Terminal 中调整：

| CSS 变量 | 默认值 | 驱动字段 | 适用范围 |
|----------|--------|---------|---------|
| `--font-size` | `12px` | `config.appearanceFontSize` | 侧边栏项目名、文件树、Tab 标签、TitleBar 等所有 UI 文本 |
| `--terminal-font-size` | `14px` | `config.terminalFontSize` | 终端 Tab、Agent 按钮列表、终端相关 UI |
| （直接传 prop）| `14px` | `config.editorFontSize` | CodeMirror 编辑器，通过 `editorFontSize` prop 传入 `FileViewer` |

**使用原则**：
- Tailwind 类语法（推荐用于静态文本）：`className="text-[var(--font-size)]"`
- 内联 style（用于动态或按钮元素）：`style={{ fontSize: "var(--terminal-font-size)" }}`
- 新增任何侧边栏/文件树/Tab 组件时，**禁止**使用 `text-xs`、`text-sm`、`text-base` 等固定 Tailwind 字体类


---

## 确认弹窗规范：ConfirmDialog

### 约定

所有删除/危险操作的二次确认弹窗，使用 `src/shared/components/ConfirmDialog.tsx`。

基于 Radix UI `Dialog` + `Button` 原语，自动处理遮罩层、ESC 关闭、键盘焦点管理、dark theme 样式。

### Props

```ts
interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  danger?: boolean;
}
```

### 使用方式

```tsx
import ConfirmDialog from "@/shared/components/ConfirmDialog";

const [confirmRemove, setConfirmRemove] = useState(false);

<ConfirmDialog
  open={confirmRemove}
  onOpenChange={setConfirmRemove}
  title="Remove Project"
  description={
    <>
      <p>Are you sure you want to remove <strong>{project.name}</strong>?</p>
      <div>{project.path}</div>
    </>
  }
  confirmLabel="Remove"
  onConfirm={() => onRemoveProject(project.id)}
  danger
/>
```

- `description` 接受 `ReactNode`，可传入条件内容（如 Worktree 删除时的 `isDirty` 警告）
- `danger` 为 `true` 时确认按钮使用 `variant="destructive"`（红色背景）
- 确认按钮文案通过 `confirmLabel` 自定义（如 Worktree 的 "Force Remove" / "Remove"）

### 反模式

❌ **使用裸 `<div className="modal-overlay"> 模拟弹窗**：

```tsx
// 禁止：这些 class 在项目 CSS 中没有定义，无任何样式
{confirmDelete && (
  <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      ...
    </div>
  </div>
)}
```

✅ **使用 ConfirmDialog**：见上方使用方式。

---

## 浮层面板背景色：使用 `bg-popover` 而非 `bg-surface`

### 规则

所有浮层面板（dropdown、popover、portal、toast）必须使用 `bg-popover` 作为背景色，由 shadcn 主题映射到 `var(--bg-secondary)`。

`bg-surface` **不存在于 Tailwind CSS v4 主题中**，使用它会导致背景完全透明。

### 正确

```tsx
<div className="bg-popover border border-border rounded-md shadow-lg">
```

### 错误

```tsx
<div className="bg-surface border border-border rounded-md shadow-lg">
```

---

## Tabbed Shell Component 模式（合并 Dock 面板）

### 背景

当多个紧密关联的 Dock 面板（如 gitCommit + gitLog）需要合并为一个面板以节省 Dock 插槽时，使用 Shell 组件 + 内部 Tab 切换模式。

### 架构

```
GitControlPanelWrapper（app/dock/wrappers/，薄适配层）
├── useActiveProject() / useDockStore(isActive)   ← dock/上下文适配
├── useRefreshGitInfo()                            ← git info 刷新编排（feature hook）
└── GitControlPanel (feature 容器，owns 数据 hooks)
    ├── tab state ('changes' | 'history' | 'stash')
    ├── useGitLog(commands, active && tab==='history')   ← 激活门控
    ├── useStashList(commands, active)                   ← 徽章计数
    ├── useSingletonDiff / useCommitDetail / useOpenStashDiff / useOpenDiffTab
    ├── useGitLogKeyboardNav({ enabled: tab==='history' })
    ├── TabBar (Changes | History | Stash) + badge
    ├── GitCommitPanel       ← hidden={tab !== 'changes'} 保持挂载
    ├── GitLogPanel          ← hidden={tab !== 'history'}
    └── StashPanel           ← hidden={tab !== 'stash'}
```

### 关键约定

1. **两个面板同时挂载**：使用 `hidden` 而非条件渲染，避免切换 Tab 时丢失提交表单等草稿状态
2. **数据 hooks 内聚在 Shell 组件（feature 容器）**：wrapper 只做 dock/上下文适配（isActive 门控、project 视图转换），不持有业务编排
3. **激活门控**：`useGitLog` / `useStashList` 带 `enabled` 参数，面板/tab 不可见时不发起 IPC；数据在切换间保留
4. **Tab 默认值为 `'changes'`**（操作频率更高的面板在前）
5. **刷新联动**：GitControlPanel 组合 `onRefreshGit`（wrapper）+ log `refresh()`，commit 后切换 History 能看到新 commit

### 完成示例

```tsx
// src/app/dock/wrappers/GitControlPanelWrapper.tsx（薄适配层）
const GitControlPanelWrapper: React.FC = React.memo(() => {
  const { project, commands, capabilities, connectionContext } = useActiveProject();
  const isPanelActive = useDockStore(/* gitControl 激活且展开 */);
  const refreshGit = useRefreshGitInfo(project, commands, connectionContext);

  return (
    <GitControlPanel
      project={effectiveProject}
      commands={commands}
      capabilities={capabilities}
      connectionContext={connectionContext}
      active={isPanelActive}
      onRefreshGit={handleRefreshGit}
      ...
    />
  );

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (tab !== 'history') return;
    const target = e.target as HTMLElement;
    if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    // J/K/j/k/c shortcuts...
  }, [tab]);

  return <GitControlPanel tab={tab} onTabChange={setTab} ... />;
};
```

```tsx
// src/features/git/components/GitControlPanel.tsx
const GitControlPanel: React.FC<Props> = ({ tab, onTabChange, ... }) => {
  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-border">
        <button onClick={() => onTabChange('changes')}>Changes</button>
        <button onClick={() => onTabChange('history')}>History</button>
      </div>
      <div hidden={tab !== 'changes'} className="flex-1 overflow-auto">
        <GitCommitPanel ... />
      </div>
      <div hidden={tab !== 'history'} className="flex-1 overflow-auto">
        <GitLogPanel ... />
      </div>
    </div>
  );
};
```

### 反模式

❌ 条件渲染（非挂载）：

```tsx
// 切换 Tab → 组件 unmount → 草稿全部丢失
{tab === 'changes' && <GitCommitPanel />}
{tab === 'history' && <GitLogPanel />}
```

❌ 每个面板各自调用 `useActiveProject()`：造成两次重复的 IPC 订阅和状态同步

---

## Zustand + `useSyncExternalStore`：`useShallow` 用于派生数组

### 规则

zustand v5 底层使用 `useSyncExternalStore`，store selector 返回的引用必须稳定。调用 `.slice()`、`.filter()`、`.map()` 等方法时每次都返回新引用，会导致无限重渲染。

使用 `zustand/shallow` 的 `useShallow` 做浅比较：

### 错误

```tsx
// .slice() 每次返回新数组 → 无限重渲染
const items = useStore((s) => s.list.slice(0, 10));
```

### 正确

```tsx
import { useShallow } from 'zustand/shallow';

const items = useStore(
  useShallow((s) => s.list.slice(0, 10)),
);
```
## Worktree-Aware 展示组件模式

### 背景

当用户在 worktree 终端中工作时，多个 UI 组件需要感知当前激活的 worktree 并调整其展示与交互行为。核心原则：**worktree 是只读上下文**——展示 worktree 自身的分支名，但禁止分支切换操作。

### 状态读取

使用 `useWorktreeStore` 读取当前激活的 worktree 状态：

```tsx
import { useWorktreeStore } from '@/shared/store/worktreeStore';

const activeWorktreePath = useWorktreeStore((s) => s.activeWorktreePath);
const activeWorktreeBranch = useWorktreeStore((s) => s.activeWorktreeBranch);
const isWorktreeActive = activeWorktreePath !== null;
```

### 展示覆盖模式

当 worktree 激活时，展示组件应显示 worktree 的分支名而非主项目的分支名：

```tsx
// 正确：根据 worktree 状态决定展示内容
const displayBranch = isWorktreeActive ? activeWorktreeBranch : currentBranch;
```

### 交互禁用模式

当 worktree 激活时，分支切换功能必须完全禁用：

```tsx
// 正确：worktree 状态下禁用面板切换
const handleTogglePanel = useCallback(() => {
  if (isWorktreeActive) return;
  setPanelOpen((v) => !v);
}, [isWorktreeActive]);
```

### 视觉反馈

worktree 激活时，组件应提供明确的视觉反馈表明当前处于只读状态：

```tsx
<button
  className={cn(
    'flex items-center gap-1 hover:text-text-primary cursor-pointer transition-colors',
    isWorktreeActive && 'opacity-70 cursor-default',
  )}
  title={
    isWorktreeActive
      ? `Worktree branch: ${displayBranch} (read-only)`
      : `Current branch: ${displayBranch}`
  }
>
```

要点：
1. **opacity-70**：降低透明度表明非主上下文
2. **cursor-default**：移除可点击手势
3. **title 提示**：明确告知用户当前是 worktree 分支且只读

### 实例参考

| 组件 | 文件 | 行为 |
|------|------|------|
| BranchStatusBarWidget | `src/features/git/components/BranchStatusBarWidget.tsx` | 展示 worktree 分支名，禁用分支切换面板 |

### 反模式

❌ 组件直接读取 `gitInfo.current_branch` 而不检查 worktree 状态：

```tsx
// 错误：始终显示主项目分支，忽略 worktree
const branch = gitInfo?.current_branch ?? '';
```

❌ worktree 激活时仍允许分支切换：

```tsx
// 错误：未在 worktree 状态下禁用交互
const handleTogglePanel = useCallback(() => {
  setPanelOpen((v) => !v);
}, []);
```

❌ 为 worktree 新建独立组件而非复用现有组件：

```tsx
// 错误：复制一份 worktree 专用组件
const WorktreeBranchStatusBarWidget = () => { ... };
```
