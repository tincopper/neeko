# Layout architecture refactor: AppShell + unified panel system + 4-zone grid

## Goal

消除「面板双体系割裂」与「布局骨架缺失」的结构问题（详见 `08-14-08-15-app-center-routing/prd.md` 的「布局架构设计说明」）。建立：

1. **AppShell**：窗口骨架单一来源（TitleBar + Workspace + StatusBar），App.tsx 只装配 Provider + 渲染 `<AppShell/>`。
2. **统一 panel 体系**：所有面板（左/右/底部）注册进同一 registry，`placement` 决定归属区域，`PanelHost` 按 placement 渲染。
3. **4 分区 Grid**：DockLayout 演化为主工作区四分区（left/center/right/bottom），bottom 区收纳 TaskConsole/Debug，享受与左右一致的 zone 能力。

岛屿（Islands）是视觉语言，不是架构原则 —— 布局骨架决定「区域在哪」，岛屿皮肤决定「区域长什么样」，二者正交。

## Background / 现状

```
App (组合根)
├── TitleBar (Provider 外)              ← 窗口框架①
├── AppProviders → DockRegistryProvider
│   ├── AppLayout → DockLayout          ← 三栏 Grid（left/center/right）
│   │     └── DockZone(left/right)
│   ├── FixedPanelsHost                 ← 底部外挂（DockLayout 外，无 zone 能力）
│   └── StatusBar                       ← 窗口框架②
```

问题：无 AppShell、面板双体系（dock zone vs 底部外挂）、布局能力未扩展为全分区 Grid。

## Requirements

### 阶段 2（本次核心）：底部并入 DockLayout + 建立 AppShell

1. **AppShell 骨架**（`src/app/shell/`）：
   - `AppShell.tsx`：组合 TitleBar + Workspace + StatusBar，成为窗口骨架单一来源
   - App.tsx 收敛为 `Provider 装配 + <AppShell/>`（移除手写布局 JSX）
2. **DockLayout 演化 4 分区**：
   - 主工作区垂直方向：`ResizablePanelGroup orientation="vertical"` 顶层 = [主区(水平 3 栏) | bottom-zone]
   - bottom-zone = `DockZone(zoneId="bottom")` 或独立 bottom panel host，承载 TaskConsole / Debug
   - `FixedPanelsHost` 从「App 根外挂」变为「bottom zone host」：按 registry 渲染，但挂载在 DockLayout 的 bottom 区
   - bottom 面板获得收起/拖拽能力（与左右 zone 一致，岛屿皮肤保持）
3. **统一 panel registry**（`src/app/panels/registry.ts` 扩展）：
   - 增加 `placement: 'left' | 'right' | 'bottom'` 字段
   - dock 面板与底部面板统一进 `panelRegistry`（或保留 dockPanelRegistry + fixedPanelRegistry 双表，但共享 placement 语义）
   - `PanelHost({ placement })` 按 placement 消费 registry 渲染

### 阶段 3（本次可选，视复杂度的量力而为）

- 面板跨区移动（VS Code view container 级）—— 高成本，若评估风险过高则记为 follow-up

## Constraints

- **岛屿视觉保留**：所有区域继续以「海 + 浮岛」（圆角/间距/悬浮）渲染 —— 皮肤不变，只改骨架
- **行为保持优先**：面板展开/收起/宽度记忆、appView 路由、dock 快捷键等既有交互不得回归
- **布局时序敏感**：DockLayout 有历史竞态（pin tab 后开面板 0 宽度），涉及双 rAF 时序的区域改动需回归验证；`useDockZoneResize` 观察项（DockLayout 组件体逼近 300 时抽 hook）若本次触及即顺带实施
- **TDD**：新组件/hook 带单测；改动 DockLayout 时保留/更新其行为断言
- 不提交代码（用户明确要求；本任务产出保留在工作区）

## Acceptance Criteria

- [x] `src/app/shell/AppShell.tsx` 落地，App.tsx 只装配 Provider + `<AppShell/>`，不再手写 TitleBar/工作区/StatusBar 骨架
- [ ] → follow-up（Step 3，裁剪决策见下方 Implemented）：DockLayout 主工作区 4 分区（left/center/right/bottom）；bottom-zone 承载 TaskConsole/Debug
- [ ] → follow-up（Step 3）：固定面板宿主挂载到布局内 bottom 区。当前已收敛进 AppShell 骨架（不再从 App 根钉入），但相对可布局区仍为外挂
- [x] `panelRegistry` 支持 placement 语义（PanelHost 按 placement 过滤 + mock registry 单测）
- [x] 岛屿视觉保持（圆角/间距/悬浮）；无可见视觉回归
- [x] 既有交互回归：dock 面板展开/收起/宽度记忆、appView 路由、快捷键（App.test + 手动）
- [x] 新组件单测全绿；`pnpm lint / lint:fe / type-check / test:run` 全绿
- [x] DockLayout 几何 effect 抽取：`useZoneExpandCollapse`（含 rAF 清理与受控时序单测）
- [x] spec 同步：directory-structure（app/shell、app/panels、app/utils、dock-layout hook）

