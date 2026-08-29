# Design — Layout architecture refactor

## 1. Invariant（第一性原理）

岛屿 = 皮肤层；Shell/zone/panel = 结构层，二者正交。本次只重构**结构层**：
- 布局骨架由 `AppShell` 单一持有（TitleBar + Workspace + StatusBar）；
- 区域由 `DockLayout` 演化的 4 分区 Grid 管理；
- 面板统一进 registry，`placement` 决定归位；
- 岛屿皮肤（圆角/间距/悬浮）不变，由区域样式提供。

## 2. 目标渲染树

```
App (组合根: Provider 装配 + <AppShell/>)
└── AppShell
    ├── TitleBar (actions={<TitleBarActions/>})
    ├── Workspace
    │   └── DockLayout（4 分区 Grid）
    │       ├── [左 DockBar + ToolbarFooter]
    │       ├── ResizablePanelGroup horizontal
    │       │   ├── left-zone  → PanelHost(placement='left')
    │       │   ├── center-area → AppCenter
    │       │   └── right-zone → PanelHost(placement='right')
    │       ├── [右 DockBar]
    │       └── bottom-zone（垂直 Group 下区）
    │           └── PanelHost(placement='bottom') ← TaskConsole/Debug
    ├── AppModals / QuickOpen / SymbolNav（浮层，组合根直挂）
    └── StatusBar
```

## 3. 模块映射

```
src/app/shell/
  AppShell.tsx         # 骨架组合：TitleBar + Workspace + StatusBar
  Workspace.tsx        # 主工作区容器（可选，若 AppShell 直接持有 DockLayout 则可省略）
src/app/panels/
  registry.ts          # 扩展：FixedPanelDef 增 placement 字段（或统一 panelRegistry）
  PanelHost.tsx        # 按 placement 渲染：{ left|right → DockZone 语义, bottom → 底部 host }
  FixedPanelsHost.tsx  # 迁移：变为 bottom 区 host（挂载点从 App 根 → Workspace/DockLayout 底部）
src/layout/dock-layout/
  DockLayout.tsx       # 演化 4 分区：水平 Group + 垂直 Group（bottom 区）
```

## 4. 关键实现决策

### 4.1 DockLayout 4 分区（嵌套 Group）

react-resizable-panels 支持嵌套 Group。结构：
```
<ResizablePanelGroup orientation="vertical">
  <ResizablePanel>                       // 主区（水平 3 栏）
    <ResizablePanelGroup orientation="horizontal"> …现有三栏… </ResizablePanelGroup>
  </ResizablePanel>
  <ResizableHandle/>
  <ResizablePanel defaultSize={…} minSize={…}>   // bottom 区
    <PanelHost placement="bottom"/>
  </ResizablePanel>
</ResizablePanelGroup>
```

风险：嵌套 Group 曾致「pin tab 后开侧面板 handle 失效」（DockLayout 顶部注释记录）。缓解：
- bottom 区采用**独立状态**（dockStore 加 bottom 区 state：expanded / height / activePanelId），不依赖外层水平 Group 的 defaultSize 记忆；
- 展开/收起 bottom 用命令式 `panel.expand()/collapse()` + resize（复用 `useDockZoneResize` 观察的几何逻辑 —— 本次顺带抽取）。

### 4.2 PanelHost / placement

`fixedPanelRegistry` 项增加 `placement`：
```ts
export type PanelPlacement = 'left' | 'right' | 'bottom';
export interface FixedPanelDef {
  id: string;
  placement: PanelPlacement;
  Component: LazyExoticComponent<ComponentType>;
}
```
`PanelHost({ placement })`：
- `left/right` → 渲染到 DockZone（保持现状 DockZone 内部按 activePanelId 选面板）
- `bottom` → 渲染到底部 zone（TaskConsole/Debug 保持各自 store 自管显示，host 只负责挂载）

决策：**本次不合并 dockPanelRegistry 与 fixedPanelRegistry 为单一表**（两体系生命周期/宿主不同：dock 面板有 zone 选中态，bottom 面板各自 store 自管显隐）。仅让固定面板 registry 带 placement 语义，dock 面板维持现状 —— 避免过度设计。阶段 3 再做真正统一。

### 4.3 AppShell 收敛

`AppShell.tsx` 从 App.tsx 搬入：
- `<TitleBar actions/>`
- 主工作区（AppLayout → DockLayout 4 分区）
- `<StatusBar/>`
- 浮层（AppModals / QuickOpen / SymbolNav）—— 保留在 AppShell 或 App.tsx 直挂均可；建议留在 AppShell（它们依赖 DockRegistryProvider 内 context）

App.tsx 最终：
```tsx
<AppProviders {...props}>
  <TerminalInsertProvider>
    <DockRegistryProvider registry={dockPanelRegistry}>
      <AppShell .../>
    </DockRegistryProvider>
  </TerminalInsertProvider>
</AppProviders>
```

### 4.4 useDockZoneResize（顺带抽取）

DockLayout 组件体约 262 行 + 新增 bottom 几何逻辑会逼近 300。本次把左右 zone 的「expand/collapse + 双 rAF resize」抽成 hook：
- `useZoneExpandCollapse(panelRef, expanded, targetSize)`：通用展开/收起 + 双 rAF resize
- 左右区与 bottom 区共用该 hook
- 放置 `src/layout/dock-layout/useZoneExpandCollapse.ts`（就近）

## 5. 测试策略（TDD / 80% 门禁）

- `AppShell.test.tsx`：渲染 TitleBar/Workspace/StatusBar 骨架；App.tsx 保持 App.test 回归
- `PanelHost.test.tsx`：按 placement 渲染对应面板（mock registry）
- `DockLayout` 行为：新增 bottom 区展开/收起断言（若可测）；现有行为回归靠 `App.test` + 手动
- `useZoneExpandCollapse.test.tsx`：expand/collapse/resize 调用断言（renderHook + fake rAF）
- 质量门禁：`pnpm lint / lint:fe / type-check / test:run` 全绿

## 6. 非目标

- 阶段 3（面板跨区移动、单 registry 统一）→ follow-up
- 岛屿皮肤改动（视觉不变）
- 不提交代码（本任务产出保留工作区，由用户统一提交）
