# Resource Library（资源管理）交互修复 — PRD

> 阶段：设计规划（Phase 1） · 状态：planning → in_progress · 对应代码：`src/features/library/components/LibraryPanel.tsx`、`src/features/skill/components/SkillsPanel.tsx`、`SkillContent.tsx`、`src/app/App.tsx`
>
> 本文档只描述「问题、需求、验收标准」，不包含实现方案（见 `design.md`）与验收过程（见 `acceptance.md`）。
>
> **v2 修订说明**：根据评审反馈，放弃 v1 的「垂直 rail 重构」方案。**保留现有水平 Tab 布局**，改为**最小改动**，聚焦「点击资源后内容区不显示」这一核心缺陷。
> **v3 修订说明**（本轮评审反馈）：① 资源列表区与资源内容区**拆分为两个独立岛屿块**（列表岛 + 内容岛，贴合 DockLayout island 语言）；② Skills 导航内 **Agent 分组默认折叠**（当前 `agentsExpanded` 默认 `true` 系代码写死，非必需）。
> **v4 修订说明**（本轮评审决策）：① 5 类资源**统一岛屿样式**；② Library **迁至中央全宽展示**（打开时隐藏编辑区，仿 `skillsActive` 模式），解决「内容挤在窄左栏展示不下」的根因；③ 顶部 **Tab 条改为浮岛**（融入岛屿语言）；④ Skills 导航 **Agent 与 Projects 分组默认折叠**。

---

## 1. 背景与目标

Neeko 的「资源管理」（Resource Library，Dock 面板 id=`library`）用于统一管理五类可复用资源：**Skills、Prompts、Actions、MCP Servers、Commands**，并把它们插入到 Agent 对话 / 终端中使用。

当前面板存在核心交互缺陷：**点击资源类型后，只能看到左侧/顶部的导航菜单，主内容区不显示对应内容**，面板基本不可用。

本次任务目标：

1. 基于代码事实完成根因诊断（不是凭感觉）；
2. 产出一份可在浏览器预览的原型 + 设计方案文档；
3. 产出一份可执行的验收过程文档（验收步骤 + 检查清单 + 通过标准）；
4. **本阶段不写应用代码**，实现排期到后续任务。

### 1.1 范围约束（评审确定）

- ✅ **保留现有水平 Tab 布局**（Skills / Prompts / Actions / MCP / Commands 顶部横排），不做垂直导航重构。
- ✅ **改动最小化**：只修复「内容区不显示 / 无法交互」的核心问题，不做信息架构级重排。
- ✅ **v4 新增**：Library 面板迁至**中央全宽展示**（`openAs: 'tab'` + appViewStore），打开时隐藏中央编辑区（仿 `skillsActive` 模式）——解决内容展示不下。
- ❌ 不做：垂直 rail、整体视觉重设计（超出本任务范围，另议）。

---

## 2. 现状诊断（基于代码事实）

### 2.1 现状结构

| 层级 | 代码位置 | 结构 |
| --- | --- | --- |
| 1. Dock 槽位 | `src/shared/dock/panelMeta.ts` | `library` 面板 `defaultZone: 'left'`，与 `projects`、`skills` 共用左侧窄栏；`minPanelSize: 240` |
| 2. LibraryPanel | `src/features/library/components/LibraryPanel.tsx` | 顶层**水平 5-Tab 条**（Skills/Prompts/Actions/MCP/Commands）；Skills tab 常驻挂载，其余条件渲染；仅 `prompt` tab 时显示左侧 Filters 栏（`w-44`） |
| 3. Skills 内容 | `SkillsTabContent` → `SkillsPanel.tsx` + `SkillContent.tsx` | **关键**：`SkillContent`（技能内容区）只被渲染在 `src/app/App.tsx` 中央区，由 `zones.left?.activePanelId === 'skills'` 控制；Library 内 **从未挂载 SkillContent** |
| 4. 工具栏 | `LibraryHeader.tsx` | 单行 h-11 内容纳：搜索、网格/列表、排序、Save as Prompt、Import、Export、New 等最多 7 组控件 |

### 2.2 根因分析（核心缺陷）

#### R1【Block】Skills tab（默认 tab）内容区空白 —— 内容组件未被挂载

