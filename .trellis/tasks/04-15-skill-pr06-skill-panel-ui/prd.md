# PR#6: SkillsPanel 前端 UI（左侧栏面板）

## 概述

在左侧 ActivityBar 已预留的 "Skills" 面板入口中实现完整的 Skill 管理 UI。当前 AppLayout 中 `activePanel === "skills"` 没有渲染任何内容——本 PR 新增 `SkillsPanel` 组件填充该空位。

**关键：Skill 管理 UI 不在 SettingsPanel 中，而是作为左侧栏的独立面板**，与 ProjectsPanel、FilesPanel 并列。

## 组件化设计原则

> 本 PR 吸取 `ProjectsPanel` 的教训（47+ props prop-drilling），严格遵循以下架构原则：

### 低耦合策略

1. **专属 Context 封装**：Skill 模块拥有独立的 `SkillContext`，管理所有 Skill 领域状态和操作。SkillsPanel 只需要在顶层挂载 `<SkillProvider>`，子组件通过 `useSkillContext()` 自助获取所需数据——**不向子组件传递任何 Skill 业务 props**
2. **与宿主应用零耦合**：SkillsPanel 对外仅接收 `activeProjectId: string | null` 一个 prop（用于显示当前项目的 TagGroup 绑定）。所有 Skill 领域的 Tauri IPC 调用、状态管理、副作用处理完全自包含
3. **组件间通信通过 Context**：子组件之间不相互传递 props/callbacks。例如 `CreateTagGroupDialog` 不从 `TagGroupSection` 接收 `onCreate` 回调，而是通过 `useSkillContext().createTagGroup()` 直接调用
4. **UI 原子组件无业务逻辑**：`SkillCard`、`TagGroupCard` 等展示组件只接收展示数据 + 事件回调接口（薄 props），不包含 Tauri 调用或状态管理

### 高内聚策略

1. **按功能域而非技术层划分**：`components/skills/` 目录下的每个组件只负责一个功能子域（TagGroup 管理、Skill 列表、安装流程、工具开关）
2. **Hook 按职责拆分**：不使用一个巨型 `useSkills`，而是按职责分为：`useSkillData`（CRUD）、`useTagGroups`（标签组管理）、`useSkillInstall`（安装流程状态机）、`useToolStatus`（工具检测）
3. **对话框状态自管理**：`CreateTagGroupDialog`、`InstallSkillDialog` 等各自管理自己的表单 state、loading state、validation，不外泄给父组件

---

## 已有入口点

| 文件 | 位置 | 内容 |
|------|------|------|
| `src/context/sidebar-context.tsx:3` | `ActivityPanel` 类型 | 已包含 `"skills"` |
| `src/components/layout/ActivityBar.tsx:50` | navItems 数组 | 已有 `{ id: "skills", icon: <LibraryBig/>, title: "Skills" }` |
| `src/components/layout/AppLayout.tsx:147-200` | PanelArea children | **缺少** `activePanel === "skills"` 条件渲染块 |

## UI 框架

- React + Tailwind CSS v4 + ShadcnUI 风格组件
- 已有 shadcn 组件：`Button`, `Input`, `Textarea`, `Dialog`, `Select`, `DropdownMenu`, `Checkbox`, `Badge`, `Sidebar`, `MarkdownPreview`
- `cn()` 工具（clsx + tailwind-merge）、`cva` 变体管理

## 依赖

- PR#1~PR#5: 所有后端 Tauri 命令
- 已有 ShadcnUI 组件库

---

## 架构设计

### 模块边界图

```
┌─ AppLayout.tsx ─────────────────────────────────────────────────┐
│                                                                  │
│   {activePanel === "skills" && (                                │
│     <SkillProvider activeProjectId={activeProjectId}>           │
│       <SkillsPanel />     ← 唯一外部 prop: activeProjectId     │
│     </SkillProvider>                                            │
│   )}                                                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

┌─ SkillProvider (Context) ──────────────────────────┐
│                                                     │
│  State:  skills, tagGroups, tools, loading, error  │
│  Actions: CRUD、install、sync、tagGroup 操作         │
│  来源:   全部通过 Tauri invoke 自给自足              │
│                                                     │
│  子组件通过 useSkillContext() 获取所需切片           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 组件依赖关系（单向）

```
SkillsPanel (布局编排)
  ├── PanelHeader             纯展示 + DropdownMenu 触发
  ├── SearchBar               纯展示 + Input + 过滤回调
  ├── TagGroupSection         TagGroup 列表区域
  │    └── TagGroupCard       单个 TagGroup（纯展示 + 事件）
  ├── SkillListSection        Skill 列表区域
  │    └── SkillCard          单个 Skill（纯展示 + 事件）
  ├── ToolStatusSection       检测到的工具列表
  │    └── ToolToggleItem     单个工具开关（纯展示 + Checkbox）
  ├── CreateTagGroupDialog    创建标签组（自管理表单）
  ├── InstallSkillDialog      安装 Skill（自管理状态机）
  └── SkillDetailSheet        Skill 详情面板（自管理）
