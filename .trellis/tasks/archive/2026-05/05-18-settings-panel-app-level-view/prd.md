# Settings Panel 提升为 App-Level View

## Goal

将 Settings Panel 从 EditorGroupPane 内的 Tab 提升为应用级全屏视图，与 Skills 同层级。采用两栏布局（左侧分类导航 + 右侧内容区），通过独立的 `appViewStore` 驱动视图切换，重写面板样式以适配更大空间。

## Requirements

### 架构层

- 新建 `appViewStore`（zustand），管理 `appView: "normal" | "skills" | "settings"` 状态
- 将 Skills 的激活判断从 `dockStore.zones.left.activePanelId === "skills"` 迁移到 `appViewStore`
- `AppLayout.tsx` 改为三路分支：normal → MainContent / skills → SkillContent / settings → SettingsView
- 完全移除旧 Settings Tab 机制：删除 `TabKind` 中的 `"settings"`、`handleToggleSettings` 中创建 tab 的逻辑、EditorGroupPane 中 settings 渲染分支

### 视图层

- Settings 只替换 MainContent 中心区域，左侧 ProjectsPanel sidebar 保留不变
- 两栏布局：左侧分类导航（固定宽度）+ 右侧内容区
- 右侧内容区 max-width 640px，左对齐
- 左栏顶部搜索框，过滤导航项（模糊匹配分类名称）
- 导航平铺 7 个分类：Appearance、Editor、Terminal、Agents、IDE、Git、Shortcuts（不分组）
- 无过渡动画，即时切换

### 交互

- 入口：底部 Toolbar 齿轮按钮（行为从"创建 settings tab"改为"切换 appView 到 settings"）
- 出口：左上角 Back 按钮 + Escape 快捷键，返回 `appView: "normal"`

### 面板样式重写

- 利用全屏空间做更舒展的排版（更大间距、更清晰的视觉层次）
- 混合布局：简单设置项（开关、下拉、数字输入）采用行式布局（label-left / control-right）；复杂设置项（Agent 列表、快捷键录制）保持块式布局
- 各面板组件逻辑可复用（useSettingsPanelState hook 等），但 JSX/样式需要重写

## Acceptance Criteria

- [ ] 齿轮按钮点击后中心区切换为全屏 Settings 视图（ProjectsPanel sidebar 保留）
- [ ] Back 按钮和 Escape 均可返回正常视图
- [ ] 左栏导航可切换 7 个分类面板
- [ ] 搜索框输入可过滤左栏导航项
- [ ] 所有设置项功能与之前等价（读取/保存/副作用均正常）
- [ ] Skills 视图切换功能不受影响（迁移到 appViewStore 后行为一致）
- [ ] 旧的 settings tab 相关代码完全清除，无残留
- [ ] 简单设置项使用行式布局，复杂项使用块式布局
- [ ] 内容区 max-width 640px 生效，大屏右侧留白

## Definition of Done

- 类型检查通过 (`npx tsc --noEmit`)
- 前端测试通过 (`pnpm test`)
- `pnpm tauri dev` 可正常运行，Settings 视图功能完整
- 旧 settings tab 测试更新或移除

## Technical Approach

### 新增文件

- `src/store/appViewStore.ts` — zustand store，管理 appView 状态
- `src/components/settings/SettingsView.tsx` — 全屏 Settings 视图壳（两栏布局 + Back 按钮）

### 修改文件

- `src/components/layout/AppLayout.tsx` — 三路分支渲染
- `src/hooks/useAppContainer.ts` — `handleToggleSettings` 改为切换 appView
- `src/hooks/useKeyboardShortcuts.ts` — Escape 处理适配新逻辑
- `src/types/tab.ts` — 移除 `"settings"` TabKind
- `src/components/layout/EditorGroupPane.tsx` — 移除 settings 渲染分支
- `src/components/settings/SettingsPanel.tsx` — 重构为两栏全屏布局
- `src/components/settings/constants.ts` — 导航项加搜索关键词
- `src/components/settings/*.tsx` — 各面板样式重写（行式/块式混合）
- `src/components/__tests__/SettingsPanel.test.tsx` — 更新测试

### 迁移策略

1. 先建 appViewStore + 迁移 skills 判断，确保 skills 不受影响
2. 实现 SettingsView 壳 + 接入 appViewStore
3. 移除旧 tab 机制
4. 重写各面板样式

## Decision (ADR-lite)

**Context**: Settings 作为 Tab 存在于 EditorGroupPane 内，层级不符合其"应用全局配置"的语义定位，且 720x480 modal 空间受限。

**Decision**: 提升为与 Skills 同层级的 App-Level View，通过独立 appViewStore 驱动三路视图切换。保留左侧 sidebar，Settings 只接管中心区。

**Consequences**:
- 需要迁移 Skills 激活逻辑到新 store（有破坏风险，需验证）
- 移除旧 tab 机制是不可逆的，确保无其他代码依赖 settings tab
- 面板样式重写工作量较大，但不影响底层逻辑

## Out of Scope

- 中栏子列表（Agents/IDE 下的实体列表）
- 导航分组（小标题分隔）
- 设置项粒度的搜索（只做分类过滤）
- 过渡动画
- 新增设置项或分类

## Technical Notes

- 参考 UI：GitButler Settings 全屏三栏布局（本次简化为两栏）
- Skills 当前判断逻辑在 `AppLayout.tsx`：`dockStore.zones.left.activePanelId === "skills"`
- Settings 打开逻辑在 `useAppContainer.ts:444-474`（handleToggleSettings）
- 各面板组件已稳定：`src/components/settings/` 目录下 7 个面板 + useSettingsPanelState hook
- 持久化层无需改动（useAppConfig + Rust storage 不变）