- **现象**：打开资源管理（默认落在 Skills tab），只看到 SkillsPanel 的导航菜单（Library/Marketplace/Tags/Agents/Projects），右侧内容区空白；点击导航项也无内容变化。
- **代码证据**：
  - `App.tsx` L29、L56-71：`SkillContent` 只在 `skillsActive = zones.left?.activePanelId === 'skills'` 时渲染于中央区——即只有「Dock skills 面板」激活时才出现；
  - `SkillsTabContent.tsx`：Library 的 Skills tab 只渲染 `<SkillsPanel />`（导航栏组件），**没有渲染 `<SkillContent />`**；
  - `SkillsPanel.tsx`：该组件本身只包含导航 rail（Header + nav + Tags + Agents + Projects），**不含内容区**（内容区是独立的 `SkillContent`，内含 `LocalSkillContent`/`MarketplaceContent`/`AgentSkillContent`/`ProjectSkillContent` 路由，见 `SkillContent.tsx` L78-91）。
- **结论**：Library 面板缺少 App.tsx 中「SkillsPanel（导航）+ SkillContent（内容）并列」的配套结构，导致导航有、内容无。

#### R2【Block】内容区「整体显示」依赖错误的激活条件

- 即使内容区通过其他路径渲染，其显隐由 `zones.left?.activePanelId === 'skills'` 控制，与 Library 面板自身的 tab 状态（`libraryStore.activeKind`）无关——两条状态线不一致，Library 内无法稳定显示技能内容。

#### R3【Should-fix】tab 切换挂载策略不一致

- Skills tab 常驻挂载 + `hidden`（`LibraryPanel.tsx` L168-170），其余 4 个 tab 条件渲染（卸载/挂载）——切换 tab 时滚动位置、加载状态全部重置；且因 R1，Skills 常驻挂载的只是导航栏。

#### R4【Should-fix】筛选侧栏仅 prompt 显示，布局随 tab 跳动

- Filters 栏仅 `activeKind === 'prompt'` 时出现（L125-133），切换类型时内容区宽度跳动。因范围约束保留该结构，但需确保跳变不破坏交互（窄面板下不挤压内容）。

#### R5【Should-fix】Header 控件溢出（窄面板）

- `LibraryHeader.tsx` 单行 7 组控件，左栏（12%–35% 宽）下可能被挤出可视区。属于既有问题，本次仅记录，修复优先级低于 R1/R2。

### 2.3 各 tab 内容组件现状核查

| Tab | 内容组件 | 现状 |
| --- | --- | --- |
| Skills | `SkillContent`（含 4 个子视图路由） | ❌ **未挂载**（R1/R2） |
| Prompts | `PromptListSection`（grid/list + 空态/加载态） | ✅ 组件完整，含 loading/empty 状态（L84-102） |
| Actions | `ActionsTabContent` → `ActionListSection` | ✅ 组件完整 |
| MCP | `McpTabContent` | ✅ 组件完整 |
| Commands | `CommandTabContent` | ✅ 组件完整 |

**结论**：核心缺陷集中在 Skills tab（默认 tab），其余 4 个 tab 内容组件本身存在，需在修复后整体回归验证。

---

## 3. 用户与场景

### 3.1 目标用户

- **主力用户**：使用 Neeko 的开发者，日常在 Agent 对话与终端中反复插入 Prompt、执行 Actions、使用 Skills 与 MCP。
- **次要用户**：Skill 作者 / 团队维护者。

### 3.2 关键用户故事

| ID | 故事 | 成功标准 |
| --- | --- | --- |
| US-1 | 作为开发者，我打开资源管理后，**立即能看到当前资源类型的完整内容**（导航 + 列表），而不是空白 | 打开即见内容，无空白区 |
| US-2 | 作为开发者，我在 Skills 中点击 Library/Marketplace/Agent/项目 导航项，**内容区随之切换** | 每个导航项都有对应内容 |
| US-3 | 作为开发者，我切换 5 个资源 Tab，**每个 Tab 都显示自己的内容**，且切换不报错、不空白 | 5 个 Tab 全可交互 |
| US-4 | 作为开发者，我能在 Prompts 中搜索/筛选并插入 Prompt 到 Agent | 主链路可用 |
| US-5 | 作为维护者，我能在各 Tab 中执行新建/编辑/导入导出等操作 | 工具栏功能可达 |

### 3.3 使用流程

```
打开资源管理（Ctrl+Shift+L / Dock 图标）
  → 默认 Skills tab：导航 + 技能列表立即可见
  → 切换 Tab（Prompts/Actions/MCP/Commands）：各自内容区显示
  → （可选）搜索 / 过滤 / 排序 / 新建
  → 选中资源 → 插入到 Agent / 终端 或 编辑 / 测试
```

---

## 4. 设计目标