```

---

## 新增文件结构

```
src/
├── context/
│   └── skill-context.tsx           ← SkillProvider + useSkillContext
├── hooks/
│   ├── useSkillData.ts             ← Skill CRUD + 加载
│   ├── useTagGroups.ts             ← TagGroup CRUD + 排序
│   ├── useSkillInstall.ts          ← 安装流程状态机
│   └── useToolStatus.ts            ← 工具检测状态
├── components/
│   └── panels/
│       └── SkillsPanel.tsx         ← 面板主组件（布局编排，无业务逻辑）
│   └── skills/
│       ├── index.ts                ← barrel export
│       ├── PanelHeader.tsx         ← 标题栏 + 安装/扫描 DropdownMenu
│       ├── SearchBar.tsx           ← 搜索输入框（受控 Input）
│       ├── TagGroupSection.tsx     ← TagGroup 列表容器
│       ├── TagGroupCard.tsx        ← 单个 TagGroup 卡片（纯展示）
│       ├── SkillListSection.tsx    ← Skill 列表容器（含过滤逻辑）
│       ├── SkillCard.tsx           ← 单个 Skill 卡片（纯展示）
│       ├── ToolStatusSection.tsx   ← 检测工具列表
│       ├── ToolToggleItem.tsx      ← 单个工具开关行（纯展示）
│       ├── CreateTagGroupDialog.tsx← 创建标签组对话框（自管理）
│       ├── InstallSkillDialog.tsx  ← 安装 Skill 对话框（自管理）
│       └── SkillDetailSheet.tsx    ← Skill 详情侧滑面板（自管理）
```

---

## 详细设计

### 1. SkillContext（`src/context/skill-context.tsx`）

```typescript
interface SkillContextValue {
  // ── 只读状态 ──
  skills: SkillRecord[];
  tagGroups: TagGroup[];
  tools: ToolInfo[];
  loading: boolean;
  error: string | null;
  activeTagGroupId: string | null;
  searchQuery: string;
  selectedSkillId: string | null;
  activeProjectId: string | null;

  // ── Skill 操作 ──
  refreshSkills: () => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  viewSkillDetail: (id: string | null) => void;

  // ── TagGroup 操作 ──
  refreshTagGroups: () => Promise<void>;
  createTagGroup: (name: string, description?: string, icon?: string) => Promise<void>;
  updateTagGroup: (id: string, name: string, description?: string, icon?: string) => Promise<void>;
  deleteTagGroup: (id: string) => Promise<void>;
  setActiveTagGroupId: (id: string | null) => void;
  addSkillToTagGroup: (tagGroupId: string, skillId: string) => Promise<void>;
  removeSkillFromTagGroup: (tagGroupId: string, skillId: string) => Promise<void>;

  // ── 安装 ──
  installLocal: () => Promise<void>;
  installGit: (url: string, branch?: string, subpath?: string) => Promise<void>;
  scanSkills: () => Promise<void>;

  // ── Sync ──
  syncTagGroup: (tagGroupId: string) => Promise<void>;

  // ── 搜索 ──
  setSearchQuery: (q: string) => void;

