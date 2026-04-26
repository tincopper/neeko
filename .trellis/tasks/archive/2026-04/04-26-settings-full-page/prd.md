# 设置页从弹窗改为全页视图

## Goal

将当前设置页面的模态弹窗（720×480px 固定尺寸）改为类似 Skills 面板的全页视图，占据主内容区域，提供更宽敞的设置体验。

## Requirements

* 点击 ActivityBar 齿轮图标后，设置以全页视图呈现，占据主内容区域（替换而非叠加）
* 复用 Skills 面板的布局模式：左侧 PanelArea（导航） + 右侧主内容区（子面板内容）
* 保留现有的 6 个设置分类及其内容：Appearance / Editor / Terminal / Agents / IDE / Git
* 设置导航栏放在左侧 PanelArea 中，子面板内容放在右侧主内容区
* 保留配置保存/持久化逻辑（`invoke("save_config")`）
* 退出方式：点击 ActivityBar 齿轮图标切换开关 + 设置页顶部返回按钮
* 每次打开设置页默认定位到 Editor 面板（不记忆上次位置）
* 与 Skills 全页模式保持布局一致性
* **[UX]** 设置内容区添加 `max-w-3xl`（~768px）约束，防止全页宽度下内容过散、行宽过长（`line-length` 准则：65-75 字符/行）
* **[UX]** 齿轮图标在设置页打开时显示 active 高亮状态（复用 `SidebarMenuButton` 的 `isActive` 白色左侧竖条指示器），给用户位置感
* **[UX]** 所有交互元素（导航按钮、返回按钮、表单控件）必须有可见焦点环 `focus:ring-2`，不可使用无替代的 `outline-none`（`focus-states` 准则）
* **[UX]** 视图切换使用 `transition-opacity duration-200`，并通过 `motion-safe:` 前缀尊重 `prefers-reduced-motion`（`duration-timing` + `reduced-motion` 准则）
* **[UX]** 返回按钮点击后回到上一个 activePanel（projects/files/skills），而非固定页面
* **[shadcn]** 所有面板标题从 `<div>` 改为 `<h3>` 语义标签，维持正确的 heading 层级（`h1→h2→h3`），确保屏阅读器可通过 heading 导航（`composition.md`: heading hierarchy）
* **[shadcn]** 安装 `Separator` 组件（`npx shadcn@latest add separator`），替换所有设置面板中裸 `<div className="border-b border-border">` 作为视觉分割线（`composition.md`: Use `Separator`）
* **[shadcn]** 安装 `Switch` 组件（`npx shadcn@latest add switch`），将 AgentsPanel 的 "Show Agent Bar" 和 "Compact Mode" 从 `<Button variant="primary|ghost">` 模拟 toggle 改为语义化的 `Switch` 开关（`forms.md`: 表单控件使用专用组件）
* **[shadcn]** 安装 `ToggleGroup` 组件（`npx shadcn@latest add toggle-group`），将 GitPanel 的 Unified/Split 手写 toggle buttons 改为 `ToggleGroup` + `ToggleGroupItem`（`forms.md`: "2–7 options → `ToggleGroup`"）
* **[shadcn]** 全项目 `w-* h-*` 等宽等高处统一替换为 `size-*`（如 `w-7 h-7` → `size-7`），涉及 5 个面板共 12 处（`styling.md`: Use `size-*` when width and height are equal）
* **[shadcn]** Input 组件的焦点指示从仅改变 `border-color` 升级为 `focus:ring-2 focus:ring-accent-blue`，确保键盘用户可见（`styling.md` + `ux`: `focus:ring-2` 比仅改变 border-color 更可见）

## Acceptance Criteria