1. **G1 内容可见**：打开资源管理，当前 Tab 的内容区必须立即渲染（Block 级）。
2. **G2 保留水平布局**：水平 5-Tab 结构不做重构，改动点收敛到「内容区挂载与状态协同」。
3. **G3 最小改动**：复用现有组件（`SkillsPanel`、`SkillContent`、各 TabContent），不新建导航体系、不动 store 数据结构。
4. **G4 状态协同**：Library tab 状态与技能内容视图状态解耦但可预测（`activeKind` 控制显示哪个 Tab；skillStore 控制技能内部视图，二者互不依赖渲染）。
5. **G5 一致视觉**：沿用现有 token 与 island 风格，无新配色。

---

## 5. 需求范围

### In scope（本任务交付）

- 根因诊断文档（本文 §2）。
- 修复方案文档 `design.md`（含具体代码级修复点）。
- 原型图（SVG 线框 + 可交互静态 HTML，位于 `prototypes/`，**仅设计预览，非应用代码**）。
- 验收过程文档 `acceptance.md`。

### Out of scope（后续实现任务）

- 任何 `src/` 应用代码改动。
- 后端 / Tauri 命令改动。
- 垂直导航重构、面板槽位迁移、视觉重设计。

### 约束

- 不新增第三方 UI 库；沿用现有 token。
- 兼容 Tauri 桌面窗口（可缩放、窄窗口 ≥ 640px 需可用）。
- 现有快捷键 `Ctrl+Shift+L` 打开资源管理保留。
- **Dock skills 独立面板行为不得回归**（`App.tsx` 中央区 SkillContent 逻辑保持不变）。

---

## 6. 功能需求

| ID | 需求 | 优先级 |
| --- | --- | --- |
| FR-1 | 打开资源管理默认 Skills tab：左侧导航（SkillsPanel）+ 右侧内容区（SkillContent）并列完整显示 | P0 |
| FR-2 | Skills 内容区随导航项切换（Library/Marketplace/Agent/项目/Tags），复用 `SkillContent` 内部路由 | P0 |
| FR-3 | 5 个资源 Tab 各自内容区正常显示；切换不报错、不空白 | P0 |
| FR-4 | Skills 内容显隐由 Library 内 tab 状态驱动，不再依赖 `zones.left?.activePanelId === 'skills'` | P0 |
| FR-5 | Prompts Tab 保持「左侧 Filters + 内容列表」结构，搜索/筛选/插入主链路可用 | P1 |
| FR-6 | Actions / MCP / Commands Tab 内容列表与操作可用 | P1 |
| FR-7 | 修复后不得影响 Dock `skills` 独立面板（App.tsx 中央区）既有行为 | P0 |
| FR-8 | 记录（不强制修复）Header 窄面板溢出问题（R5），供后续任务 | P3 |
| FR-9 | 5 类资源内容区**统一岛屿样式**：各自 `rounded-lg border shadow-sm bg-bg-secondary` 岛屿外壳（Skills 列表岛+内容岛、Prompts Filters 岛+内容岛、Actions/MCP/Commands 单内容岛），间隙露出海面 bg-primary，不再连成一整块 | P1 |
| FR-10 | Skills 导航内 **Agent 与 Projects 分组默认折叠**（仅标题行常驻），点击标题展开/收起；分组与跳转功能完整保留 | P1 |
| FR-11 | Library **中央全宽展示**：打开（Dock 图标 / `Ctrl+Shift+L`）时隐藏中央编辑区，LibraryPanel 全宽渲染；关闭（再次点击 / 打开其他 dock 面板）恢复编辑区 | P0 |
| FR-12 | 顶部 Tab 切换栏为**浮岛样式**（`rounded-lg border shadow-sm bg-bg-secondary`，海面间隙环绕），与内容岛同一视觉语言，消除「实底横条贴顶」的割裂感 | P1 |
| FR-13 | 打开 Library 时**收起 Dock 左栏**（projects 等面板不显示），关闭 Library 或打开其他 dock 面板时恢复原左栏展开态 | P0 |
| FR-14 | Library 内部样式**对齐应用主题**：岛屿无描边（`rounded-lg shadow-sm bg-bg-secondary`）、间隙 2px（`p-0.5 gap-0.5`）、搜索框 `h-8 rounded-lg`、工具栏 `h-11 px-4`、按钮 `text-xs` | P1 |
| FR-15 | 5 类资源**交互骨架统一**（搜索 + 主操作 + 列表 + 空/加载/错误态四要素），Skills 专属操作（Install/Scan/Meta）保留但视觉对齐 | P1 |

---

## 7. 非功能需求

