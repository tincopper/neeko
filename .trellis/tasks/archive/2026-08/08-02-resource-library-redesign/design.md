# Resource Library（资源管理）交互修复 — 设计方案

> 阶段：设计规划（Phase 1） · 关联：`prd.md`（需求与验收）、`prototypes/`（原型图）、`acceptance.md`（验收过程）
>
> **v2 修订说明**：根据评审反馈，保留现有水平 Tab 布局，放弃 v1 的垂直 rail 重构。本文档聚焦「内容区不显示」的代码级修复方案，改动最小化。
> **v3 修订说明**（本轮评审反馈）：① 资源列表区与资源内容区**拆分为两个独立岛屿块**（贴合 DockLayout island 语言：`rounded-lg border shadow-sm bg-bg-secondary`，间隙露出 bg-primary「海面」）；② Skills 导航内的 **Agent 分组默认折叠**（当前 `agentsExpanded` 默认 `true` 是代码写死，非必要）。
> **v4 修订说明**（本轮评审决策）：① 5 类资源**统一岛屿样式**（Prompts 的 Filters 独立成岛、Actions/MCP/Commands 各为内容岛）；② Library **迁至中央全宽展示**（`openAs: 'tab'` + appViewStore，打开时隐藏编辑区，仿 `skillsActive` 模式）；③ 顶部 **Tab 条改为浮岛**（与内容岛同视觉语言，消除割裂感）；④ Skills 导航 **Agent 与 Projects 分组默认折叠**。
> **v6 修订说明**（本轮评审反馈）：① **Tab 条从浮岛改为扁平轻量设计**（无阴影、无圆角或仅顶部小圆角、背景透明或融合），参考 VS Code editor tab strip / JetBrains tool window stripe 的低存在感导航 chrome 语言；② **去除岛屿内部硬分割线**（LibraryHeader `border-b`、Filters 岛头 `border-b`），改用自然间距分隔；③ **去除 SkillsPanel 内重复标题行**（与 Tab 标签重复），节省垂直空间；④ **LibraryHeader 底部 count 行合并**到 toolbar 或搜索结果区；⑤ **5 类资源统一工具栏外壳**（高度 h-11、内边距 px-4、按钮 h-7 text-xs）；⑥ **命名修正**（SkillsPanel 的「Library」改为「Installed」以区分面板名）；⑦ **岛屿间隙微调**至 4px（`gap-1`），增强岛屿分离感。
> 本文档是后续实现任务（`implement.md`）的设计依据。

---

## 1. 设计原则（由 PRD G1–G5 推导）

1. **内容优先**：资源管理的核心缺陷是「导航有、内容无」——一切改动以「内容区立即可见」为第一目标。
2. **保持结构**：水平 5-Tab 布局、store 数据结构一律不动；Library 面板迁至**中央全宽展示**（v4 评审决策），改动收敛到「内容区挂载、统一岛屿化与状态协同」。
3. **复用不新建**：修复优先复用现有组件（`SkillsPanel`、`SkillContent`、各 TabContent），不新造导航体系。
4. **状态解耦**：Library 的 tab 状态（`libraryStore.activeKind`）与技能内容视图状态（`skillStore`）各司其职、互不串扰。

---

## 2. 修复方案总览

### 2.1 核心修复（Block 级，对应 R1/R2）

**在 Library 的 Skills tab 内，将「导航栏 + 内容区」并列渲染**——复刻 `App.tsx` 中已被验证有效的拆分模式：

```
现状（Library Skills tab）                    修复后（Library Skills tab）
┌──────────────────────────┐                 ┌──────────┐ ┌───────────────────┐
│ SkillsPanel（纯导航栏）    │                 │  列表岛    │ │     内容岛          │
│ Library / Marketplace    │                 │ SkillsPanel│ SkillContent      │
│ Tags / Agents / Projects │                 │（w-44，   │ （flex-1 min-h-0，  │
│ （无内容区，一整块）        │                 │ rounded-lg│  rounded-lg border │
└──────────────────────────┘                 │ border    │  shadow-sm         │
                                             │ shadow-sm │  bg-bg-secondary）  │
                                             │ bg-bg-secondary）               │
                                             └──────────┘ └───────────────────┘
                                                 ↑ gap（2px~4px，露出海面 bg-primary）
```

**具体改动点（实现任务执行）**：

