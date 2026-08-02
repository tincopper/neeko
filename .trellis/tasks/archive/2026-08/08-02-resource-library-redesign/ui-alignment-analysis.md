# UI 对齐与交互统一分析（v5 评审反馈）

> 阶段：设计规划（Phase 1） · 关联：`design.md`（修复方案）、`prd.md`（需求与验收）
> 本文档回答两条评审反馈：① 样式、线、间距未对齐；② Library 内部各模块交互不一致。为「对齐优化」提供代码级依据与方案。

---

## A. 样式 / 线 / 间距对齐分析

### A.1 对齐基准（从应用代码提取的权威基准）

| 基准项 | 值 | 来源 |
| --- | --- | --- |
| 岛屿外壳 | `rounded-lg shadow-sm bg-bg-secondary`（**无 border**） | `DockZone.tsx` L36 |
| 岛屿间隙 | `py-0.5 px-px`（上下 2px / 左右 1px） | `DockLayout.tsx` L220 / L236 / L254 |
| 搜索框 | `h-8 pl-8 rounded-lg bg-bg-hover/50 border border-border/80` | `SkillSearchInput.tsx` L31-36 |
| 工具栏高度 | `h-11 px-4` | `SkillHeader.tsx` L50 |
| 工具栏按钮 | `h-7 px-2.5 text-xs` | `SkillHeader.tsx` L66-82 |
| 导航项 | `px-2.5 py-1.5 rounded-md text-[var(--font-size)]` | `SkillsPanel.tsx` L246 |

### A.2 不对齐点清单（Library 现状 vs 基准）

| # | 位置 | Library 现状 | 应用基准 | 问题 |
| --- | --- | --- | --- | --- |
| S1 | 岛屿边框 | `rounded-lg border border-border shadow-sm` | `rounded-lg shadow-sm`（无 border） | 岛屿描边多余，与 Dock 岛屿不一致（「线」不对齐） |
| S2 | 岛屿间隙 | 内容区 `p-1 gap-1`（4px） | `py-0.5`（2px） | 间距偏大（「间距」不对齐） |
| S3 | 搜索框 | `h-7 pl-8 pr-8 rounded-md bg-bg-hover/60 border border-border` | `h-8 pl-8 rounded-lg bg-bg-hover/50 border/80` | 高度/圆角/透明度不一致（Prompts 等 tab 与 Skills 搜索框不同） |
| S4 | 工具栏高度/内边距 | LibraryHeader `h-11 px-3`；Filters 岛头 `h-10 px-3` | `h-11 px-4` | 高度、水平内边距不统一 |
| S5 | 按钮字号 | LibraryHeader 按钮 `text-[11px]` | `text-xs`（12px） | 字号不统一 |
| S6 | Tab 岛与内容岛层级 | Tab 岛 `p-1 pb-0` + 内容区 `p-1` 双重海面边距 | 岛屿间隙 2px | 边距叠加偏大 |

### A.3 对齐优化方案

1. **统一岛屿外壳（S1）**：Library 全部岛屿（Tab 岛、Filters 岛、内容岛、Skills 双岛）去掉 `border border-border`，改为 `rounded-lg shadow-sm bg-bg-secondary`——与 DockZone 完全一致；岛屿区分靠 shadow + 海面颜色，不靠描边。
2. **统一间隙（S2/S6）**：内容区 `p-1 gap-1`（4px）→ `gap-0.5 p-0.5`（2px）；Tab 岛外层 `p-1 pb-0` → `p-0.5 pb-0`——与 DockLayout `py-0.5` 对齐。
3. **统一搜索框（S3）**：LibraryHeader 搜索框改为 `h-8 pl-8 rounded-lg bg-bg-hover/50 border border-border/80`（与 SkillSearchInput 完全一致），清空按钮位置同步适配。
4. **统一工具栏（S4）**：LibraryHeader 与 Filters 岛头统一为 `h-11 px-4`。
5. **统一字号（S5）**：工具栏按钮文字统一 `text-xs`。

---

## B. 交互统一分析（各模块体验一致）

### B.1 各 tab 交互现状

| Tab | 工具栏 | 搜索位置 | 主操作 | 列表操作 | 空/加载态 |
| --- | --- | --- | --- | --- | --- |
| Skills | SkillHeader（Create/Install/Scan/Meta） | 内容区内（SkillSearchInput） | Create / Install / Scan | 安装/查看/编辑/删除 | LocalSkillContent 内置 |
| Prompts | LibraryHeader（搜索/视图/排序/Save/Import/Export/New） | Header 内 | 新建 | 插入/编辑/复制/删除 | PromptListSection 内置 |
| Actions | LibraryHeader（搜索/视图/排序/New） | Header 内 | 新建 | 运行/编辑 | ActionListSection |
| MCP | LibraryHeader（搜索/New） | Header 内 | 新建 | 测试/编辑 | McpListSection |
| Commands | LibraryHeader（搜索/New） | Header 内 | 新建 | 插入 | CommandListSection |