| ID | 需求 | 验收锚点 |
| --- | --- | --- |
| NFR-1 | 视觉一致：只使用现有设计 token | 视觉走查 |
| NFR-2 | 可访问性：导航/列表键盘可达（`tabIndex` + Enter）；选中态非颜色单通道 | 键盘走查 |
| NFR-3 | 性能：切换 Tab/导航项无可见卡顿 | 手测 |
| NFR-4 | 状态单一来源：Library tab 用 `libraryStore.activeKind`；技能视图用 `skillStore`，不串扰 | 代码审查（实现阶段） |
| NFR-5 | 改动面最小：不修改 store 数据结构与后端命令 | 代码审查（实现阶段） |

---

## 8. 验收标准（可验收）

> 每条标准对应 `acceptance.md` 中可执行的验收步骤。标 ⭐ 的为 Block 级（不满足即视为验收失败）。

- [ ] ⭐ AC-1 打开资源管理（`Ctrl+Shift+L`），默认 Skills tab 立即显示「导航栏 + 技能内容列表」，无空白区。
- [ ] ⭐ AC-2 Skills 内点击 Library / Marketplace / Agent / 项目 / Tag 导航项，内容区随之切换且正确。
- [ ] ⭐ AC-3 依次切换 Prompts / Actions / MCP / Commands Tab，每个 Tab 内容区均正常显示，无空白、无报错。
- [ ] ⭐ AC-4 Skills 内容显隐只由 Library 内部状态驱动；激活 Dock `skills` 面板与否不影响 Library 内 Skills 显示。
- [ ] ⭐ AC-5 水平 Tab 布局保持不变（与修复前一致），改动不引入布局重构。
- [ ] ⭐ AC-6 Dock `skills` 独立面板（App.tsx 中央区 SkillContent）行为无回归。
- [ ] AC-7 Prompts 搜索/筛选/插入到 Agent 主链路可用（含变量对话框）。
- [ ] AC-8 Actions / MCP / Commands 的列表与操作（运行/测试/编辑/新建）可用。
- [ ] AC-9 键盘可达：仅键盘可完成「打开 → 选 Tab → 选导航项 → 查看内容」。
- [ ] AC-10 原型与设计方案通过用户/评审确认（记录在 `acceptance.md`）。
- [ ] AC-11 5 类资源内容区**统一岛屿样式**（视觉分离、间隙明显、各自圆角边框阴影），不是一整块连体。
- [ ] AC-12 Skills 导航内 **Agent 与 Projects 分组默认折叠**，点击标题可展开/收起；展开后跳转对应视图功能正常。
- [ ] ⭐ AC-13 打开资源管理（Dock 图标 / `Ctrl+Shift+L`）：Library 在**中央全宽**展示，中央编辑区（Agent 对话）隐藏；内容完整展示无截断。
- [ ] ⭐ AC-14 关闭资源管理（再次点击图标 / 打开其他 dock 面板）：恢复编辑区视图；Library 不残留于 Dock 左栏（无双渲染）。
- [ ] AC-15 顶部 Tab 切换栏为**浮岛样式**（圆角 + 边框 + 阴影，海面间隙环绕），与内容岛视觉融合，无「实底横条贴顶」割裂感。
- [ ] ⭐ AC-16 打开 Library 时 **Dock 左栏收起**（projects 面板不显示，Library 独占中央）；关闭 Library 或打开其他 dock 面板后左栏恢复。
- [ ] AC-17 Library 内部**样式对齐主题**：岛屿无描边、间隙 2px、搜索框/工具栏/按钮与 Skills 面板一致（对照 `ui-alignment-analysis.md` A 部分走查）。
- [ ] AC-18 5 类资源**交互骨架一致**：均有搜索 + 主操作 + 列表 + 状态四要素；Skills 专属操作不破坏统一观感。

---

## 9. 开放问题（评审时确认）

1. Skills tab 内「导航栏 + 内容区」的宽度配比：导航栏固定 `w-44`（176px）还是可折叠？（原型给出默认值，评审定夺）
2. 修复实现任务是否同时处理 R5（Header 窄面板溢出）？还是单独任务？（默认：单独任务，本次只记录）

---

## 10. 关联文档

- `design.md` — 修复方案（代码级修复点 + 布局 + 交互 + 视觉）
- `prototypes/` — 原型图（SVG 线框 + HTML 高保真原型）
- `acceptance.md` — 验收过程文档
- 代码依据：`src/features/library/components/LibraryPanel.tsx`、`SkillsTabContent.tsx`、`src/features/skill/components/SkillsPanel.tsx`、`SkillContent.tsx`、`src/app/App.tsx`