* [ ] 点击 ActivityBar 设置图标 → 主内容区切换为全页设置视图
* [ ] 齿轮图标在设置页打开时显示 active 高亮（左侧白色竖条）
* [ ] 视图切换有 200ms opacity 过渡动画
* [ ] 6 个设置分类子面板全部可正常显示和交互（内容区有 `max-w-3xl` 约束，布局合理）
* [ ] 设置修改可正常保存（`save_config` 调用正常）
* [ ] 可通过再次点击齿轮图标退出设置页
* [ ] 设置页顶部有返回按钮，点击退出并回到上一个 activePanel
* [ ] 退出后回到项目/文件视图，页面无异常
* [ ] 所有交互元素有可见焦点环（Tab 键导航可达、逻辑顺序正确）
* [ ] `prefers-reduced-motion` 时视图切换无动画
* [ ] 现有 Setting 弹窗逻辑从 `AppModals.tsx` 移除
* [ ] 所有面板标题为 `<h3>` 语义标签，heading 层级正确
* [ ] `Separator` 组件已安装并使用（替换裸 border-b div）
* [ ] `Switch` 组件已安装，AgentsPanel 开关使用 `Switch`
* [ ] `ToggleGroup` 组件已安装，GitPanel diff 模式使用 `ToggleGroupItem`
* [ ] 全项目 `w-* h-*` 等宽等高替换为 `size-*`
* [ ] Input 焦点指示从 border-color 升级为 `focus:ring-2`
* [ ] 现有测试更新后仍通过

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Technical Approach

**布局模式**：在 `AppLayout.tsx` 中增加 `settingsActive` 分支，与 Skills 的两栏模式一致：

```
settingsActive ?
  <PanelArea><SettingsNav /></PanelArea>
  <div className="flex-1 ..."><SettingsContent /></div>
  : <正常的项目/文件视图>
```

**与 Skills 模式的差异**：Settings 的 `settingsOpen` 来自 `useAppConfig`（非 sidebar context），因此在 `AppLayout` 中需要从 props 接收。

**焦点与动画规范**：

| 元素 | CSS 规范 |
|------|----------|
| 设置导航按钮 | `focus:ring-2 focus:ring-accent-blue focus:ring-offset-1` |
| 返回按钮 | `focus:ring-2 focus:ring-accent-blue` |
| 表单控件 | 保留现有 Tailwind focus 样式，补齐 `focus:ring-2` |
| 页面切换容器 | `transition-opacity duration-200 motion-safe:transition-opacity` |
| 齿轮图标 active | `isActive={settingsOpen}` 传给 `SidebarMenuButton` |

**shadcn 组件变动**：

| 组件 | 操作 | 用途 | npm 依赖 |
|------|------|------|----------|
| `Separator` | 新增安装 | 替代面板中裸 `border-b` div | `@radix-ui/react-separator` |
| `Switch` | 新增安装 | AgentsPanel 开关 | `@radix-ui/react-switch` |
| `ToggleGroup` | 新增安装 | GitPanel diff 模式选择 | `@radix-ui/react-toggle-group` |
| `Input` | 修改 | 焦点样式升级 `focus:ring-2` | — |

**关键改动文件**：

