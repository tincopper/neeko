# Dock Placement · 技术设计

> 本文件是设计稿。代码片段标注「设计稿」，**未落盘**。实现前需 prd.md 的 D1–D5 拍板。

## 1. 第一性原理：四条不变式

### I1 布局的原子是「视图 → 槽位」的指派（Placement）

今天的指派被存了两遍：`zones[slot].panels`（谁装在槽里）与 `barItems[]`（图标在哪条栏）。两者各自从 `DOCK_PANEL_META.defaultZone` 派生，运行期可独立漂移：

- `togglePanel` 只写 `zones`（新增面板时同时把 `barItems.visible` 置 true，但改不了 side）；
- `closePanel` 只写 `zones`（`barItems.visible` 保持原值）；
- `merge` 时 `barItems` 完全由 registry 重建，用户对 `side`/`order` 的改动被丢弃。

用户要的「把图标从左侧移到右侧」本质是改**一个** placement 的 `slot`。若沿用双表示，任一次写入都必须双写，而任何漏写都表现为「图标在右、面板还开在左」——这类缺陷在构造上不该存在。

**结论**：删除 `zones[].panels` 与 `barItems[]`，`placements: Record<ViewKey, DockPlacement>` 为唯一真源；bar 与 zone 都是它的派生投影。

### I2 指派作用在「种类」上（有界），实例（无界）由槽位宿主按当前 tabKey 投影

物理约束决定这不是风格偏好：

- `buildDockPanelRegistry()` 缺 UI 绑定直接 `throw`（`src/app/dock/registry.ts:138`）→ `zone.panels` 里不能出现动态 id；
- `rightPanelSizes` 以 panelId 为键持久化 → 持久化体积 ∝ registry 基数，不能 ∝ 实例数；
- tab 身份无界（每次打开新 id），且按 `tabKey`（workspace）分槽。

**结论**：docking 的单位是「种类」（`tabKind:agent-chat`）与「槽位宿主」（`tabHost:right`），不是 tab 实例。实例由宿主按当前 `tabKey` 投影出来。

### I3 一条实例在任一时刻只属于一个槽位（单值 surface）

`TerminalView` / `AgentChatTabView` 有 PTY / agent stream 副作用。两侧各自 filter = 双挂载 = 双 PTY。因此「在哪个 surface」必须是布局里的**唯一归属**（`editorLayout` 的一个组），移动必须是**一次原子 mutator**（先全域移除再插入，同一 `set` 内完成）。

### I4 布局全局（跨项目不变），可见集合是 tabKey 的投影（随项目变）

`dockStore` 全局持久化 vs `editorLayout[tabKey]` 按 workspace 分槽。两者混存 = 切项目串会话。

**派生规则**：宿主渲染时以「当前激活 workspace 的 `tabKey`」取 `editorLayout[tabKey].docked[slot]`；无内容 → **不占位**（宿主是内容的投影，见 §I5）。不能把「某项目的 tab 清单」写进 dockStore。

### I5 zone 可见性从内容派生（P5，2026-11-03）

**判据**：`zone 渲染 = 展开 ∧ 前台视图有内容可渲染`（`shared/dock/zone.ts` 的 `isZoneRenderable`）。

- 无状态面板（projects / files / gitControl / pullRequests / browser / conversations / search）内容随时可重建 ⇒ 「有内容」恒真（**既有行为一字不变**）；
- 槽位宿主（`host: 'tabHost'`）的内容是按 workspace 投影的 tab 集合且不持久化 ⇒ 「有内容」= `hasDockedTabs(state, tabKey, slot)`（id 必须存活，与 `hasCenterTabs` 同一口径）；
- 前台是谁的唯一派生点是 `zoneFrontView`（含「`activeView` 指向 `host: 'none'` 时回落槽内首个可渲染视图」）。`DockZone` / `DockLayout` 的自算 fallback 已删。

