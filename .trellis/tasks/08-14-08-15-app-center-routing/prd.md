# App.tsx 组合根重构：单一视图路由 + AppCenter + 激活挂载 + 职责下沉

## Goal

解决 App.tsx「组合根混入业务视图路由 + dock 按钮装配 + 全局副作用」，以及中心视图
「双路由源（appViewStore vs dockStore skillsActive）+ 死变体 'skills' + SkillContent
常驻挂载/启动即取数」的问题。

## Requirements

1. **单一中心路由源**：中心区域只读 `appViewStore.appView` 路由；`skills` 成为活跃
   AppView（非死变体），由 dockStore 中心耦合面板（`DOCK_PANEL_TO_APP_VIEW`）激活时同步。
2. **AppCenter 组件**：`src/app/components/AppCenter.tsx` 承载视图路由 switch，
   从 App.tsx 移除 37 行 centerContent。
3. **SkillContent 激活挂载**：仅 `appView === 'skills'` 时挂载（消灭启动即取数）；
   ProjectWorkspace 保持挂载（hidden 切换，避免来回重挂载）。
4. **dock 按钮装配下沉**：`UseDockBarButtons.tsx`（filter/sort/render），App.tsx 不再内联。
5. **全局副作用下沉**：`useMenuPaste`、`startQuickOpenActivityTracking` 并入 useAppShell。
6. **启动同步**：dockStore 持久化 vs appViewStore 不持久化 → useAppShell 启动时把
   左 zone skills 激活态同步回 appView。
7. **TDD**：所有新增逻辑带测试；行为保持（除激活门控/路由统一外）。

## Constraints

- App.tsx 保持「组合层」职责（AGENTS.md）：只做 hooks + JSX 编排。
- 共享/公共组件不含业务逻辑。
- 文件命名遵守 check-file 规则（`.tsx` → PASCAL_CASE）。
- 不提交代码；不触碰并发进程的未提交文件。

## Acceptance Criteria

- [x] `AppView` 的 'skills' 由死变体变为活跃值，写入方仅 dockStore 中心耦合面板同步
- [x] `AppCenter` 只读 appView 路由四视图；skills 下 SkillContent 激活挂载、workspace 保持挂载
- [x] `togglePanel`/`activatePanel`/`closePanel`/`movePanel` 的 appView 同步正确（含库视图退出）
- [x] 启动时持久化 skills 激活态同步回 appView
- [x] App.tsx 不再包含 centerContent switch / 按钮装配 / 全局副作用
- [x] dockStore.test（+6）、UseDockBarButtons.test（+3）、AppCenter.test（+5）全绿
- [x] pnpm lint / lint:fe / type-check / test:run 全绿
- [x] spec 同步：directory-structure / state-management 更新

## Follow-ups（后续 scope 观察项）

### 固定面板与 TitleBar actions 收敛到统一 panel 组织（方案 C）

**现状不对称**：dock 侧 8 面板已走 `dockPanelRegistry`（集中注册 + lazy chunk + `DockZone` 渲染），App.tsx 零感知；但固定底部面板与 TitleBar 入口仍直接编排 ——

- App.tsx 直接 `import { TaskConsolePanel, DebugPanel }` + 手工渲染在布局底部；
- `<TitleBar actions>` 直接塞 `OpenIdeButton / TaskRunButton / DebugRunButton`。

**问题本质**（OCP）：每加一个固定面板（unified task hub 任务面板、agent chat 等）需改组合根三处（import + JSX + TitleBar 按钮）；dock 侧加面板只改 `registry.ts` 一处，两套心智模型。价值是变更隔离而非行数（App.tsx 仅 ~75 行）。

**目标形态**（与 dock wrapper 重构模式对称）：

```
src/app/panels/
  registry.tsx          # fixedPanelRegistry：集中声明 + lazy(() => import(...))
  FixedPanelsHost.tsx   # 按 registry 渲染（挂载点：布局底部 flex 槽位）
  titleBarRegistry.tsx  # 入口按钮注册（或并入同一 registry，slot 字段区分）
```

- 新增固定面板 = registry 加一项，组合根零改动；
- 顺带收益：TaskConsole / Debug 面板代码 lazy 化（现直接 import 在主 chunk，对齐 dock「打开才加载」原则）；
- **边界**：全局浮层（QuickOpenPalette / SymbolNavPalette / AppModals）为 keyboard 触发 overlay、无固定槽位，保持 App.tsx 直接挂载，不强行 registry 化 —— 「组装结构」（Providers/Layout/StatusBar 层级）仍属组合根职责。

**触发时机**：下一次新增固定面板或 TitleBar 入口时实施；实施时更新本 AC（FixedPanelsHost 单测：registry 渲染 + lazy 加载断言）。