| 文件 | 改动 |
|------|------|
| `src/components/layout/AppLayout.tsx` | 新增 `settingsActive` prop + 分支渲染；Settings 两栏布局 |
| `src/components/layout/ActivityBar.tsx` | 接收 `settingsOpen` prop，齿轮按钮加 `isActive` |
| `src/components/settings/SettingsPanel.tsx` | 拆分为 `SettingsNav` + `SettingsContent`；移除弹窗 wrapper；添加返回按钮 |
| `src/components/settings/AppearancePanel.tsx` | `<div>` → `<h3>`；`w-7 h-7` → `size-7`；`border-b` → `Separator` |
| `src/components/settings/EditorPanel.tsx` | `<div>` → `<h3>`；`w-7 h-7` → `size-7`；`border-b` → `Separator` |
| `src/components/settings/TerminalPanel.tsx` | `<div>` → `<h3>`；`w-7 h-7` → `size-7`；`border-b` → `Separator` |
| `src/components/settings/AgentsPanel.tsx` | `<div>` → `<h3>`；`Button` toggle → `Switch`；`border-b` → `Separator` |
| `src/components/settings/IDE Panel.tsx` | `<div>` → `<h3>`；`border-b` → `Separator` |
| `src/components/settings/GitPanel.tsx` | `<div>` → `<h3>`；手写 toggle → `ToggleGroup`；`border-b` → `Separator` |
| `src/components/ui/input.tsx` | 焦点样式 `focus:border-accent-blue` + `focus:ring-2 focus:ring-accent-blue` |
| `src/AppModals.tsx` | 移除 SettingsPanel 弹窗渲染 |
| `src/hooks/useAppContainer.ts` | 传递 `settingsOpen` 给 AppLayout 和 ActivityBar |
| `src/App.tsx` | 同步调整 props 透传链路 |
| `src/components/__tests__/SettingsPanel.test.tsx` | 适配新的组件结构 |

## Decision (ADR-lite)

**Context**：设置弹窗固定 720×480px，内容显示空间受限，6 个子面板内容拥挤。同时现有设置页存在多项 shadcn/ui 规范违规（非语义标签、裸 border-b 分割线、Button 模拟 toggle、缺少 Switch/ToggleGroup 组件）。

**Decision**：采用与 Skills 面板一致的全页两栏布局。左侧 PanelArea 容纳设置导航，右侧 flex-1 主内容区（含 `max-w-3xl` 约束）容纳子面板内容。齿轮图标增加 active 状态下左侧白色竖条指示器（复用 `SidebarMenuButton.isActive`）。同步安装 `Separator`、`Switch`、`ToggleGroup` 三个 shadcn 组件并应用到对应面板。

**Consequences**：
- 正面：内容展示空间充足，与 Skills 面板交互模式一致，降低用户认知负担
- 正面：`max-w-3xl` 防止超宽屏幕下内容过散，符合行宽最佳实践
- 正面：焦点环 + 过渡动画提升可访问性和体验
- 正面：shadcn 组件规范化提升代码质量和一致性
- 风险：SettingsPanel 组件需拆分为导航和内容两部分，但内部子面板逻辑无需改动
- 风险：需要确保设置页打开时正确隐藏项目/文件视图
- 风险：新装 `Switch`/`ToggleGroup` 需额外安装 `@radix-ui/react-switch`、`@radix-ui/react-toggle-group` 依赖

## Out of Scope

* 新增设置项或修改现有设置逻辑
* 重构 `useAppConfig` 状态管理（如迁移到 Zustand）
* 将 Settings 整合进 sidebar context 的 `activePanel` 体系
* 响应式布局（本项目仅桌面端）
* URL 路由/hash
* 记住上次打开的子面板位置

## Implementation Plan (small PRs)

* **Step 1**: 安装 shadcn 组件（`separator`、`switch`、`toggle-group`）+ 升级 `Input` 焦点样式 + 全项目 `w-* h-*` → `size-*` 机械替换
* **Step 2**: `AppLayout.tsx` + `ActivityBar.tsx` + `AppModals.tsx` 改动（新增分支、移除弹窗、齿轮 active）
* **Step 3**: 将 `SettingsPanel.tsx` 拆分为导航组件 + 内容组件（适配全页两栏 + max-w-3xl + 焦点环 + 过渡动画）
* **Step 4**: 6 个子面板 shadcn 规范化（h3 标题 + Separator + Switch/ToggleGroup 替换 + border-b 清理）
* **Step 5**: 添加返回按钮逻辑（回到上一个 activePanel）+ 更新测试

## Technical Notes