**为什么必须派生而不是写 intent**：宿主不是「用户可开合的面板」，而是内容的投影。用 `setSlotExpanded(false)` 在 N→0 时「保留」一个可以被用户重新点开的收起态，就是让**容器比内容活得久**（持久化的 `zones.expanded` 会比不持久化的 tab 活得更久）。派生后两条边界自动成立：切项目/重启 → 空宿主不占位；关光 tab → 槽让出宽度。

**内容事实的注入端口**：`layout/` 不得 import tab 域 ⇒ `AppShell` 经 `useDockTabHostContent()` 把 `Record<DockSlot, boolean>` 作为 `tabHostHasTabs` 传给 `DockLayout`（与 `onMoveView` 同一规矩，缺省 fail-closed = 无内容）。

## 2. 物理约束（决定方案形状）

| # | 约束 | 出处 | 对设计的要求 |
| --- | --- | --- | --- |
| C1 | registry 是编译期静态表，缺绑定 throw | `app/dock/registry.ts:138` | zone 内只允许 ViewKey（有界），禁止实例 id |
| C2 | 嵌套 `ResizablePanelGroup` 有「pin tab 后 handle 失效」历史缺陷 | `DockLayout.tsx:40`、`docs/layout-architecture.html` §⑥ | 槽位 tab 宿主**不得**再嵌一层 Group；复用既有单 Group |
| C3 | 宽度百分比 + `MIN_ZONE_SIZE_PERCENT` 是 minSize / clamp 单一真源 | `shared/dock/panelMeta.ts` | 新增尺寸记忆必须同引该常量 |
| C4 | 已有 `@dnd-kit`、`EditorDndShell`（DragOverlay / PinDropZone） | `features/editor/dnd` | 不引新库；沿用域 hook 承载排序算法 |
| C5 | `editorTabSelectors` 不变量：各组 `tabIds` 恰好枚举该空间 tab | `editorTabSelectors.ts:28` 注释 I1 | 新增 surface 必须扩这条不变量，不得绕过 |
| C6 | `editorStore` 无 persist | `shared/store/editorStore.ts`（无 persist middleware） | 重启后行为只能靠种类级策略（存 dockStore） |
| C7 | dnd 规范：每个独立排序区域一个 `DndContext`；`onDragEnd` 只提取 id | `.trellis/spec/frontend/interaction-patterns.md` §4 §8 | 两条工具栏要跨栏 = 合并为**一个**排序区域 → 显式记录偏差（§11） |

## 3. 数据模型

### 3.1 槽位与视图标识

```ts
// src/shared/dock/types.ts（设计稿）
export type DockSlot = 'left' | 'right';
export const DOCK_SLOTS: readonly DockSlot[] = ['left', 'right'] as const;
export function isDockSlot(value: unknown): value is DockSlot;

/** 不透明视图标识；唯一 mint 点在 viewKey.ts（与 WorkspaceSession.key 同构）。 */
export type ViewKey = string & { readonly __brand: 'ViewKey' };

/** 遮蔽具体 TabKind 联合，避免 shared/dock 依赖 shared/types/tab 的成员变化。 */
export type TabKindLike = string;

export type DockViewHost = 'singleton' | 'tabHost' | 'none'; // none = 只上 bar，不进 zone

export type DockViewActivation =
  | { kind: 'toggleZone' }
  | { kind: 'openTab'; tabKind: TabKindLike }
  | { kind: 'appView'; view: 'library' | 'settings' };

export interface DockViewMeta {
  view: ViewKey;
  host: DockViewHost;
  activation: DockViewActivation;
  defaultSlot: DockSlot;
  /** 仅用于建表排序，入库时归一化为 0..n-1。 */
  defaultOrder: number;
  defaultOnBar?: boolean; // 默认 true
  movable?: boolean;      // 默认 true；tabHost 固定在自己的槽
  defaultSlotSize?: number;
}

export interface DockPlacement {
  view: ViewKey;
  slot: DockSlot;
  order: number;  // 恒为 0..n-1
  onBar: boolean; // 「钉住图标」= true
}

export interface DockZoneRuntime {
  expanded: boolean;
  activeView: ViewKey | null;
}

export interface DockLayoutState {
  placements: Readonly<Record<ViewKey, DockPlacement>>;
  zones: Readonly<Record<DockSlot, DockZoneRuntime>>;
}
```