| # | 文件 | 改动 |
| --- | --- | --- |
| F1 | `src/features/library/components/SkillsTabContent.tsx` | 由 `<SkillsPanel />` 改为**两个独立岛屿**并列渲染：列表岛 `<SkillsPanel />` + 内容岛 `<SkillContent />`，各自 `rounded-lg border shadow-sm bg-bg-secondary`，中间留 gap（海面由 LibraryPanel 提供） |
| F2 | `src/features/library/components/LibraryPanel.tsx` | 内容区改造为**海面容器**：根节点 `bg-bg-primary`，内容区 `p-1 gap-1 flex`；**Tab 条改为浮岛**（`rounded-lg border shadow-sm bg-bg-secondary`，与内容岛同语言）；5 类资源统一岛屿外壳（Prompts 的 Filters 独立成岛、Actions/MCP/Commands 各为内容岛、Skills 保留双岛） |
| F3 | `src/shared/dock/panelMeta.ts` | library 设置 `openAs: 'tab'`——**不入 dock zone**，避免左栏/中央双渲染；dock 图标仍保留（barItems 按 defaultZone 生成，不检查 openAs） |
| F4 | `src/shared/store/dockStore.ts` | `togglePanel` 对 `openAs: 'tab'` 面板改为切换 `appViewStore`（'library' ⇄ 'normal'），不加入 zone；打开其他 dock 面板时退出 library 视图；**打开 Library 时收起左栏（记录原展开态，关闭/切走时恢复）** |
| F5 | `src/shared/store/appViewStore.ts` | `AppView` 新增 `'library'` |
| F6 | `src/app/App.tsx` | `appView === 'library'` 时中央区全宽渲染 `LibraryPanelWrapper`（lazy + Suspense），隐藏 `ProjectWorkspace`（仿 `skillsActive` 模式） |
| F7 | `src/app/components/DockBarButton.tsx` | tab-mode 面板激活态由 `appView === panelId` 驱动（library 已不在 zone 中，原 zone 检测恒 false） |

**关键约束**：
- `SkillContent` 根节点是 `h-full min-h-0 w-full flex flex-col overflow-hidden`（`SkillContent.tsx` L94）——放进内容岛需包一层 `flex-1 min-h-0` 的 wrapper（岛屿外壳），保证高度受控、内部可滚动。
- 岛屿视觉与 DockLayout 对齐（`DockZone.tsx` L36：`rounded-lg shadow-sm bg-bg-secondary` + gap 露 bg-primary「海面」），保证「列表区/内容区是两块独立岛屿」的观感。
- 不改 `App.tsx`：Dock `skills` 面板的中央区 SkillContent 逻辑（`skillsActive`）保持原样，两者共享同一 `skillStore` 状态，数据天然一致。

### 2.2 状态协同（对应 R2 的彻底解决）

- Library 内 Skills tab 的内容显隐**只由 `libraryStore.activeKind === 'skill'` 决定**（父级 tab 切换天然控制）。
- `SkillContent` 内部视图切换（local/marketplace/agents/project）由 `skillStore.activeSkillView` 驱动，点击 `SkillsPanel` 导航项即切换——与 App.tsx 中央区的行为完全一致，无需任何新状态。

### 2.3 各 tab 内容组件修复清单（对应 FR-3/FR-5/FR-6）

| Tab | 现状 | 需改动 |
| --- | --- | --- |
| Skills | 内容区未挂载（R1） | 执行 §2.1 核心修复 |
| Prompts | 组件完整（`PromptListSection` 含 loading/empty） | 无需改动，回归验证即可 |
| Actions | 组件完整（`ActionsTabContent`） | 无需改动，回归验证 |
| MCP | 组件完整（`McpTabContent`） | 无需改动，回归验证 |
| Commands | 组件完整（`CommandTabContent`） | 无需改动，回归验证 |

### 2.4 不做的改动（范围约束）

- ❌ 垂直 rail 重构（v1 方案废弃）。
- ✅ 面板槽位迁移（v4 已实施）：`library` 由 Dock 左栏迁至**中央全宽展示**（`openAs: 'tab'` + appViewStore）。
- ❌ 水平 tab 换成其他形式。
- ❌ store 数据结构、后端命令改动。
- ❌ Header 溢出（R5）：记录为遗留问题，单独任务处理。

### 2.5 导航分组默认折叠（评审反馈：Agent + Projects）

**现状**：`SkillsPanel.tsx` 中 `agentsExpanded`（L62）与 `projectsExpanded`（L61）均默认 `useState(true)`，且挂载即拉取 Agent / 项目技能计数——**Agent 与 Projects 分组在导航中间默认展开**，是代码写死，并非交互必需。

**分组用途**（回答「为什么会有它们」）：Neeko 管理多个 Agent（opencode、claude-code 等）与多个项目，技能可安装/同步到指定 Agent 或项目；`AgentSkillContent`/`ProjectSkillContent` 提供对应视图。因此分组**功能需要保留**，但不应常驻展开——资源管理是独立功能，导航中不应混入其他功能域的常驻列表。

**修复决策**：