  // ── 工具开关 ──
  setToolToggle: (tagGroupId: string, skillId: string, tool: string, enabled: boolean) => Promise<void>;
}
```

**SkillProvider** 内部组合 4 个子 hook：

```typescript
export function SkillProvider({ activeProjectId, children }: Props) {
  const skillData = useSkillData();
  const tagGroups = useTagGroups();
  const install = useSkillInstall(skillData.refreshSkills);
  const toolStatus = useToolStatus();

  // 组合成 SkillContextValue ...
  return <SkillContext.Provider value={value}>{children}</SkillContext.Provider>;
}
```

### 2. 子 Hook 职责划分

| Hook | 文件 | 职责 | 依赖 |
|------|------|------|------|
| `useSkillData` | `hooks/useSkillData.ts` | Skill 列表加载/删除/搜索过滤 | Tauri: `get_managed_skills`, `delete_managed_skill`, `get_skill_document` |
| `useTagGroups` | `hooks/useTagGroups.ts` | TagGroup CRUD + Skill-TagGroup 关联 | Tauri: `get_tag_groups`, `create_tag_group`, `add_skill_to_tag_group` 等 |
| `useSkillInstall` | `hooks/useSkillInstall.ts` | 安装状态机（idle→selecting→installing→done/error） | Tauri: `install_local_skill`, `install_git_skill`, `scan_local_skills` |
| `useToolStatus` | `hooks/useToolStatus.ts` | 工具检测 + 工具开关 | Tauri: `get_tool_status`, `set_skill_tool_toggle` |

每个 hook **只 invoke 自己领域的 Tauri 命令**，不越界调用。

### 3. AppLayout 集成点

```tsx
// AppLayout.tsx — 仅新增 3 行
import SkillsPanel from "../panels/SkillsPanel";

// 在 PanelArea children 中新增：
{activePanel === "skills" && (
  <SkillsPanel activeProjectId={props.activeProjectId} />
)}
```

### 4. SkillsPanel（纯布局编排组件）

```tsx
// panels/SkillsPanel.tsx
function SkillsPanel({ activeProjectId }: { activeProjectId: string | null }) {
  return (
    <SkillProvider activeProjectId={activeProjectId}>
      <div className="flex flex-col h-full">
        <PanelHeader />
        <SearchBar />
        <div className="flex-1 overflow-y-auto">
          <TagGroupSection />
          <SkillListSection />
          <ToolStatusSection />
        </div>
      </div>
      {/* 以下对话框自管理 open/close 状态，通过 Context 中的标志位触发 */}
      <CreateTagGroupDialog />
      <InstallSkillDialog />
      <SkillDetailSheet />
    </SkillProvider>
  );
}
```

**注意**：SkillsPanel **不传任何 props 给子组件**。每个子组件自己通过 `useSkillContext()` 获取数据和方法。

### 5. 展示组件 Props 接口（薄接口）

```typescript
// TagGroupCard — 纯展示，只接收展示数据 + 2 个事件
interface TagGroupCardProps {
  tagGroup: TagGroup;
  isActive: boolean;
  onSelect: () => void;
  onAction: (action: "edit" | "delete" | "sync") => void;
}

// SkillCard — 纯展示
interface SkillCardProps {
  skill: SkillRecord;
  isSelected: boolean;
  onSelect: () => void;
  onAction: (action: "detail" | "delete" | "update") => void;
}

// ToolToggleItem — 纯展示
interface ToolToggleItemProps {
  tool: ToolInfo;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}
