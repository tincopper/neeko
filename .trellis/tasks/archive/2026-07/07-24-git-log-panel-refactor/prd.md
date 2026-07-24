# Git Log 面板重构优化

## Goal

将 Git Log 从当前「中心编辑器 Tab」模式重构成「右侧 Dock 面板」模式，与 Git Commit、PRs 等面板平级。Diff 预览改为单例 Tab 复用机制，支持单文件 / 组合查看两种模式。

## Requirements

### 核心交互变更

1. **Git Log 变为右侧 Dock 面板**
   - 打开 Git Log 不再创建中心 `gitLog` tab，而是打开右侧面板（与 gitCommit 同级）
   - Dock bar 添加 `gitLog` panelId，默认 zone 为 right
   - 面板内包含：搜索栏 + Commit Graph + Commit 列表 + 内联展开详情 + 文件列表
   - 面板与中心编辑器 Tab 无关，关闭面板不影响编辑器 Tab

2. **Diff Tab 单例复用**
   - 中心编辑器仅维护**一个** `Diff` tab（id: `diff_singleton`），所有文件切换复用该 tab
   - 单击 Git Log 面板中的文件 → 复用该 Diff tab，内容切换到该文件
   - 同一 commit 内切换文件不新增 tab，只刷新内容
   - 不同 commit 间切换时，若 Diff tab 已打开则刷新上下文

3. **组合查看（Combined Mode）**
   - 面板头部提供「组合」开关
   - 开启后，Diff tab 显示当前 commit 所有文件的纵向滚动视图
   - 在组合模式下点击文件列表 → 滚动定位到该文件的 diff block（而非切换 tab 内容）
   - 关闭组合模式回到单文件模式

4. **Commit 内联展开/折叠**
   - 点击 commit 行 → 展开内联详情（hash、subject、author、parents、文件列表）
   - 再次点击同一 commit → 折叠详情
   - 点击展开区域内的文件、链接等不触发折叠
   - 点击另一个 commit → 展开新的 commit，折叠前一个

5. **双文件逃生舱**
   - 双击文件 → 钉住一个独立的 diff tab（id: `diff_pinned_<path>`，不占用 Diff 单例）
   - 用于对比两个文件的场景

### 非功能要求

1. 遵循高内聚、低耦合、可扩展原则
2. 保留现有 Commit Graph 多泳道渲染
3. 键盘快捷键：J/K 切换 commit，j/k 切换文件，c 切换组合
4. 面板跨 session 持久化状态（panelId 持久化已有 dockStore 支持）
5. Diff Tab 单例状态不跨 session 持久化（打开时重建即可）

## Acceptance Criteria

- [ ] Dock bar 可打开/关闭 Git Log 面板，面板位置在右侧
- [ ] 面板内显示 commit graph + commit 列表
- [ ] 点击 commit 展开内联详情（hash、subject、author、文件列表），再次点击折叠
- [ ] 单击文件复用中心 Diff tab，内容切换到该文件
- [ ] 组合查看开关生效，Diff tab 纵向滚动显示所有文件
- [ ] 双击文件钉住独立 diff tab（不占用 Diff 单例）
- [ ] 不同 commit 间切换刷新 Diff tab 上下文
- [ ] 面板关闭不影响 Diff tab
- [ ] Git Log 面板打开时不在中心创建 `gitLog` tab
- [ ] 键盘快捷键 J/K/j/k/c 正常工作
- [ ] 回归：现有 gitCommit 面板、PRs 面板不受影响

## Prototype

参考 `.trellis/tasks/07-24-git-log-panel-refactor/prototype.html`