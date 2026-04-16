# PR#9: Local Skill Panel — three-column layout + local skill management

## 概述

重构 Skill 管理 UI 为三栏布局，完善本地 Skill 管理功能：展示已安装 skill 列表、本地文件夹安装、扫描导入、创建新 Skill（含 Markdown 编辑器）。

## 依赖

- PR#8: 命令注册修复（确保前端可调用后端）

## 参考项目

- `skills-manager/src/views/MySkills.tsx` — Skill 列表 + 操作
- `skills-manager/src/views/InstallSkills.tsx` — Local tab 安装流程

## 需求

### 1. 三栏布局

将 Skill 管理从 PanelArea 单一展示改为三栏结构：

```
ActivityBar(48px) | SkillsPanel(导航菜单) | SkillContent(内容展示)
```

- **SkillsPanel**（PanelArea 中）：纯导航菜单，不放内容
- **SkillContent**（替换 MainContent）：内容展示区，按选中菜单项路由
- 当 `activePanel === "skills"` 时，MainContent 隐藏，SkillContent 替代

#### 布局实现

```tsx
// AppLayout.tsx
{skillsActive ? (
  <SkillProvider activeProjectId={props.activeProjectId}>
    <PanelArea>
      <SkillsPanel />          {/* 导航菜单 */}
    </PanelArea>
    <SkillContent />            {/* 内容区，替换 MainContent */}
  </SkillProvider>
) : (
  <>
    <PanelArea> ... </PanelArea>
    <MainContent ... />
  </>
)}
```

### 2. SkillsPanel — 导航菜单

左侧 PanelArea 中的功能选项列表：

```
┌──────────────────────┐
│ Skills               │
├──────────────────────┤
│ 📦 Local Skills  (5) │  ← 激活高亮
│ 🏪 Marketplace       │
│ 📂 Project Skills    │
│ 🔧 Tool Status       │
├──────────────────────┤
│ Tag Groups           │
│  📋 Default     (3)  │
│  🎨 Designer    (2)  │
└──────────────────────┘
```

- 4 个导航项，点击切换 `activeSkillView`
- Tag Groups 折叠区，点击绑定 `activeTagGroupId`
- 使用 lucide-react 图标：Package / Store / FolderOpen / Wrench

### 3. SkillContent — 内容路由

主内容区组件，按 `activeSkillView` 渲染对应视图：

| 菜单项 | 路由值 | 内容 |
|--------|--------|------|
| Local Skills | `local` | Skill 列表 + 安装/扫描/创建 |
| Marketplace | `marketplace` | 占位（后续 PR） |
| Project Skills | `project` | 占位（后续 PR） |
| Tool Status | `tools` | 工具安装状态网格 |

### 4. Local Skill Tab 内容

```
┌─────────────────────────────────────────────────────┐
│ Local Skills          [+ Create] [Install] [Scan]   │
├─────────────────────────────────────────────────────┤
│ 🔍 Search skills...                                 │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ 📦 skill-name                       [local]     │ │
│ │ Description text...                             │ │
│ │ Tags: #tag1 #tag2                        [🗑️]  │ │
│ └─────────────────────────────────────────────────┘ │
│ ...                                                 │
└─────────────────────────────────────────────────────┘
```

#### 功能：

1. **Skill 列表**
   - 从 `get_managed_skills` 加载所有已安装 skill
   - 按 name 搜索过滤
   - 每个 SkillCard 展示：name, source_type badge, description, tags

2. **创建 Skill（+ Create 按钮）**
   - 点击打开 Slide-over 创建面板
   - Name 输入框（自动填充 SKILL.md 模板）
   - CodeMirror Markdown 编辑器（直接编辑 SKILL.md 内容）
   - 复用 `getCmFontStyle` 获取完整主题样式
   - 调用 `create_skill(name, skill_content)` 后端命令
   - 后端自动解析 frontmatter 提取 description

3. **安装本地 Skill（Install 按钮）**
   - 点击弹出 Tauri 目录选择对话框
   - 选择目录后调用 `install_local_skill(source_path)`
   - 安装成功后刷新列表