| 分组 | 现状 | 决策 |
| --- | --- | --- |
| Agent | `agentsExpanded = useState(true)` | 默认 `false`（折叠），仅保留标题行 |
| Projects | `projectsExpanded = useState(true)` | 默认 `false`（折叠），仅保留标题行 |
| 展开交互 | 点击标题行展开/折叠 | 现有 `setAgentsExpanded` / `setProjectsExpanded` 逻辑不变 |
| 保留范围 | 分组与点击跳转 Agent/项目视图的功能完整保留 | 仅改初始展开态 |
| 影响面 | 各一行 `useState(true)` → `useState(false)` | Dock skills 面板与 Library Skills tab 共用该组件，同步生效 |

> 该决策同样作用于 Dock `skills` 独立面板（共用 `SkillsPanel`），属于一致的体验修正。

---

## 3. 布局方案（修复后）

### 3.1 Library 面板（修复后：中央全宽 + 海面岛屿）

```
Dock 左图标栏 │ Library 面板（中央全宽，打开时编辑区隐藏）     │ Dock 右图标栏
             │ ┌──────────────────────────────────────────┐ │
             │ │ Tab 条：Skills│Prompts│Actions│MCP│Commands│ │  ← 水平 Tab 保留
             │ ├──────────────┬───────────────────────────┤ │
             │ │  Filters 岛   │   内容岛（当前 tab）         │ │  ← 海面 bg-primary
             │ │ (prompt 时)   │   ┌─────────────────────┐ │ │
             │ │              │   │ 列表岛+内容岛(Skills) │ │ │
             │ │              │   │ 或 单内容岛(其余)     │ │ │
             │ └──────────────┴───────────────────────────┘ │
```

- **中央全宽**：`appView === 'library'` 时，`App.tsx` 中央区全宽渲染 `LibraryPanelWrapper`，隐藏 `ProjectWorkspace`（仿 `skillsActive` 模式）——解决「内容挤在窄左栏展示不下」的根因。
- **海面容器**：`LibraryPanel` 根节点 `bg-bg-primary`，内容区 `p-1 gap-1 flex`；各 tab 内容为独立岛屿（`rounded-lg border shadow-sm bg-bg-secondary`），间隙露出海面——与 `DockLayout`/`DockZone`（L36）的 island 语言完全一致。
- **水平 Tab 岛**：顶部导航为**独立浮岛**（`rounded-lg border shadow-sm bg-bg-secondary`，海面间隙环绕，非贴顶实底横条）——与内容岛同一视觉语言，融入感一致；5-tab 布局不变。
- **Filters 岛**：仅 prompt tab 显示（`w-44`，独立岛屿），其余 tab 隐藏——位置固定，切换无跳动。
- **Skills 视图**：列表岛（SkillsPanel，`w-44`）+ 内容岛（SkillContent，`flex-1 min-h-0`）双岛；Agent 与 Projects 分组默认折叠（§2.5）。
- **Actions/MCP/Commands**：单内容岛（`LibraryHeader` + TabContent）。

### 3.2 其余 4 个 tab（统一岛屿）

| Tab | 结构 |
| --- | --- |
| Prompts | Filters 岛（w-44，独立 island）+ 内容岛（`LibraryHeader` + `PromptListSection`） |
| Actions | 内容岛（`LibraryHeader` + `ActionsTabContent`） |
| MCP | 内容岛（`LibraryHeader` + `McpTabContent`） |
| Commands | 内容岛（`LibraryHeader` + `CommandTabContent`） |

### 3.3 布局稳定性

- 5 类资源共用同一外壳（Tab 岛 + 海面 + 内容岛），切换类型仅内容岛显隐，位置恒定。
- Filters 岛仅 prompt 显示但位置固定（`flex` 布局中该岛占位不随类型跳动）。

### 3.4 左栏行为（评审反馈 ②）

- **打开 Library 时收起 Dock 左栏**（projects 等面板不显示），与 skills 面板「切换即替换」的交互一致；`dockStore` 记录左栏原展开态（`leftZoneExpandedBeforeLibrary`），关闭 Library 或打开其他 dock 面板时恢复。
- 效果：Library 中央视图独占，无 projects 面板残留。

### 3.5 样式对齐与交互统一（评审反馈 ①③）

见 `ui-alignment-analysis.md`（A 部分样式对齐 / B 部分交互统一 / C 部分落实范围）。要点：

- **岛屿外壳**：全部岛屿去掉 `border border-border`，改为 `rounded-lg shadow-sm bg-bg-secondary`（与 `DockZone` L36 完全一致）；间隙 `p-0.5 gap-0.5`（2px，对齐 DockLayout `py-0.5`）。
- **搜索框**：`h-8 pl-8 rounded-lg bg-bg-hover/50 border border-border/80`（与 `SkillSearchInput` 一致）。
- **工具栏**：`h-11 px-4`；按钮 `h-7 px-2.5 text-xs`。
- **交互统一**：5 类资源共用「搜索 + 主操作 + 列表 + 状态」四要素骨架；Skills 的 Install/Scan/Meta 专属操作保留但视觉对齐。