### B.2 差异点

1. **搜索位置分裂**：Skills 的搜索在内容区顶部（`px-4 py-2.5` 独立行），其余 4 个 tab 在 Header 内——同一面板内搜索入口位置不一致。
2. **工具栏形态分裂**：Skills 独享内容区工具栏（SkillHeader：Create/Install/Scan/Meta），其余用 LibraryHeader（搜索+New）——新建入口、操作按钮形态不一致。
3. **操作语义不一**：列表行操作按钮（插入/运行/测试/编辑/删除）分布与配色需统一语义。
4. **空/加载/错误态覆盖不全**：Actions/MCP/Commands 的空态与错误重试不如 Prompts 完整。

### B.3 交互统一方案

1. **统一四要素骨架**：每个 tab 都具备「搜索 + 主操作 + 列表 + 空/加载/错误态」四要素，位置一致（搜索在 Header，主操作在 Header 右侧，列表在内容岛）。
2. **Skills 特殊操作收纳**：Skills 的 Install/Scan/Meta 属于技能专属能力，保留在内容区工具栏，但**视觉样式对齐**（搜索框 h-8 rounded-lg、按钮 h-7 text-xs、内边距 px-4）——交互骨架一致，仅多技能专属操作，可接受。
3. **统一列表操作样式**：`insert`（accent-blue 主按钮）、`run`（accent-green）、`edit/delete`（secondary 次要）三类语义色统一；行操作按钮尺寸统一 `h-7 px-2.5 text-xs`。
4. **补齐状态**：Actions/MCP/Commands 列表补 loading / empty / error 三态（对齐 PromptListSection 模式）。
5. **统一工具栏内边距与字号**（配合 A 部分 S4/S5）。

---

## C. 落实范围（本轮实现）

- **A 部分 S1-S5**：LibraryPanel / LibraryHeader / SkillsTabContent 的岛屿、间隙、搜索框、工具栏样式对齐主题（本轮落实）。
- **B 部分 B.3-1/2/3**：样式层统一 + Skills 工具栏视觉对齐（本轮落实）；空态补齐（B.3-4）视改动面评估，必要时登记为后续任务。
- 左栏行为（评审反馈 ②）：打开 library 时收起 Dock 左栏（projects 面板不显示），关闭时恢复——见 `design.md` §3.4 与 dockStore 改动。

---

## D. 后续实测反馈处理（搜索重叠 + Tags 单选）

> 落实后实测发现两个体验问题，均已修复。

### D.1 Skill tab 搜索框重叠

- **现象**：Library 的 Skills tab 渲染两层 header —— `LibraryDetail` 自带「面包屑行 + 搜索行」，`SkillContent`（内容区）内部又自带「标题 + 搜索 + 操作按钮」工具栏，两个搜索框（`libraryStore.searchQuery` vs `skillStore.searchQuery`）垂直堆叠。
- **处理（方案 A：Skill tab 自包含）**：
  - `LibraryDetail.tsx`：搜索行改为 `activeKind !== 'skill'` 才渲染（Skills 搜索由 `SkillContent`/`SkillHeader` 内嵌搜索承担）；
  - 面包屑行动作按钮 skill case 返回 `null`（New/Install/Refresh 移除，交 `SkillContent` 的 Create/Install/Scan/Meta），面包屑仅保留「Skills / Installed」上下文文本；
  - 清理因此失效的 `handleRefresh` / `handleInstall` / `btnIcon` / `RefreshCw` / `refresh*` 变量。
- **影响**：仅 Library 的 Skills tab 变化；Dock skills 面板（无 LibraryDetail 包裹）不受影响；Prompts/Actions/MCP/Commands 仍用外层搜索行。

### D.2 左侧 Tags 单选

- **现象**：`LibrarySidebar` 的 Tags 区块沿用 `toggleTagFilter`（多选切换），与 Scope 区块的单选语义不一致。
- **处理**：`LibrarySidebar.tsx` 改用 `setTagFilter` 实现单选 —— 点击某 tag → `[tag]`（替换），再次点击同一 tag → `[]`（取消）。`libraryStore.toggleTagFilter` 保留（skill 侧 `TagCloudFilter` 仍在用多选）。
- **一致性**：`LibraryDetail.tsx` breadcrumb `#${tagFilter[0]}` 只取首 tag，单选后天然一致。

> 校验：`tsc --noEmit`、`eslint`、全量 vitest（115 文件 / 997 测试）均通过。
