# 资源库管理设计方案（参考 vb.do/library）

> 状态：设计草案（Design Draft）  
> 任务：`07-29-resource-library`（资源库管理动作）  
> 目标：在 Neeko 现有 Skill / Action 体系上，落地「资源库」统一管理能力，并通过 Action Palette 提供一等入口。  
> 参考：[vb.do Library](https://vb.do/library)（Themes / Prompts / Media）  
> 原型：同目录 `prototypes/resource-library.html`

---

## 0. 背景与问题

### 0.1 vb.do Library 可借鉴点

根据 [vb.do/llms.txt](https://vb.do/llms.txt) 与 `/library` 公开结构：

| 分区 | 用途 | 关键动作 |
|------|------|----------|
| **Themes** | 可复用主题/设计提示 | 创建、浏览、应用到 App |
| **Prompts** | 可复用任务提示（支持 slash 命令） | 创建、搜索、插入对话 |
| **Media** | 从 App 提取的媒体资产 | 自动收集、复用 |

共性交互：

1. **统一 Library 壳** + 分类 Tab  
2. **空状态引导创建**（Create reusable …）  
3. **资源即资产**：跨项目复用，而不是一次性会话内容  
4. **使用路径短**：从库 → 一键应用 / 插入 / 安装

### 0.2 Neeko 现状（可复用能力）

| 能力 | 位置 | 成熟度 |
|------|------|--------|
| Skill 中央库 + 标签组 | `features/skill`、`src-tauri/src/skill` | 已较完整 |
| Marketplace（skills.sh） | `MarketplaceContent` | 已可用 |
| Agent / Project 绑定与同步 | tag group + symlink/copy | 已可用 |
| Action Palette | `features/action-menu` | 仅少量静态 action |
| Theme 功能域 | `features/theme` | 独立，未入库 |
| Dock 面板 | `skills` panel | 已有 Library 视图名 |

**缺口：**

1. 「资源」仅覆盖 Skill，缺少 Prompt / Action 模板 / 媒体类统一模型  
2. Action Palette 不能发现、搜索、执行库内资源  
3. 没有「从使用中沉淀资源」（Save as Prompt / Save as Skill）闭环  
4. Library 与 Marketplace 概念混在 Skills 面板中，扩展第三类资源会更挤

### 0.3 设计目标

在 **不推翻现有 Skill 系统** 的前提下：

1. 引入 **Resource Library** 统一壳（分类 + 搜索 + CRUD + 使用）  
2. 新增 **资源库管理 Action**（Command Palette / 快捷键 / Dock）  
3. MVP 优先打通 **Skills + Prompts**；Themes/Media 预留扩展  
4. 资源可被 **Action 执行链** 消费（插入 Agent、绑定项目、打开面板）

### 0.4 关键决策（已确认）

| # | 问题 | 决策 |
|---|------|------|
| 1 | Dock 面板 ID | **新建 `panelId: library`**，旧 `skills` 保留但不再作为主入口 |
| 2 | Prompt slash | **MVP 即支持**（如 `/review`） |
| 3 | Insert 目标 | **Agent 输入为主**，终端 PTY 也支持 |
| 4 | 项目级覆盖 | **项目级优先级更高**，同名 slash 项目覆盖全局 |
| 5 | 视图模式 | **网格 + 列表双视图**，用户可切换 |

---

## 1. 产品定位

**一句话：**  
Neeko 资源库 = 本地优先的「可复用 AI 工作资产中心」，管理 Skill / Prompt / Action 模板，并可通过 Action 一键使用。

与 vb.do 的映射（Neeko 语义）：

| vb.do | Neeko 资源类型 | 说明 |
|-------|----------------|------|
| Themes | `theme`（P2） | 主题/外观预设；可后接 `features/theme` |
| Prompts | `prompt`（P0） | 可复用提示词 / slash 命令 / 任务起手式 |
| Media | `media`（P3） | 截图、图标、附件；桌面端优先级低 |
| （Neeko 自有） | `skill`（P0） | 现有 Skill 中央库，一等公民 |
| （Neeko 自有） | `action`（P1） | 命令模板 / 工作流动作，供 Palette 与终端执行 |

---

## 2. 用户故事与范围

### 2.1 MVP（P0）

1. 作为用户，我可以从 Action Palette 执行 **「Open Resource Library」** 打开新 `panelId: library` 面板  
2. 作为用户，我可以在 Library 中切换 **Skills / Prompts / Actions** 三个分类  
3. 作为用户，我可以 **创建 / 编辑 / 删除 / 搜索 / 标签过滤** Prompt  
4. 作为用户，Prompt 支持 **slash 命令**（如 `/review`），项目级覆盖全局同名  
5. 作为用户，我可以把 Prompt **插入当前 Agent 输入**（主）或 **终端 PTY**（次）  
6. 作为用户，Skills 分类复用现有 Library 能力（不重写安装/同步）  
7. 作为用户，我可以把一次对话/命令 **Save as Prompt**  
8. 作为用户，我可以在 **网格 / 列表** 双视图间切换  

### 2.2 近期待办（P1）

1. Action 模板入库，并出现在 Action Palette 动态区  
2. Prompt 变量填充（`{{branch}}` + 上下文自动填充）  
3. 资源导入/导出（JSON bundle）

### 2.3 明确不做（MVP）

- 云端同步 / 账号体系  
- 完整 Media 资产库  
- 远程 Marketplace 卖 Prompt（仅本地 + 可选 git 源）  
- 替换现有 skills.sh 市场（仍挂在 Skills 子视图）

---

## 3. 信息架构

```
Dock / Action
└── Resource Library（统一面板，可替换或包装现 skills panel）
    ├── Skills          ← 现有 LocalSkillContent + 绑定关系
    │   ├── All / Tags / Agents / Projects
    │   └── Marketplace（子入口，保持现能力）
    ├── Prompts         ← 新增
    │   ├── All / Favorites / Recent
    │   └── Tag cloud
    ├── Actions         ← P1
    └── Themes          ← P2（可选）
```

### 3.1 入口（「资源库管理的动作」）

| 入口 | 行为 |
|------|------|
| Action Palette：`Open Resource Library` | 打开/聚焦 Library 面板（`panelId: library`），默认上次分类 + 视图模式 |
| Action Palette：`New Prompt…` | 打开创建 Prompt 对话框 |
| Action Palette：`Insert Prompt…` | 二级搜索 Prompt 并插入 |
| 快捷键：`Ctrl/⌘+Shift+L` | Toggle Library 面板 |
| Dock 图标 | 新 `library` 面板（独立于旧 `skills`） |
| 会话输入框 `/` | 弹出 Prompt 快速选择（MVP 支持） |

### 3.2 Slash 解析规则

```
用户输入 /xxx
    ↓
1. 查找 project scope 且 projectId == activeProjectId 的 prompt.slash == "xxx"
2. 未找到 → 查找 global scope 的 prompt.slash == "xxx"
3. 未找到 → 保留原文（不拦截）
```

- 项目级 **覆盖** 全局同名（不是合并）
- slash 仅在 Agent 输入框 `/` 开头触发；终端 PTY 不触发（避免误拦截）
- 匹配时弹出浮层显示候选（同 slash 名仅一个，直接替换；同名 slash 因项目级覆盖规则也只一个）

### 3.3 Insert 双目标

| 目标 | 实现 | 优先级 |
|------|------|--------|
| Agent 输入框 | `ActionContext.insertToAgentInput(text)` | 主 |
| 终端 PTY | 通过 PTY write 写入当前活跃终端（需判断终端是否连接） | 次 |

- 默认 Insert = Agent 输入
- 用户在卡片菜单 / Palette 中可选择「Insert to terminal」
- 终端不可用时灰显该选项

### 3.4 双视图模式

```
viewMode: 'grid' | 'list'
```

- 顶部工具栏切换按钮（网格图标 / 列表图标）
- 关闭面板时持久化到 `~/.neeko/config.json`（library 域）
- 网格：卡片缩略（名称 + 描述前 2 行 + 标签 + 主操作）
- 列表：单行（图标 + 名称 + slash + 标签 + 作用域 + 主操作）

---

## 4. 数据模型

### 4.1 统一资源摘要（前端列表用）

```ts
type ResourceKind = 'skill' | 'prompt' | 'action' | 'theme' | 'media';

interface ResourceSummary {
  id: string;
  kind: ResourceKind;
  name: string;
  description?: string | null;
  tags: string[];
  scope: 'global' | 'project';
  projectId?: string | null;
  sourceType: 'local' | 'git' | 'skillssh' | 'builtin' | 'imported';
  favorite: boolean;
  usageCount: number;
  lastUsedAt?: number | null;
  createdAt: number;
  updatedAt: number;
  // kind-specific preview
  preview?: string; // prompt 正文前 120 字 / skill desc
}
```

### 4.2 Prompt 实体（新增）

存储建议：

```
~/.neeko/library/prompts/<id>.json
// 或统一 SQLite：与 skill_store 同库新表 prompts
```

```ts
interface PromptResource {
  id: string;                 // uuid
  name: string;               // 显示名
  description?: string;
  content: string;            // 提示词正文（支持 {{var}}）
  slash?: string | null;      // 如 "review" → /review
  tags: string[];
  scope: 'global' | 'project';
  projectId?: string | null;
  variables?: Array<{
    name: string;
    description?: string;
    default?: string;
    required?: boolean;
  }>;
  favorite: boolean;
  usageCount: number;
  lastUsedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}
```

### 4.3 Action 模板（P1）

```ts
interface ActionResource {
  id: string;
  name: string;
  description?: string;
  // 与 action-menu 对齐
  group: 'terminal' | 'agent' | 'file' | 'git' | 'quick' | 'custom';
  keywords: string[];
  // 执行载荷
  payload:
    | { type: 'insert-prompt'; promptId: string }
    | { type: 'run-skill'; skillId: string }
    | { type: 'run-command'; command: string }
    | { type: 'open-panel'; panelId: string };
  shortcut?: string | null;
  tags: string[];
  enabled: boolean;
}
```

### 4.4 Skill 映射

不复制 Skill 表；Library Skills 视图继续走 `ManagedSkillDto` / `skill_store`。  
`ResourceSummary` 由 adapter 从 skill DTO 投影。

### 4.5 后端命令草案

| Command | 说明 |
|---------|------|
| `list_library_resources` | `kind?` + `query?` + `projectId?` → `ResourceSummary[]` |
| `list_prompts` / `get_prompt` / `save_prompt` / `delete_prompt` | Prompt CRUD |
| `use_prompt` | 记录 usage + 返回渲染后 content |
| `export_library_bundle` / `import_library_bundle` | P1 |
| 现有 skill_* 命令 | 保持不变 |

---

## 5. 交互设计

### 5.1 Library 主界面

```
┌─ Library ──────────────────────────────────────────────────┐
│ [Skills 12] [Prompts 8] [Actions 3]     🔍 Search…   [+]   │
├────────────┬───────────────────────────────────────────────┤
│ 过滤器     │  资源列表 / 卡片网格                           │
│ ○ All      │  ┌────────────┐ ┌────────────┐                │
│ ○ Fav      │  │ Code Review│ │ /commit    │                │
│ Tags       │  │ skill · git│ │ prompt     │                │
│  git       │  │ Apply ▾    │ │ Insert ▾   │                │
│  review    │  └────────────┘ └────────────┘                │
│ Scope      │                                               │
│  Global    │  空状态：Create reusable prompts for…         │
│  Project   │                                               │
└────────────┴───────────────────────────────────────────────┘
```

### 5.2 资源卡片主操作

| Kind | Primary | Secondary |
|------|---------|-----------|
| Skill | Apply to Agent / Project | View, Edit tags, Uninstall |
| Prompt | Insert to Agent | Copy, Edit, Favorite, Save vars |
| Action | Run | Edit, Bind shortcut |
| Theme | Apply | Preview |

### 5.3 Action Palette 集成

```
Command Palette
────────────────────────
> library
  📚 Open Resource Library          Ctrl+Shift+L
  ✨ New Prompt…
  💬 Insert Prompt…
  🧩 Install Skill from Marketplace

> review
  💬 Prompt: Code Review Checklist  ↵ Insert
  🧩 Skill: code-review             ↵ Apply
  ⚡ Action: Run full CI            ↵ Run
```

动态源：

1. 静态 registry（现有 `ACTION_ITEMS`）  
2. **Library provider**：最近使用 Prompt / 启用 Action 模板  
3. 可选：当前项目绑定 Skill

### 5.4 Save as 闭环

- 会话输入框多选文本 → `Save as Prompt`  
- 终端选中命令 → `Save as Action (run-command)`  
- Skill 编辑器 → 已有创建流

### 5.5 变量填充

Prompt 含 `{{branch}}` 时：

1. Insert 前弹出轻量变量表单  
2. 已知上下文自动填充（active branch、project name、path）  
3. 确认后插入渲染结果

---

## 6. 前端架构

### 6.1 模块建议

```
src/features/library/                 # 新 feature（壳层）
├── components/
│   ├── LibraryPanel.tsx              # 统一壳：tabs + search + 内容区
│   ├── LibrarySidebar.tsx
│   ├── ResourceCard.tsx
│   ├── PromptEditorDialog.tsx
│   ├── PromptInsertDialog.tsx
│   └── EmptyLibraryState.tsx
├── hooks/
│   ├── useLibraryResources.ts
│   └── usePromptActions.ts
├── store/
│   └── libraryStore.ts               # activeKind, query, selection
├── adapters/
│   ├── skillAdapter.ts               # ManagedSkillDto → ResourceSummary
│   └── promptAdapter.ts
└── index.ts

src/features/skill/                   # 保持，Skills tab 内嵌现有内容
src/features/action-menu/
└── providers/
    └── libraryActionProvider.ts      # 动态 actions
```

### 6.2 Dock 兼容策略（已确认：新建 library）

1. **新建 `panelId: library'`**，注册独立 Dock 图标与面板组件
2. 旧 `skills` 面板 **保留但降级**（不再作为主入口，仍可访问）
3. `LibraryPanel` 为全新组件，默认 tab = Skills，内嵌现有 `SkillsPanel` 内容
4. Action `open-resource-library` → `ensureLibraryPanelOpen()` + `setActiveKind(...)`
5. 快捷键 `Ctrl/⌘+Shift+L` 绑定新 `library` 面板
6. 旧 `skills` 相关代码（`ensureSkillsPanelOpen` 等）保持不动，避免回归

### 6.3 状态

```ts
// libraryStore
{
  activeKind: ResourceKind;      // 'skill' | 'prompt' | ...
  searchQuery: string;
  tagFilter: string[];
  scopeFilter: 'all' | 'global' | 'project';
  selectedId: string | null;
  viewMode: 'list' | 'grid';
}
```

Skill 深层状态仍由 `skillStore` 持有；Library 只做壳与 Prompt/Action。

---

## 7. 后端架构

### 7.1 存储选型

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. 与 skill 同 SQLite 加表** | 查询/标签一致、事务简单 | 迁移要谨慎 |
| B. `~/.neeko/library/**.json` | 可读可 git | 搜索弱、并发弱 |
| C. 独立 library.db | 隔离 | 多库管理 |

**推荐 A**：`prompts` / `actions` 表进现有 skill DB（或 `~/.neeko/neeko.db` 统一库），复用 repository 模式。

### 7.2 Prompt 表（示意）

```sql
CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  slash TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  scope TEXT NOT NULL DEFAULT 'global',
  project_id TEXT,
  variables_json TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_prompts_slash ON prompts(slash);
CREATE INDEX idx_prompts_updated ON prompts(updated_at DESC);
```

---

## 8. Action 系统设计（核心交付）

### 8.1 静态 Action 新增

```ts
{
  id: 'open-resource-library',
  group: 'quick',
  label: 'Open Resource Library',
  description: 'Browse skills, prompts, and reusable actions',
  shortcut: 'Ctrl+Shift+L',
  keywords: ['library', 'skills', 'prompts', 'resources'],
  execute: (ctx) => {
    ensureLibraryOpen({ kind: ctx.preferredKind ?? 'skill' });
    ctx.closeMenu();
  },
}
```

### 8.2 动态 Provider 接口

```ts
interface ActionProvider {
  id: string;
  getActions(ctx: ActionContext): ActionRegistryItem[] | Promise<ActionRegistryItem[]>;
}

// getAllActions = staticRegistry + providers.flatMap(...)
```

`libraryActionProvider`：

- Top 8 recently used prompts → `Insert: {name}`  
- Enabled custom actions  
- `New Prompt…` / `Open Marketplace`

### 8.3 执行上下文扩展

```ts
interface ActionContext {
  // existing...
  insertToAgentInput?: (text: string) => void;
  activeProjectId?: string | null;
  openLibrary?: (opts?: { kind?: ResourceKind; resourceId?: string }) => void;
}
```

---

## 9. 分阶段落地

### Phase 1 — 壳 + Prompt + Action 入口（约 1 迭代）

1. `LibraryPanel` 包装现有 Skills 内容  
2. Prompts CRUD（本地）  
3. Action：`Open Resource Library` / `New Prompt` / `Insert Prompt`  
4. 快捷键 + 空状态  
5. 原型验证后写测试

### Phase 2 — Palette 动态化 + 使用闭环

1. ActionProvider 机制  
2. Save as Prompt  
3. 变量填充  
4. usage / recent 排序

### Phase 3 — Action 模板 + 导入导出

1. ActionResource  
2. bundle import/export  
3. project scope

### Phase 4 — Themes / Media（按需）

1. 对接 `features/theme`  
2. Media 仅做附件索引（可选）

---

## 10. 验收标准（MVP）

1. 从 Action Palette 搜索 `library` 可打开资源库面板  
2. Skills tab 行为与现网一致（安装/标签/Agent/Project）  
3. 可创建 Prompt 并在列表中搜索到  
4. Insert Prompt 将正文写入当前 Agent 输入区（或剪贴板 fallback）  
5. 删除 Prompt 需确认，且刷新后不再出现  
6. 面板关闭再打开保留上次 kind  
7. 关键 skill 回归测试通过

---

## 11. 风险与取舍

| 风险 | 缓解 |
|------|------|
| 面板改名导致用户迷失 | 保留 Skills 文案在 tab；Dock 提示 Library |
| Skill 与 Prompt 双状态源 | 严格 adapter，禁止复制 skill 业务逻辑 |
| Palette 动态项过多 | 限制 recent top N + 查询时再扩展 |
| Prompt 注入到错误终端 | Insert 仅对 Agent 输入；终端走 Action run-command |
| 范围膨胀到 Media/云同步 | MVP 冻结，文档明确 P2+ |

---

## 12. 开放问题（已解决）

| # | 问题 | 决策 |
|---|------|------|
| 1 | Dock 面板 ID | **新建 `panelId: library'`**，旧 `skills` 保留但降级 |
| 2 | Prompt slash | **MVP 即支持** |
| 3 | Insert 目标 | **Agent 输入为主，终端 PTY 也支持** |
| 4 | 项目级覆盖 | **项目级优先级更高，覆盖全局同名** |
| 5 | 视图模式 | **网格 + 列表双视图** |

---

## 13. 原型

交互原型见：

- `prototypes/resource-library.html`（同目录）

覆盖：

1. Library 三栏（Skills / Prompts / Actions）  
2. 空状态与创建 Prompt  
3. Action Palette 搜索资源  
4. Insert / Apply 主路径  
5. Save as Prompt 示意

---

## 14. 与现有文档关系

- 不替代 `docs/skill-management-design.md`（Skill 领域设计仍有效）  
- 本方案是 **Library 壳 + Prompt/Action 扩展 + Action 入口** 的上层设计  
- 实现时应优先复用 `skillStore`、`ensureSkillsPanelOpen`、`actionRegistry`