### 3.2 三个视图族（能力由类型声明，状态只管位置）

| 族 | host | 进 zone | 上 bar | 例子 | 点击行为 |
| --- | --- | --- | --- | --- | --- |
| 单例工具面板 | `singleton` | ✅ | ✅ | `panel:files`、`panel:projects` | `toggleZone`：切前台/收起 |
| 槽位 tab 宿主 | `tabHost` | ✅（固定槽） | ❌（容器不上栏，D10） | `tabHost:left`、`tabHost:right` | `toggleZone`：显示该槽 tab 区 |
| 种类级入口 | `none` | ❌ | ✅ | `tabKind:agent-chat`、`tabKind:terminal` | `openTab`：开/激活该 kind 的 tab，落到其 `defaultSlot` 宿主 |
| （既有特例）中心视图 | `none` | ❌ | ✅ | `appView:library` | `appView`：切 `appViewStore` |

> `openAs: 'tab'` 这个字符串哨兵被 `activation.kind` 取代：行为从「靠一个字段推断」变成「显式分支」，新增行为只加 union 分支（OCP）。

### 3.3 ViewKey 唯一 mint 点

```ts
// src/shared/dock/viewKey.ts（设计稿）
export const panelView = (panelId: string): ViewKey => `panel:${panelId}` as ViewKey;
export const tabHostView = (slot: DockSlot): ViewKey => `tabHost:${slot}` as ViewKey;
export const tabKindView = (kind: TabKindLike): ViewKey => `tabKind:${kind}` as ViewKey;
export const appViewKey = (view: string): ViewKey => `appView:${view}` as ViewKey;
```

持久化快照里的字符串**不需要解析**：真伪由 `DOCK_VIEW_META` 查表裁定（不在表里 → 丢弃）。因此不提供 `parseViewKey`（YAGNI）。

## 4. 状态源矩阵（改前 → 改后）

| 事实 | 改前 | 改后 | 理由 |
| --- | --- | --- | --- |
| 谁在哪个槽、什么顺序、有无图标 | `zones[].panels` + `barItems[]`（两份） | `placements`（一份） | I1 |
| 槽位是否展开、前台是谁 | `zones[].expanded` / `activePanelId` | `zones[].expanded` / `activeView` | 字段改名，语义不变 |
| 面板宽度记忆 | `rightPanelSizes[panelId]` + `leftPanelSize` | `viewSizes[ViewKey]` + `leftSlotSize` | key 有界（C1/I2） |
| tab 在哪个 surface | `groups.left/right` + `pinnedTabIds` | 追加 `docked.left/right`（四个组，pinned 不变） | I3，扩 C5 不变量 |
| tab 的默认停靠策略 | 无 | `DOCK_VIEW_META[tabKindView(kind)].defaultSlot` | C6：唯一可持久化的地方 |
| 当前激活 workspace | `workspaceStore` | 不变 | 宿主只消费 |

**关键取舍**：把「tab 在哪个 surface」放进 `editorLayout`（而不是放进 `Tab` 或 `dockStore`）。

- 放 `Tab`：`editorStore` 无 persist，重启即丢（符合 D3 预期），但会与 `groups` 形成第二份表示（`tabs[]` 里的字段 vs 组的 `tabIds`）→ 分叉风险；
- 放 `dockStore`：跨项目污染（违反 I4）；
- 放 `editorLayout`：与既有 I1（组即顺序与归属）同构，`center` 侧代码零改动，宿主只读自己那一组。**选它。**

## 5. 模块边界与新增/改动文件