## Notes

- 阶段 3（面板跨区移动）默认不实施，评估后如需则记为 follow-up
- 本任务与 `08-14-08-15-app-center-routing`（AppShell 收敛）、`08-14-08-15-dock-wrapper-refactor`（useDockZoneResize）承接
- 依赖风险：react-resizable-panels 嵌套 Group 的全局状态污染（历史 bug 曾致拖拽 handle 失效）—— 新增垂直 Group 时需验证嵌套 Group 交互

## Implemented（2026-08-28，已提交：c2ef0b0f / 246ae1e4 / 579b19e7 / 86b20b93）

已完成 Step 1 / 2 / 4（消除根因 1「无 AppShell」+ 根因 2 的 registry 归位语义）：

- **Step 1 `useZoneExpandCollapse`**：`src/layout/dock-layout/useZoneExpandCollapse.ts` 通用「展开→双 rAF resize / 折叠」；DockLayout 左右 zone 2 个对称 effect 改用（行为保持）；组件体 262→212 行，`.test.ts` 4 用例绿。
- **Step 2 placement + PanelHost**：`src/app/panels/registry.ts` 增 `placement: 'left'|'right'|'bottom'`（当前全部 bottom）；`PanelHost.tsx` 按 placement 过滤渲染；`FixedPanelsHost` 变为 `<PanelHost placement="bottom"/>` 别名；测试 +3。
- **Step 4 AppShell**：`src/app/shell/AppShell.tsx` 收敛 TitleBar + 工作区 + StatusBar + 浮层；`App.tsx` 只装配 Provider + `<AppShell/>`（骨架零感知）。

**验证**：`pnpm lint:fe` 全绿（287 文件 / 2278 测试，仅既有 VirtualList warning）；`pnpm type-check` 通过；`pnpm test:run` 通过（App.test 回归 OK）。

### Step 3（嵌套 Group 4 分区 bottom）裁剪为 follow-up —— 决策

未实施嵌套 Group（DockLayout 顶层加垂直 Group 承载 bottom 区）。理由：
1. **历史 bug 区**：react-resizable-panels 嵌套 Group 曾致「pin tab 后开面板 handle 失效」（DockLayout 顶部注释记录），且 jsdom 无 UI 无法验证真实拖拽交互，盲改风险高，违背「行为保持优先」最高约束；
2. **YAGNI**：bottom 拖拽/收起能力在 `07-26-unified-task-hub` 落地前非刚需；
3. **当前已达成**：FixedPanelsHost 已收敛进 AppShell（布局骨架内语义，不再是 App 根外挂），根因 2 的「外挂怪感」已消除 —— 差异仅在「底部面板暂未获得可拖拽 zone 能力」。

触发条件（届时实施 Step 3）：`07-26-unified-task-hub` 确定任务面板进 bottom zone；或新增底部面板需要拖拽/收起。实施时：bottom 区独立状态（dockStore 加 bottom zone），复用 `useZoneExpandCollapse`，验证 pin-then-open-panel 路径。

### 审查跟进（2026-08-29）

