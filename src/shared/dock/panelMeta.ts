import type { DockViewMeta, ViewKey } from './types';
import { appViewKey, panelView, tabHostView, tabKindView } from './viewKey';

/**
 * 尺寸百分比单源：DockLayout 的 ResizablePanel minSize 与 dockStore 的尺寸 clamp
 * 必须引用同一常量（避免「must match」手工同步）。
 */
export const MIN_ZONE_SIZE_PERCENT = 12;

/** 没有登记的尺寸时的兜底槽宽百分比（store 默认值与 DockLayout 渲染兜底共用）。 */
export const DEFAULT_ZONE_SIZE_PERCENT = 18;

/**
 * 一行声明：`view` 与表的键由同一个值给出 —— 手写两处就会漂移。
 */
function row(view: ViewKey, rest: Omit<DockViewMeta, 'view'>): [string, DockViewMeta] {
  return [view, { view, ...rest }];
}

/**
 * Dock 视图声明表 —— 「哪些视图可以被落位」的**唯一**有界清单。
 *
 * UI 绑定（title / icon / lazy 组件）在 `app/dock/registry.ts`；本表只有结构默认值，
 * 因此 `shared/dock` 可以被 store 直接依赖，而 layout 对面板清单零感知。
 *
 * `defaultOrder` 只用于建表排序：入库时归一化为该槽内的 0..n-1（order 是槽内相对序，
 * 不是跨槽的全局序）。
 *
 * **P0 只含既有 8 个 panel + library 入口**。`tabKind:*`（P2）行在 P2 阶段落地 ——
 * 提前声明会让「图标已经在那里、点了却没反应」成为默认体验。
 *
 * **P1 加了 `tabHost:left` / `tabHost:right`**（槽位 tab 宿主）：它们固定在自己的槽
 * （`movable: false` —— 能力校验在 `dockStore.moveView`，拖拽不得打破「宿主在自己槽」），
 * 且默认宽度 28%（18% 对 chat 太窄）。图标默认可见性按已定 D1：**右 true / 左 false**。
 *
 * **P2 加了 `tabKind:agent-chat` / `tabKind:terminal`**（种类级入口）：`host: 'none'`
 * （不进 zone —— 它们打开的是 tab，tab 的落点是**宿主**而不是自己），点击行为是
 * `openTab`（落地在 app 层 `useDockBarOpenTab`：已有该 kind 就激活，否则新建并移到
 * **图标当前所在的槽**，所以没有单独的「kind → slot」策略字段 —— 图标在哪栏就是答案）。
 * `defaultOnBar: true` 是需求本身（「入口图标固定在右侧工具栏」）；`movable: true`
 * 让用户能把图标挪到左栏，落点跟着走。
 */
export const DOCK_VIEW_META: Record<string, DockViewMeta> = Object.fromEntries([
  row(panelView('projects'), {
    host: 'singleton',
    activation: { kind: 'toggleZone' },
    defaultSlot: 'left',
    defaultOrder: 0,
  }),
  // 左槽宿主：同一套机制（D4 不做非对称特例），但默认不给图标（D1：可发现性入口在右侧）
  row(tabHostView('left'), {
    host: 'tabHost',
    activation: { kind: 'toggleZone' },
    defaultSlot: 'left',
    defaultOrder: 1,
    defaultOnBar: false,
    movable: false,
    defaultSlotSize: 28,
  }),
  row(panelView('files'), {
    host: 'singleton',
    activation: { kind: 'toggleZone' },
    defaultSlot: 'right',
    defaultOrder: 0,
  }),
  row(panelView('gitControl'), {
    host: 'singleton',
    activation: { kind: 'toggleZone' },
    defaultSlot: 'right',
    defaultOrder: 1,
  }),
  row(panelView('pullRequests'), {
    host: 'singleton',
    activation: { kind: 'toggleZone' },
    defaultSlot: 'right',
    defaultOrder: 2,
  }),
  row(panelView('browser'), {
    host: 'singleton',
    activation: { kind: 'toggleZone' },
    defaultSlot: 'right',
    defaultOrder: 3,
    defaultSlotSize: 50,
  }),
  row(panelView('conversations'), {
    host: 'singleton',
    activation: { kind: 'toggleZone' },
    defaultSlot: 'right',
    defaultOrder: 4,
  }),
  row(panelView('search'), {
    host: 'singleton',
    activation: { kind: 'toggleZone' },
    defaultSlot: 'right',
    defaultOrder: 5,
  }),
  // 右槽宿主：D1 默认可见（重启后仍有回程入口）；宽度 28% —— 18% 对 chat 太窄
  row(tabHostView('right'), {
    host: 'tabHost',
    activation: { kind: 'toggleZone' },
    defaultSlot: 'right',
    defaultOrder: 6,
    movable: false,
    defaultSlotSize: 28,
  }),
  // 中心全宽展示（与左栏互斥：打开即收起左栏，关闭即恢复）。它有落位（图标占某一栏），
  // 但 `host: 'none'` ⇒ 不进 zone —— 「图标在哪栏」与「面板渲染在哪」是两件事。
  row(appViewKey('library'), {
    host: 'none',
    activation: { kind: 'appView', view: 'library' },
    defaultSlot: 'left',
    defaultOrder: 3,
  }),
  // 种类级入口（需求 C「快速打开」）：默认给图标（否则功能不可发现），可拖到左栏。
  // 顺序 50 / 51 让它们排在功能区下方、与工具面板分开（图标语义不同：开 tab ≠ 开面板）。
  row(tabKindView('agent-chat'), {
    host: 'none',
    activation: { kind: 'openTab', tabKind: 'agent-chat' },
    defaultSlot: 'right',
    defaultOrder: 50,
    // 显式写 true（不靠缺省）：这条需求就是「图标默认在右栏」，缺省值将来一改
    // 就会静默地让功能不可见。
    defaultOnBar: true,
  }),
  row(tabKindView('terminal'), {
    host: 'none',
    activation: { kind: 'openTab', tabKind: 'terminal' },
    defaultSlot: 'right',
    defaultOrder: 51,
    defaultOnBar: true,
  }),
]);