```
shared/dock/
  viewKey.ts        新增 · ViewKey mint（纯函数）
  types.ts          改 · DockSlot / ViewKey / DockViewMeta / DockPlacement / DockZoneRuntime
  placement.ts      新增 · 纯 reducer：applyMove / applyActivate / applyToggle / applyOnBar + selectors
  panelMeta.ts      改 · DOCK_PANEL_META → DOCK_VIEW_META（host/activation/defaultSlot/onBar/movable）
  index.ts          改 · 只 re-export 上述公开面

shared/store/
  dockStore.ts      改 · v6：placements + zones + viewSizes + mutators 薄包装 + migrate/sanitize
  editorStore.ts    改 · 新增 dockTab(tabKey, tabId, target)（原子移动）
  editorTabSelectors.ts 改 · selectOrderedTabIds 覆盖 docked（I1 扩展）

shared/types/
  editorGroup.ts    改 · EditorSplitLayout.docked: Record<DockSlot, EditorGroupState>

app/
  dock/registry.ts         改 · key 换 ViewKey；新增 tabHost/entry 绑定；host≠none 时 component 必填校验
  dock/wrappers/DockTabHostWrapper.tsx  新增 · 解析当前 tabKey 后挂宿主
  hooks/UseDockBarButtons.tsx          改 · 按 slot 派生 onBar 落位；按 activation 分发点击
  components/DockBarButton.tsx         改 · activation 分发 + Alt+←/→ + drag 手柄
  utils/tabSurface.ts                  新增 · moveTabToSlot（唯一跨 store 编排点）

features/dock-tabs/
  components/DockTabHost.tsx  新增 · 复用 EditorGroupPane(slot→paneId)
  hooks/useDockedPane.ts      新增 · 读 layout.docked[slot]（共享 selectors，不共享大对象）

features/editor/
  components/EditorGroupPane.tsx  改 · paneId 联合扩展 'dockLeft' | 'dockRight' + chrome: 'dock' 变体
  hooks/useEditorGroupLayout.ts   改 · 暴露 dock 组操作（moveToDock / moveToCenter）

layout/dock-layout/
  DockBar.tsx        改 · droppable 容器 + sortable 列表
  DockBarDnd.tsx     新增 · 两栏共用 DndContext（只提取 id，逻辑在 app hook）
  DockLayout.tsx     改 · 从 placements 派生 rightVisible / activeView / 尺寸
  DockZone.tsx       改 · 按 activeView 取 registry 组件（不再遍历 zone.panels）

docs/layout-architecture.html  改 · ③④⑥ 三章同步（状态源、扩展指南、Step 3 风险）
```

**依赖方向护栏**（建议加一条 `no-restricted-imports`）：`shared/store/dockStore` ⇏ `shared/store/editorStore`，反之亦然。唯一同时读两者的是 `app/utils/tabSurface.ts` 与 `features/dock-tabs/*`。

## 6. 核心算法（设计稿，纯函数）

```ts
// src/shared/dock/placement.ts
export function slotPlacements(state: DockLayoutState, slot: DockSlot): DockPlacement[] {
  return Object.values(state.placements)
    .filter((p) => p.slot === slot)
    .sort((a, b) => a.order - b.order);
}
export function slotViews(state: DockLayoutState, slot: DockSlot): ViewKey[] {
  return slotPlacements(state, slot).map((p) => p.view);
}

export interface MoveViewRequest { view: ViewKey; to: DockSlot; index?: number }

/**
 * 移动视图并在同一个返回值里修复两槽 activeView。
 * 为什么修复必须在这里：activeView 悬挂会让 zone 前台落空（回落前的形态 = 空岛 / 面板空白）
 * 而 zone 仍占宽度（「图标在右、面板空白」），一半修一半不修的状态在构造上不该存在。
 * 能力校验（movable/host）不在此处 —— 本模块不依赖 meta（见 dockStore action）。
 */
export function applyMove(state: DockLayoutState, req: MoveViewRequest): DockLayoutState;
```

行为规格（每条对应一个单测）：