4. **扫描已有 Skill（Scan 按钮）**
   - 调用 `scan_local_skills()` 扫描 Agent 工具目录
   - 导入发现的 unmanaged skill
   - 导入后刷新列表

5. **删除 Skill**
   - SkillCard 上的删除按钮
   - 调用 `delete_managed_skill(skill_id)`
   - 删除后刷新列表

### 5. MarkdownEditor 组件

独立的 CodeMirror markdown 编辑器，不依赖任何业务逻辑：

```tsx
// src/components/skills/MarkdownEditor.tsx
interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}
```

- 使用 `getCmFontStyle(fontFamily, editorFontSize)` — 和 FileViewer 完全一致的 CSS 变量主题
- `@codemirror/lang-markdown` 语法支持
- `oneDark` 语法高亮（仅 dark 主题）
- 从 `useAppContext()` 获取主题/字体/字号配置

### 6. Skill Context 扩展

新增状态和方法：

```typescript
interface SkillContextValue {
  // 新增
  activeSkillView: SkillView;       // "local" | "marketplace" | "project" | "tools"
  setActiveSkillView: (view: SkillView) => void;
  createSkill: (name: string, skillContent: string) => Promise<void>;
  // ... 其余不变
}
```

### 7. 后端 create_skill 命令

```rust
#[tauri::command]
pub async fn create_skill(
    name: String,
    skill_content: String,   // 完整 SKILL.md 内容（含 frontmatter）
    store: State<'_, Arc<SkillStore>>,
) -> Result<ManagedSkillDtoOut, String>
```

流程：
1. `sanitize_skill_name(name)` 验证名称
2. 创建 `~/.neeko/skills/{name}/` 目录
3. 写入 `skill_content` 为 SKILL.md
4. `parse_skill_md` 解析 frontmatter 提取 description
5. 计算 content_hash
6. 写入 skills 表（source_type: "local"）

## 文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/types.ts` | 修改 | 新增 `SkillView` 类型 |
| `src/context/skill-context.tsx` | 修改 | 新增 `activeSkillView` / `setActiveSkillView` / `createSkill` |
| `src/components/panels/SkillsPanel.tsx` | 重构 | 从内容展示改为导航菜单 |
| `src/components/layout/AppLayout.tsx` | 修改 | 三栏布局 + SkillProvider 提升 |
| `src/components/skills/SkillContent.tsx` | 新增 | 内容路由组件 |
| `src/components/skills/LocalSkillContent.tsx` | 新增 | 本地 Skill 列表视图 |
| `src/components/skills/MarketplaceContent.tsx` | 新增 | Marketplace 占位 |
| `src/components/skills/ProjectSkillContent.tsx` | 新增 | Project Skill 占位 |
| `src/components/skills/ToolStatusContent.tsx` | 新增 | 工具状态视图 |
| `src/components/skills/CreateSkillDialog.tsx` | 新增 | Slide-over 创建面板（Name + Markdown 编辑器） |
| `src/components/skills/MarkdownEditor.tsx` | 新增 | 独立 CodeMirror markdown 编辑器 |
| `src/hooks/useSkillInstall.ts` | 修改 | 新增 `createSkill` 方法 |
| `src-tauri/src/skill/commands.rs` | 修改 | 新增 `create_skill` 命令 |
| `src-tauri/src/lib.rs` | 修改 | 注册 `create_skill` 命令 |

## 验收标准

- [x] 三栏布局：ActivityBar | SkillsPanel(导航) | SkillContent(内容)
- [x] SkillsPanel 为导航菜单，不展示内容
- [x] Local Skills 列表展示已安装 skill
- [x] 搜索过滤功能正常
- [x] "Create" 按钮打开 Slide-over + CodeMirror 编辑器
- [x] "Install" 按钮能选择目录并安装
- [x] "Scan" 按钮能发现未管理的 skill
- [x] 删除 skill 功能正常
- [x] 所有操作后列表自动刷新
- [x] `cargo check` + `npx tsc --noEmit` 通过
- [x] 编辑器样式跟随应用主题（CSS 变量）

## 不包含

- Marketplace 浏览/安装（PR#12-13）
- Project Skill 绑定（PR#14）
- Skill Detail 详情面板（PR#10）
- Tag Group 管理 UI（PR#11）