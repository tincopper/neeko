# Implement — Layout architecture refactor

## 实施顺序（TDD，每步绿后再下一步）

### Step 1: 抽取 useZoneExpandCollapse hook（先做，独立无风险）
- `src/layout/dock-layout/useZoneExpandCollapse.ts`：`useZoneExpandCollapse(panelRef, expanded, targetSize)` 通用「展开→双 rAF resize / 折叠」逻辑
- DockLayout 左右 zone 的 2 个 effect 改用该 hook（行为不变）
- 单测：`useZoneExpandCollapse.test.tsx`（expand/collapse/resize 断言，fake rAF）

### Step 2: 扩展 fixed panel registry（placement 语义）
- `src/app/panels/registry.ts`：`FixedPanelDef` 增 `placement: 'left'|'right'|'bottom'`；TaskConsole/Debug 标记 `placement: 'bottom'`
- 新增 `src/app/panels/PanelHost.tsx`：按 placement 渲染（left/right → 现有 zone 语义由 DockLayout 管；bottom → 底部 host）
- 单测：`PanelHost.test.tsx`

### Step 3: DockLayout 4 分区（bottom 区）
- DockLayout 顶层加垂直 Group：主区（现水平三栏）+ bottom 区
- bottom 区渲染 `PanelHost(placement='bottom')`（或直接渲染 FixedPanelsHost）
- bottom 展开/收起经 `useZoneExpandCollapse`
- 回归：现有左右 dock 行为不变；新增 bottom 行为

### Step 4: AppShell 收敛
- `src/app/shell/AppShell.tsx`：组合 TitleBar + Workspace（AppLayout/DockLayout）+ StatusBar + 浮层
- `src/app/App.tsx`：只装配 Provider + `<AppShell/>`（移除手写骨架 JSX）
- 保留 App.test 回归（现有 feature mock 兼容）

### Step 5: FixedPanelsHost 迁移为 bottom zone host
- `FixedPanelsHost` 挂载点从 App 根 → Workspace/DockLayout bottom 区
- 保持 registry 渲染逻辑不变（消费 fixedPanelRegistry）

### Step 6: 质量门禁 + spec 同步
- `pnpm lint / lint:fe / type-check / test:run` 全绿
- `cargo` 不受影响（纯前端）
- spec 同步：directory-structure（layout/shell/panels 分层）、best-practices（如需要）

## 验证命令

```bash
pnpm lint:fe
pnpm type-check
pnpm test:run
```

## 约束提醒

- 不提交代码（用户明确要求；产出保留工作区）
- 岛屿视觉不变；行为保持优先
- react-resizable-panels 嵌套 Group 风险：验证展开/收起/拖拽，尤其 pin tab 后开面板的既有 bug 不复现