---

## 4. 交互设计（修复后）

| 场景 | 交互 | 对应 FR |
| --- | --- | --- |
| 打开资源管理 | Dock 图标 / `Ctrl+Shift+L` → `togglePanel('library')` → appView='library' → 中央全宽渲染，编辑区隐藏 | FR-11 |
| 关闭资源管理 | 再次点击图标 / 打开其他 dock 面板 → appView='normal' → 恢复编辑区 | FR-11 |
| 切换资源 Tab | 点击顶部水平 Tab → 仅内容岛显隐；5-tab 常驻挂载 + hidden 切换（保留各 tab 滚动/筛选状态） | FR-3 |
| Skills 导航项 | 点击 `SkillsPanel` 导航项 → `skillStore` 更新 → `SkillContent` 路由切换（local/marketplace/agents/project）；Agent 分组默认折叠，点击标题展开 | FR-2 |
| Prompts 搜索/筛选/插入 | 现有 `LibraryHeader` + `PromptListSection` 逻辑不动；插入走 `onInsertPrompt`（变量对话框保留） | FR-5 |
| Actions/MCP/Commands | 现有列表 + 操作按钮不动 | FR-6 |

### 4.1 挂载策略（对齐）

- 将 5 个 tab 统一为**常驻挂载 + CSS hidden 切换**（Skills 已是此模式，其余 4 个从条件渲染改为常驻 + hidden）——避免切换 tab 时滚动/加载状态丢失，与「保持最小改动」不冲突（纯 JSX 结构调整）。

---

## 5. 视觉规范

**与主题严格对齐**（依据 `ui-alignment-analysis.md` A 部分）：

| 项 | 值 |
| --- | --- |
| 岛屿外壳 | `rounded-lg shadow-sm bg-bg-secondary`（**无描边**，与 DockZone 一致） |
| 岛屿间隙 | `p-0.5 gap-0.5`（2px，与 DockLayout `py-0.5` 一致） |
| 海面 | `bg-bg-primary` |
| 搜索框 | `h-8 pl-8 rounded-lg bg-bg-hover/50 border border-border/80` |
| 工具栏 | `h-11 px-4`；按钮 `h-7 px-2.5 text-xs` |
| 文字 | `text-text-primary/secondary/muted`、`--font-size` |
| 强调 | `accent-blue`（选中、主按钮）、`accent-green`（运行）、`accent-red`（删除/错误） |
| 计数徽标 | `text-[11px] tabular-nums` |

---

## 6. 实现任务拆分建议（供后续 implement.md）

| 步骤 | 内容 | 验证 |
| --- | --- | --- |
| S1 | `SkillsTabContent` 并列渲染 `SkillsPanel` + `SkillContent`（列表岛 + 内容岛） | 打开资源管理，Skills 内容立即可见 |
| S2 | `LibraryPanel` 海面容器改造：Tab 条常驻 + Filters 岛 + 各 tab 内容岛统一 | 5 tab 切换无跳动、岛屿观感一致 |
| S3 | 中央全宽机制：panelMeta `openAs:'tab'` + appViewStore + dockStore.togglePanel + App.tsx + DockBarButton | 打开时编辑区隐藏、图标激活态正确、无双渲染 |
| S4 | Agent + Projects 分组默认折叠（两处 `useState(true)`→`false`）+ 测试同步 | 用例通过 |
| S5 | 回归：Dock `skills` 面板、Prompts 主链路、Actions/MCP/Commands 操作 | 全量回归（acceptance.md §9） |

---

## 7. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `SkillContent` 内部对话框（Create/Edit/View/GitInstall/AssignTag）在面板内正常弹出 | 对话框是 fixed/portal 渲染，不受容器影响；回归验证 |
| `SkillContent` 与 Dock skills 面板共享 `skillStore`，两边切换互相影响 | 属预期（数据一致），仅呈现层各自独立；回归确认无异常 |
| 左栏窄宽度下导航+内容并列过挤 | 默认 `w-44` + `shrink-0`；极端宽度下 SkillsPanel 自身可滚动 |
| 改动蔓延 | 严格按 §2.4 不做清单；S1-S4 每步可独立验证 |

---

## 8. 原型图索引（本阶段交付，预览入口见 `prototypes/README.md`）

| 原型 | 对应章节 | 验证的验收标准 |
| --- | --- | --- |
| `prototypes/wireframes/01-current-vs-target.svg` | §2.1 核心修复 | AC-1、AC-2 |
| `prototypes/wireframes/02-target-panel.svg` | §3 布局 | AC-3、AC-4 |
| `prototypes/prototype.html`（可交互） | §3、§4 | AC-1~AC-3、AC-7~AC-12 |
