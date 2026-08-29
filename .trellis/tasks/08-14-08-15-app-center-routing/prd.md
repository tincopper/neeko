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

### 固定面板与 TitleBar actions 收敛到统一 panel 组织（方案 C）✅ 已实施

**现状不对称**：dock 侧 8 面板已走 `dockPanelRegistry`（集中注册 + lazy chunk + `DockZone` 渲染），App.tsx 零感知；但固定底部面板与 TitleBar 入口仍直接编排 ——

- App.tsx 直接 `import { TaskConsolePanel, DebugPanel }` + 手工渲染在布局底部；
- `<TitleBar actions>` 直接塞 `OpenIdeButton / TaskRunButton / DebugRunButton`。

**问题本质**（OCP）：每加一个固定面板（unified task hub 任务面板、agent chat 等）需改组合根三处（import + JSX + TitleBar 按钮）；dock 侧加面板只改 `registry.ts` 一处，两套心智模型。价值是变更隔离而非行数（App.tsx 仅 ~75 行）。

**目标形态**（与 dock wrapper 重构模式对称）：

```
src/app/panels/
  registry.ts          # fixedPanelRegistry：集中声明 + lazy(() => import(...))
  FixedPanelsHost.tsx  # 按 registry 渲染（挂载点：布局底部 flex 槽位）
  TitleBarActions.tsx  # 入口按钮收敛（轻组件直接 import，不 lazy 避免闪烁）
```

**已实施（2026-08-28）**：
- [x] `src/app/panels/registry.ts` + `FixedPanelsHost.tsx` + `TitleBarActions.tsx` 落地；App.tsx 移除全部固定面板/入口按钮 import
- [x] 固定面板 lazy 化（TaskConsole/Debug 不再进主 chunk，对齐 dock「打开才加载」）；按钮保持直接 import（轻组件）
- [x] `FixedPanelsHost.test`（3 用例：registry 渲染 + 清单唯一 + 定义完整）+ `TitleBarActions.test`（1 用例）全绿
- [x] 新增固定面板 = registry 加一项，组合根零改动
- **边界**：全局浮层（QuickOpenPalette / SymbolNavPalette / AppModals）为 keyboard 触发 overlay、无固定槽位，保持 App.tsx 直接挂载，不强行 registry 化 —— 「组装结构」（Providers/Layout/StatusBar 层级）仍属组合根职责。

### 布局架构设计说明：岛屿是视觉语言，不是架构原则（设计决策）

**背景**：DockLayout 注释定位为「IDEA 2026 Islands design」（bg-primary 作海、面板作浮岛：圆角 + 边框 + 间距）。分析发现「怪」的深层来源 —— 岛屿是**视觉/皮肤层**（决定看起来像什么），却被实现成了**结构层**（每个岛独立挂载），导致布局骨架缺失、面板双体系割裂。

**现状布局树（双体系割裂）**：

```
App (组合根)
├── TitleBar (Provider 外)              ← 窗口框架①
├── AppProviders
│   └── DockRegistryProvider
│       ├── AppLayout → DockLayout       ← 主工作区：三栏 Grid（left/center/right）
│       │     └── DockZone(left/right)  ← dock 面板：可拖拽/收起/宽度记忆
│       ├── FixedPanelsHost              ← 底部外挂（DockLayout 外，无 zone 能力）
│       └── StatusBar                    ← 窗口框架②
```

**核心判断（视觉模式 ≠ 架构原则，需正交）**：
- 布局架构（怎么管）：Shell 分区 / zone·panel 宿主 / registry·生命周期
- 视觉语言（长什么样）：岛屿皮肤（圆角 / 间距 / 悬浮）
- 正确公式：**「区域即岛屿」** —— 布局骨架定义 4 分区（left/center/right/bottom），每个分区渲染成岛屿外观；面板进分区即获得岛的外观 + zone 能力。岛屿只是皮肤，分区管理仍归统一骨架。参照：Linear / Zed / IDEA 2026 均浮岛视觉 + 统一 shell grid。
- **反例（当前）**：岛屿直觉「每个面板独立悬浮」→ 每个岛独立挂载 → 无统一骨架、底部面板像布局外的一块砖。

**三个根因**：
1. **无 AppShell 概念**：窗口骨架（TitleBar/工作区/StatusBar）散落，无单一组件描述「窗口长什么样」；App.tsx 同时做 Provider 装配 + 手写骨架。
2. **面板双体系割裂**：dock 面板（registry + zone + 拖拽/收起）vs 底部固定面板（registry 化但无 zone 能力、钉在布局外）—— 同为工具面板，能力不一致。
3. **布局能力未扩展为全分区 Grid**：DockLayout 已是正确雏形（zone + 拖拽 + 折叠）但只覆盖左右；bottom 被排除在布局引擎外。

**理想目标形态（业界对齐）**：

```
src/app/shell/          # 窗口骨架层：AppShell = TitleBar + Workspace + StatusBar
src/app/panels/         # 统一面板体系：registry [{ id, placement: 'left'|'right'|'bottom' }]
                        # PanelHost 按 placement 渲染；面板可跨区移动（VS Code view container）
```

```
App = 装配 Provider + <AppShell/>
└── AppShell
    ├── TitleBar
    ├── Workspace → DockLayout 演化：4 分区 Grid（left/center/right/bottom）
    │     └── 每区 = PanelHost(placement)（bottom 区收纳 TaskConsole/Debug，享受收起/拖拽）
    └── StatusBar
```

**分阶段落地**（不必一次到位）：
- 阶段 1 ✅ 已完成：面板清单 registry 化（FixedPanelsHost / TitleBarActions）—— 解决 OCP，但未消除双体系割裂
- 阶段 2 ⭐ 推荐下一步：底部并入 DockLayout（加 bottom 区域，FixedPanelsHost 从「App 根外挂」变「bottom zone host」）—— 消除怪感；与 `07-26-unified-task-hub`（任务面板进 bottom）契合，也复用 `useDockZoneResize` 观察项
- 阶段 3 远期：统一 panelRegistry（placement）+ 面板跨区移动（VS Code 级）

**教训固化**：后续加面板时，先问「这个面板属于哪个区域（placement）」，再问「它长什么样（岛屿皮肤）」—— 区域由布局骨架管理，皮肤由区域样式提供，二者不得混淆。
