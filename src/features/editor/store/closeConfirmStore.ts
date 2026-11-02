import { create } from 'zustand';

import { useOverlayStore } from '@/shared/store/overlayStore';

/**
 * 关闭确认的**请求侧**：弹出哪个框、等用户点哪个键。
 *
 * 这个文件只持有「待确认的请求」这一个状态，不碰 tab、不碰终端、不做关闭决策 ——
 * 拿答案去做事在 `../actions/closeTab.ts`（编排属副作用，不是状态）。
 */

/** 确认对话框浮层 id（z-order 专项）。 */
const CLOSE_CONFIRM_OVERLAY_ID = 'close-confirm';

/** 未保存关闭确认的用户选择 */
export type CloseAction = 'save' | 'discard' | 'cancel';

/** 「会话还在跑」时的关闭选择：后台运行 / 退出进程 / 取消。 */
export type TerminalCloseAction = 'background' | 'exit' | 'cancel';

/** 保存指定 tab（关闭确认「保存」分支调用）。返回 true 表示保存成功。 */
export type SaveTabAction = (tabId: string) => Promise<boolean>;

/**
 * 待确认的请求。**两种关闭语义共用一套宿主与结算**（同一个浮层 id、同一份 hostMounted
 * 守卫、同一个 resolver 槽位）—— 各自再写一套的话，`hostMounted` 那条「无宿主时必须
 * 立即 cancel，否则调用方永久挂起」的守卫会漏掉其中一套，表现为关闭静默失效。
 */
export type CloseConfirmPending =
  | { kind: 'unsaved-file'; fileName: string }
  | { kind: 'running-terminal'; title: string };

/**
 * 两个请求入口的公共取值域。
 *
 * `'cancel'` 同时属于两者，也是「并发请求 / 无宿主」时的结算值 —— 于是各入口可以用
 * 泛型把自己那个子类型收窄回来，而不必在调用侧断言。
 */
type CloseConfirmDecision = CloseAction | TerminalCloseAction;

interface CloseConfirmStoreState {
  /** 当前待确认的请求；null = 对话框关闭 */
  pending: CloseConfirmPending | null;
  /** 弹出未保存确认框并返回用户选择（并发请求时旧 Promise resolve 'cancel'） */
  request: (fileName: string) => Promise<CloseAction>;
  /** 弹出「后台运行 / 退出 / 取消」确认框 */
  requestTerminalClose: (title: string) => Promise<TerminalCloseAction>;
  /** 用户选择后结算当前请求 */
  resolve: (action: CloseConfirmDecision) => void;
}

// Promise resolver 存 store 外（模块级）：未决 Promise 不可序列化，不进 zustand 状态。
let resolver: ((action: CloseConfirmDecision) => void) | null = null;

/**
 * 两个请求入口共用的「挂起 + 结算」骨架。
 *
 * 泛型参数是**调用方语言里的那张取值表**（`CloseAction` / `TerminalCloseAction`）；
 * 结算值只可能来自用户点击那一个框，所以内部按联合存、对外按子类型给。
 */
function suspend<A extends CloseConfirmDecision>(
  set: (partial: { pending: CloseConfirmPending | null }) => void,
  pending: CloseConfirmPending,
): Promise<A> {
  // 并发请求：旧请求按 cancel 结算 —— 用户已转向关闭另一个 tab，旧 tab 保持打开。
  resolver?.('cancel');
  resolver = null;
  if (!hostMounted) return Promise.resolve('cancel' as A);
  // 浮层上报：对话框打开期间隐藏内容区 Browser webview（z-order 专项，id 幂等）。
  useOverlayStore.getState().setOverlayOpen(CLOSE_CONFIRM_OVERLAY_ID, true);
  set({ pending });
  return new Promise<A>((resolve) => {
    // `resolve: (a: A) => void` 与联合槽位是逆变关系，这里只有一个方向需要断言；
    // 断言放在**唯一**的赋值点上，调用侧就干净了。
    resolver = resolve as (action: CloseConfirmDecision) => void;
  });
}

/**
 * 宿主（`AppModals` 里的两个确认框）是否已挂载，由宿主自己置位。
 *
 * 为什么需要：`suspend` 的 Promise 只有对话框才会结算。`AppModals` 在 `SplashScreen`
 * 期间尚未挂载（`App.tsx:32-34`），此时若无守卫，`await closeTabWithConfirmation(...)`
 * 的调用方会**永久挂起** —— 关闭 tab 的操作静默失效。故无宿主时按 cancel 立即结算
 * （fail-closed：绝不替用户丢弃未保存改动）。与 `confirmStore.hostMounted` 同一条不变式。
 */
let hostMounted = false;

/** 宿主挂载 / 卸载时同步就绪标记。 */
export function setCloseConfirmHostMounted(mounted: boolean): void {
  hostMounted = mounted;
}

export const useCloseConfirmStore = create<CloseConfirmStoreState>((set) => ({
  pending: null,
  // 直接返回（不写成 `async` + `await`）：多一层 Promise 会让调用方的 `await` 多一个
  // 微任务，而「挂起后立刻可见的 pending」是既有测试与浮层渲染都依赖的时序。
  request: (fileName) => suspend<CloseAction>(set, { kind: 'unsaved-file', fileName }),
  requestTerminalClose: (title) =>
    suspend<TerminalCloseAction>(set, { kind: 'running-terminal', title }),
  resolve: (action) => {
    useOverlayStore.getState().setOverlayOpen(CLOSE_CONFIRM_OVERLAY_ID, false);
    set({ pending: null });
    resolver?.(action);
    resolver = null;
  },
}));