1. 未知视图 / 非法槽位 → 返回原引用，不抛。
2. 同槽同位置 → 返回原引用（避免无意义 re-render）。
3. 目标 `index` 越界 → clamp 到 `[0, len]`；`NaN` → 追加。
4. 跨槽移动：源槽移除后 `order` 归一化；目标槽插入后归一化；目标槽 `expanded = true`（D2）；目标槽 `activeView = 被移动视图`；源槽 `activeView` 若非邻位存在 → 改指首个，若空 → `null`。
5. 同槽重排：只重算该槽；`activeView` 不变。
6. 移走槽内最后一个视图 → `activeView = null`，`expanded` 不改（D5）。
7. 幂等：连续两次同样请求，第二次返回原引用。

其余 reducer：`applyActivate`（切前台 + 展开）、`applyToggle`（前台且展开 → 收起，否则激活）、`applyOnBar`（钉住/取消钉住图标）、`hasSlotViews`。

## 7. 关键流程时序

### 7.1 图标跨栏（需求 A）

```
DockBarDnd.onDragEnd(activeId=viewKey, overId='bar:right'|'bar:right:<viewKey>')
  → parseOverId → (slot, index|null)
  → onMoveView(view, slot, index ?? MAX)         // app 注入
      → useDockBarMove: 校验 meta.movable === false → return
      → dockStore.moveView(view, slot, index)    // 能力校验在 action
          → set(applyMove(state, req))           // 纯结构变更
  → placements 变化 → bar 派生 + zone 派生同时更新（不可能分叉）
```

### 7.2 tab 停靠（需求 B）

```
用户操作（P1：右键菜单 / 命令 "Move tab to right dock"；P3：拖拽）
  → moveTabToSlot(tabKey, tabId, 'right')        // app/utils/tabSurface.ts 唯一入口
      1. editorStore.dockTab(tabKey, tabId, 'right')   // 原子：先从全域移除，再插入目标组
      2. dockStore.activateView(tabHostView('right'))        // 展开 + 前台（容器不上栏，D10）
  → layout.docked.right.tabIds 变化 → DockTabHost 渲染
  → 中间区 groups 已剔除该 id → 无第二实例（I3）
```

顺序不可颠倒：任一步失败都会留下「tab 在侧区但侧区没开」或「侧区开了但 tab 还在中间（双挂载）」。因此收敛在一个函数里，UI 不得分别调三个 store。

### 7.3 重启后快速打开（需求 C）

```
启动 → dockStore 从 localStorage 恢复 placements（tabHost:* 的 onBar 被 sanitize 强制为 false）
     → 右栏只渲染**功能入口**图标（Agent Chat / Agent Terminal）
点击图标 → activation.kind === 'openTab'
     → 找当前 tabKey 的该 kind tab：有则 activate；无则新建（openAgentChatTab / handleAgentClick）
     → 新 tab 的默认 surface = DOCK_VIEW_META[tabKindView(kind)].defaultSlot（D3 选项②）
     → live-sessions 负责会话本体：attach（存活）/ resume（已结束）/ 新建
```

### 7.4 切项目（I4）

```
workspaceStore.activeWorkspace 变化
  → 宿主 tabKey 变化 → editorLayout[新 tabKey].docked.right 通常为空
  → 该槽不占位（空宿主不留空岛；不需要空态文案解释）
  → placements 不变（布局是全局的）
```

## 8. 持久化与迁移（v5 → v6）

```ts
// 设计稿
version: 6,
partialize: (s) => ({ placements: s.placements, zones: s.zones, viewSizes: s.viewSizes, leftSlotSize: s.leftSlotSize }),
migrate: (persisted, version) => (version < 6 ? migrateFromV5(persisted) : persisted),
merge: (persisted, current) => ({ ...current, ...sanitize(persisted), viewSizes: sanitizeSizes(...) }),
```