```

### 6. 容器组件模式（Container → Presentation 分离）

```typescript
// TagGroupSection.tsx — 容器组件
function TagGroupSection() {
  const { tagGroups, activeTagGroupId, setActiveTagGroupId, deleteTagGroup, syncTagGroup } = useSkillContext();

  const handleAction = useCallback((tagGroup: TagGroup, action: string) => {
    switch (action) {
      case "delete": deleteTagGroup(tagGroup.id); break;
      case "sync": syncTagGroup(tagGroup.id); break;
      // ...
    }
  }, [deleteTagGroup, syncTagGroup]);

  return (
    <section>
      <SectionHeader title="Tag Groups" count={tagGroups.length} />
      {tagGroups.map(tg => (
        <TagGroupCard
          key={tg.id}
          tagGroup={tg}
          isActive={activeTagGroupId === tg.id}
          onSelect={() => setActiveTagGroupId(tg.id === activeTagGroupId ? null : tg.id)}
          onAction={(action) => handleAction(tg, action)}
        />
      ))}
    </section>
  );
}
```

### 7. 对话框自管理模式

```typescript
// CreateTagGroupDialog.tsx — 完全自包含
function CreateTagGroupDialog() {
  const { createTagGroup } = useSkillContext();
  const [open, setOpen] = useState(false);   // 自管理
  const [name, setName] = useState("");       // 自管理
  const [loading, setLoading] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await createTagGroup(name.trim());
      setName("");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }, [name, createTagGroup]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">+ New Group</Button>
      </DialogTrigger>
      <DialogContent>
        {/* 表单内容 */}
      </DialogContent>
    </Dialog>
  );
}
```

---

## SkillsPanel 布局

面板宽度共享 `--panel-width` (180-480px)，垂直滚动布局：

```
┌─────────────────────────────┐
│ Skills               [+ ▼] │  ← PanelHeader
├─────────────────────────────┤
│ 🔍 Search skills...        │  ← SearchBar
├─────────────────────────────┤  ← 以下区域统一 overflow-y-auto
│ TAG GROUPS            [+]   │  ← TagGroupSection header
│ ┌─ Default ──────── (5) ─┐ │
│ │ 📋                 ··· │ │  ← TagGroupCard
│ └────────────────────────┘ │
│ ┌─ 设计师 ──────── (3) ──┐ │
│ │ 🎨                 ··· │ │
│ └────────────────────────┘ │
│ ┌─ 后端架构师 ──── (4) ──┐ │
│ │ 🔧                 ··· │ │
│ └────────────────────────┘ │
├─────────────────────────────┤
│ SKILLS (5)                  │  ← SkillListSection header
│ ┌─ shadcn ─────────────┐  │
│ │ UI component patterns │  │  ← SkillCard
│ │ [git] [synced ✓]      │  │
│ └───────────────────────┘  │
│ ┌─ react-best-practices ┐  │
│ │ React optimization... │  │
│ │ [local] [—]           │  │
│ └───────────────────────┘  │
├─────────────────────────────┤
│ TOOLS                       │  ← ToolStatusSection header
│ ☑ Claude Code   ☑ Cursor   │  ← ToolToggleItem
│ ☐ Codex         ☑ OpenCode │
└─────────────────────────────┘
```

---

## 使用的 ShadcnUI 组件

| 组件 | 使用位置 |
|------|----------|
| `Button` | PanelHeader 操作按钮、TagGroupSection [+] 按钮、Dialog 提交/取消 |
| `Input` | SearchBar、InstallSkillDialog URL 输入、CreateTagGroupDialog 表单 |
| `Dialog` | CreateTagGroupDialog、InstallSkillDialog |
| `DropdownMenu` | PanelHeader 安装菜单、TagGroupCard/SkillCard 更多操作 |
| `Checkbox` | ToolToggleItem 工具开关 |
| `Badge` | SkillCard 来源类型（git/local）、同步状态 |
| `MarkdownPreview` | SkillDetailSheet SKILL.md 内容预览 |

---

## 验收标准

### 功能验收
- [ ] `AppLayout.tsx` 新增 `activePanel === "skills"` 渲染 SkillsPanel
- [ ] 点击 ActivityBar 的 Skills 图标正确展示面板
- [ ] Skill 列表正确从后端加载
- [ ] 搜索过滤功能正常（按名称/描述/标签）
- [ ] TagGroup 创建/删除/编辑功能正常
- [ ] Skill 添加到/移除 TagGroup 功能正常
- [ ] Install Skill 功能正常（本地目录/Git URL）
- [ ] Skill 详情面板展示 SKILL.md 内容
- [ ] 工具开关控制生效
- [ ] Sync 状态正确显示

### 架构验收
- [ ] SkillsPanel 对外仅接收 `activeProjectId` 一个 prop
- [ ] 所有子组件通过 `useSkillContext()` 获取数据，不接收业务 props
- [ ] 展示组件（SkillCard / TagGroupCard / ToolToggleItem）props ≤ 5 个
- [ ] 对话框组件自管理 open/表单/loading 状态
- [ ] 4 个子 hook 各自职责清晰，不越界调用 Tauri 命令
- [ ] 无 prop-drilling（Context 替代）
- [ ] Skill 模块可被整体移除而不影响 ProjectsPanel/FilesPanel

### 性能验收
- [ ] 所有容器/展示组件使用 `React.memo`
- [ ] 所有 Context 消费者使用 selector 或拆分 Context 避免不必要重渲染
- [ ] 事件处理函数使用 `useCallback`
- [ ] 列表过滤使用 `useMemo`

### 代码质量
- [ ] 使用已有 ShadcnUI 组件，不引入新 UI 依赖
- [ ] `npx tsc --noEmit` 通过
- [ ] Tailwind v4 样式，与现有主题一致
- [ ] barrel export（`components/skills/index.ts`）

---

## 不包含

- 不包含 Project 绑定标签组的 UI（PR#7 中在 SkillsPanel 顶部新增绑定区域）
- 不包含 Skill 执行能力（设计文档中的 SkillExecuteDialog，可未来扩展）
- 不包含拖拽排序（可未来 PR 添加 @dnd-kit）
- 不包含 Skill 市场浏览功能（可未来扩展）