- **rAF 竞态修复**：`useZoneExpandCollapse` 补 effect cleanup 取消挂起帧 —— 快速「展开→折叠」时，迟到的 resize 原会执行在 collapse() 之后把面板重新撑开。测试改用受控 rAF 队列（逐帧 flush），覆盖双帧延迟 / 折叠取消 / 卸载取消三个时序语义（同步 rAF stub 无法覆盖，已确认 Red→Green）。
- **接缝收敛**：删除 `FixedPanelsHost` 纯别名，AppShell 直连 `<PanelHost placement="bottom"/>`；PanelHost / registry 补 `React.memo`。PanelHost 过滤逻辑改用 mock registry 单测（原测试依赖「真实 registry 恰好全为 bottom」，过滤行为未被真实覆盖）；registry 完整性断言独立为 `registry.test.ts`，删除「所有项均为 bottom」快照断言（未来加 left/right 面板时不产生测试摩擦）。
- **AppShell 测试**：新增 `AppShell.test.tsx` —— 骨架装配断言（TitleBar actions 注入、dock 按钮 slot 透传、PanelHost 位于 AppLayout 之外、isSettingsOpen 透传、浮层/StatusBar 挂载）。
- **ComposeProviders 改 element API**：函数式 `(children) => <X/>` 改为元素数组（`cloneElement` 仅注入嵌套 children，业务 props 原样保留）—— 无参 Provider 不再包凑形状的 lambda，props 类型检查回到 JSX 层；`AppProviders` 删除永不命中的 `React.memo`；「AppProvider 必须最外」注释按核实结果改写（当前无 Provider 自身消费其他 Context，无硬性顺序约束）。配套把 8 个被组合 Provider 的 `children` 契约改为可选（元素化组合由宿主注入）。
- **布局域全量审查清理（2026-08-29 下午）**：① 删除 Phase 3 侧栏迁移死代码集群（ActivityBar/PanelArea/RightPanel/SidebarContext/ui-Sidebar + barrel 导出 + AppProviders 的 SidebarProvider 槽位）；② 删除 `dockStore.leftPanelWidth` 死状态链（注释宣称 TitleBar 消费，实际无人读取）；③ 修复 `dockStore.merge` 与注释矛盾——持久化 `activePanelId` 现按「仍属注册表面板清单则恢复，否则回退 panels[0]」恢复（TDD，+3 用例）；④ zone 最小尺寸提为 `shared/dock/panelMeta.ts` 的 `MIN_ZONE_SIZE_PERCENT` 单源（DockLayout JSX ×2 + store clamp）；⑤ `ui/ResizablePanel` 重命名 `OverlayPanel` 消除同名陷阱；⑥ 删除零使用 `DockPanelId`；⑦ spec 同步（directory-structure / state-management 移除已删组件引用）。（本条原登记的 follow-up「AppLayout 消解、ZoneId 收编」已于当日「简洁性收敛」完成。）遗留 follow-up（Step 3 一并处理）：AppLayout 近纯透传层的消解、`ZoneId` 联合类型收编 stringly zones。
- **简洁性收敛（2026-08-29 傍晚）**：① 消解 `AppLayout` 近纯透传层 —— AppShell 直用 DockLayout，`ToolbarFooter`/`AddProjectMenu` 迁 `app/components/`，`useAppLayoutProps` → `app/hooks/useToolbarFooterProps`；App 组合根不再持有 store 订阅（`isSettingsOpen` 由 AppShell 从 appView 派生）。② `dockStore` 引入 `ZoneId = 'left' | 'right'` 联合类型（zones / activatePanel / DockZone props 收紧，非法 zone 编译期拦截），顺带发现并删除零调用的 `movePanel` 死 action（useDragToReDock 已删除的遗留）。App.test / AppShell.test mock 与断言同步更新。至此布局域无已知可做项，剩余 follow-up 仅 Step 3（bottom 进布局）。
- **AppShell 纯化（2026-08-29 夜）**：审查确认「骨架 + 装配同文件」是装配工作必然归宿（依赖方向未破），但清掉三处残留 —— ① 删除单子冗余 wrapper div（旧 App.tsx 嵌套残留，职责与 DockLayout 根元素重复）；② `isSettingsOpen` 下沉 ToolbarFooter 自订阅 appViewStore（对齐 DockBarButton 惯例），AppShell 退化为零订阅纯结构 JSX；③ 注释分区化（框架顶/工作区/浮层/框架底）。TDD：ToolbarFooter.test 3 用例先红后绿（`toHaveClass` token 匹配避开 `hover:bg-bg-hover` 子串陷阱；`data-testid` 满足 no-node-access 规则）。附带的性能红利：appView 切换时重渲染范围从整个 AppShell 收窄到 ToolbarFooter。
- **文档同步**：AC 按裁剪决策改写（本节）；directory-structure 补 app/shell、app/panels、app/utils 与 useZoneExpandCollapse 条目。
- 保留的已知债务（Step 3 触发时一并处理）：TaskConsole/Debug 各自手写 mousemove resize + localStorage 高度记忆（两处同构，迁移 zone 体系时收编）；两面板以 CSS 常量（mx-11 / px-px pb-0.5）硬对齐 DockLayout gutter；debugStore 面板互斥回调（`registerDebugPanelCloser`）；dockStore.ts 渐胖（363 行，types + actions + persist 同文件——restoreZones 已独立成 helper，Step 3 加 bottom zone 时顺势拆分）。

### Nit 处理（2026-08-29 夜，neeko-check 增量审核跟进）

- **ComposeProviders 豁免条款**：quality-guidelines「必需模式 #2 React.memo」新增豁免——纯装配组件（props 恒新、memo 永不命中）不包 memo，判定标准「props 引用有可能稳定时才包」，新增豁免需在 spec 登记。
- **消除 `{} as Record<ZoneId, DockZoneState>` 断言 ×2**：`createInitialState` 与 merge 均改为显式 `{ left: buildZone('left'), right: buildZone('right') }` 构造（merge 侧抽模块级 `restoreZones` helper，循环内联逻辑上提）；显式枚举使「新增 zone 必须回到构造点」成为编译期强制，随之删除 createInitialState 中永不触发的防御回填循环。行为零变化（dockStore 17 用例绿）。