- `migrateFromV5`：把 `barItems[].side/order/visible` 与 `rightPanelSizes` 折成 placements/viewSizes；`zones[].activePanelId` → `activeView`；`library` 的 `openAs:'tab'` → `appView` 入口。
- `sanitize`（每次 merge 都跑，不只迁移时）：丢弃 meta 中不存在的视图；`movable === false` 的视图强制回 `defaultSlot`；`order` 非有限数 → 回默认；每槽归一化 `0..n-1`；`activeView` 不在槽内 → 回首个；左槽 `expanded` 强制 `true`（保留今日行为）。
- **手工改坏 localStorage 是必须覆盖的输入**（`slot:'top'` / `order:NaN` / 未知 key / 缺字段）。

## 9. 不变量与护栏测试（TDD：先写红）

| # | 不变量 | 测试位置 | 断言 |
| --- | --- | --- | --- |
| G1 | 一条 tab 只在一个组（防双挂载 / 双 PTY） | `app/utils/__tests__/tabSurface.test.ts` | `dockTab` 后：center 三组 ∩ docked 两组 = ∅ |
| G2 | 仲裁顺序覆盖全部 tab 且无重复 | `editorTabSelectors.test.ts` | `selectOrderedTabIds` = 空间内全部 tab，长度相等、无重复 |
| G3 | 落位是唯一真源 | `placement.test.ts` | bar 派生 + zone 派生读取同一 `slotPlacements`；删除 `barItems` 后无类型错误残留 |
| G4 | `activeView` 永不悬挂 | `placement.test.ts` | 任意 move 序列后，`zones[s].activeView ∈ slotViews(s) ∪ {null}` |
| G5 | `tabHost` 不可移动 | `dockStore.test.ts` | `moveView(tabHostView('right'), 'left')` → 状态不变 |
| G6 | 迁移不产生悬挂落位 | `dockStore.test.ts` | v5 快照含已删 panel → 丢弃；坏 order → 归一化 |
| G7 | registry 完整性 | `app/panels/__tests__/registry.test.ts`（既有模式） | 每视图有绑定；`host !== 'none'` 必须有 component；`tabHost` 每槽唯一 |
| G8 | 纯函数覆盖率 | coverage | `placement.ts` / `migrateFromV5` 100% 行覆盖 |

## 10. 风险表

| # | 风险 | 触发场景 | 对策 |
| --- | --- | --- | --- |
| R1 | 切项目串会话 | 宿主显示别的 tabKey 的 tab | I4 + G1 类测试（用两个 tabKey 断言隔离） |
| R2 | tab 双挂载（双 PTY / 双 stream） | 两侧各自 filter；或移动分两次 set | I3：`dockTab` 单次原子 mutator + G1 护栏 |
| R3 | 落位指向已删视图 | registry 删面板后旧 localStorage | `sanitize` 在**每次** merge 跑（不只是版本迁移） |
| R4 | 图标/zone 再次分叉 | 有人新增第二份清单（如 `zone.panels`） | G3 + code review 红线：布局事实只允许一个来源 |
| R5 | 「重启后还在右侧」失效 | 把实例归属做成持久化 | C6/D3：实例 override 不持久化，策略持久化在 dockStore |
| R6 | dnd 跨 context 不生效 | tab 拖到工具栏 | P0–P2 不做；P3 需把 `EditorDndShell` 的 `DndContext` 上提 → 先补 tab 拖拽回归测试再动 |
| R7 | `useEditorGroupLayout` 被两边误用 | 宿主复用中心布局大对象 | 宿主用独立薄 hook `useDockedPane`，只共享 selectors |
| R8 | `EditorGroupPane` 在 dock 内露出分屏控件 | 无 `chrome` 变体 | `chrome: 'dock'` 隐藏 ActionMenu / 分屏按钮；单测断言不渲染 |
| R9 | pinned 与 dock 冲突 | 拖 pinned tab 进 dock | 明确拒绝 + 提示（P1）；或在 dock 时静默 unpin（需 D 决策补充） |
| R10 | 尺寸记忆污染 | docked 视图复用 `MIN_ZONE_SIZE_PERCENT` 前的旧值 | `sanitizeSizes` 统一 clamp |

## 11. 被否决的方案（及理由）