* **当前弹窗实现**：`src/components/settings/SettingsPanel.tsx`（202 行）
* **状态 hook**：`src/components/settings/useSettingsPanelState.ts`（408 行）
* **导航常量**：`src/components/settings/constants.ts`（152 行）
* **子面板**：AppearancePanel / EditorPanel / TerminalPanel / AgentsPanel / IDE Panel / GitPanel
* **触发逻辑**：`src/hooks/useAppContainer.ts:333-335` `handleToggleSettings`
* **状态**：`src/hooks/useAppConfig.ts:30` `settingsOpen` state
* **弹窗渲染**：`src/AppModals.tsx:78-83`
* **全页参考**：`src/components/layout/AppLayout.tsx:48-56` Skills 分支模式
* **ActivityBar active 模式**：`src/components/ui/sidebar.tsx:109-129` `SidebarMenuButton.isActive`（左侧白条）
* **App 布局**：`src/App.tsx` → `AppLayout` → `ActivityBar` + 内容区
* **sidebar context**：`src/contexts/sidebar-context.tsx` — `activePanel` 类型 `"projects" | "files" | "skills"`，Settings 不在其中
* **数据流调整**：`useAppConfig.settingsOpen` → `useAppContainer` → `AppLayout` / `ActivityBar` / `AppModals`
* **shadcn 安装命令**：
  ```bash
  npx shadcn@latest add separator switch toggle-group
  ```
* **npm 新依赖**：`@radix-ui/react-separator`、`@radix-ui/react-switch`、`@radix-ui/react-toggle-group`
* **`size-*` 替换范围**（12 处）：AppearancePanel(4), EditorPanel(4), TerminalPanel(4), AppearancePanel 主题卡片中也有 `w-16 h-10`

## UI/UX 审查记录

基于 UI/UX Pro Max skill 审查（design system + UX + accessibility + animation 领域搜索），发现 6 个问题并全部纳入 Requirements：

| # | 问题 | 严重度 | 解决 |
|---|------|--------|------|
| 1 | 全页宽度下内容过散、行宽过长 | HIGH | 内容区 `max-w-3xl` |
| 2 | 缺少焦点可见性（导航/按钮/表单） | CRITICAL | 全局 `focus:ring-2` |
| 3 | 齿轮图标无 active 高亮，用户迷路 | MEDIUM | `SidebarMenuButton.isActive` |
| 4 | 视图切换无过渡动画，突兀 | MEDIUM | `transition-opacity duration-200` |
| 5 | 返回按钮未定义回到哪里 | MEDIUM | 回到上一个 activePanel |
| 6 | 未处理 `prefers-reduced-motion` | MEDIUM | `motion-safe:` 前缀 |

## Shadcn/ui 审查记录

基于 shadcn/ui skill 审查（`styling.md` / `forms.md` / `composition.md` / `icons.md` 四项规则），逐审计 6 个子面板 + 导航容器，发现 6 个问题并全部纳入 Requirements：

| # | 问题 | 规则来源 | 严重度 | 解决 |
|---|------|----------|--------|------|
| 1 | 面板标题用 `<div>` 而非 `<h3>` | `composition.md`: heading hierarchy | HIGH | 6 个子面板标题改为 `<h3>` |
| 2 | `w-7 h-7` / `w-[18px] h-[18px]` 未使用 `size-*` | `styling.md`: Use `size-*` when equal | MEDIUM | 12 处 `size-7` / `size-[18px]` |
| 3 | 裸 `<div class="border-b">` 作分割线 | `composition.md`: Use `Separator` | MEDIUM | 安装 `Separator` 组件替代 |
| 4 | Button 模拟 on/off toggle | `forms.md`: 使用专用表单控件 | MEDIUM | 安装 `Switch` 组件 |
| 5 | GitPanel 手写 toggle group | `forms.md`: 2–7 options → `ToggleGroup` | MEDIUM | 安装 `ToggleGroup` 组件 |
| 6 | Input 焦点仅 border-color 无 ring | `styling.md`: `focus:ring-2` | MEDIUM | 升级为 `focus:ring-2 focus:ring-accent-blue` |