| 方案 | 否决理由 |
| --- | --- |
| 引入 golden-layout / dockview / rc-dock | 接管容器与 tab 模型 → 与 `editorLayout`（分屏/pinned/拖拽）、岛屿视觉、15 条红线护栏冲突；自有 tab 模型不保证单宿主 → 可能双 PTY |
| 把 tab 变成 dock panel（`zone.panels` 存 tab id） | 击穿 C1（registry 缺绑定 throw）与 I2（尺寸记忆体积失控）；`DockZone` 会渲染 null |
| 为 agent-chat 做单例 panel（内部渲染「最近一条 chat」） | 丢失多实例能力；与 live-sessions 的「会话 = 注册表」模型冲突。仅作为 P1 之前的临时探针可接受，不作为目标架构 |
| 把 tab surface 存进 `Tab` | 与 `editorLayout` 形成第二份表示（分叉风险），且 `Tab` 不持久化使差异无收益 |
| 把 tab surface 存进 `dockStore` | 违反 I4（跨项目污染） |
| 用 HTML5 Drag API 拖图标 | 项目已明令禁止（`interaction-patterns.md` §8：Windows/Tauri 冲突） |
| 让 tab 拖拽直接跨 `DndContext`（P3b） | **取消**：一个 context 同时承载 `ViewKey` 与 `tabId` 两个 id 空间，`onDragEnd` 必须先判断来源；且 tab 列表要在编辑器之上二次派生。收益（另一个手势）已由右键菜单 + 键盘可达覆盖，而该系统有 pin/handle 等三次事故史 |
| 与 spec 偏差：两栏共用**一个** `DndContext` | spec §4 要求「每个独立排序区域一个 DndContext」。本需求**跨两栏移动**使两栏成为同一排序语义区域；若拆成两个 context，跨栏拖动不可能（R6）。偏差需在实现 PR 描述与 spec 增补中显式记录 |

## 12. 与既有规范的对照

| 规范 | 落点 |
| --- | --- |
| `.trellis/spec/frontend/state-management.md`「同一事实只有一个表示/派生点」 | I1：`placements` 单真源；`slotPlacements()` 唯一读取面 |
| 同上「激活态单源」 | `zones[].activeView` 单源；`applyMove` 内修复，禁止消费侧兜底 |
| `.trellis/spec/frontend/interaction-patterns.md` §4/§8 | 域 hook 承载排序算法（`useDockBarMove`），`onDragEnd` 只提取 id；偏差见 §11 |
| `.trellis/spec/frontend/component-guidelines.md`（React.memo / useShallow） | `DockBarDnd` / `DockTabHost` / `DockBarButton` 全部 `React.memo`；派生数组走 `useShallow` |
| 根 `AGENTS.md` 架构原则「单一职责 / 开闭」 | 三个视图族；新增面板/种类只改声明表 |
| 根 `AGENTS.md` TDD | 纯函数 100%；每个 reducer 分支一个单测；不变量护栏测试先红 |
| `.trellis/spec/unit-test/frontend-testing.md` | 组件级 mock `invoke`；dockStore 测试沿用 `setState` 基线重建模式 |

## 13. 未决问题（start 前必须收敛）

1. **D1–D5**（prd.md）：`tabHost` 图标默认可见性 / 移动后自动展开 / 重启后实例收敛 / 左区是否也停靠 / 空槽是否收起。
2. **P0 是否独立发布**：若独立发布，`DOCK_VIEW_META` 先不含 tabHost/entry 行，P1/P2 再补（避免无用配置先行）。
3. **P1 入口形态**：右键菜单 / 命令面板 / 快捷键（`interaction-patterns.md` 有「快捷键按 Tab 域限定」约束）。
4. **pinned × dock 的交互**（R9）：拒绝 vs 静默 unpin。
5. **docked tab 的 Cmd+W 语义**：焦点在侧区宿主时是否命中侧区前台 tab（还是仍指中心前台）。建议：P1 保持「Cmd+W 只关中心前台」，P3 引入焦点域后再改。
