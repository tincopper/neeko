import { create } from 'zustand';

import { useOverlayStore } from '@/shared/store/overlayStore';

/**
 * 通用确认对话框浮层 id（z-order 专项：对话框打开期间隐藏内容区 Browser webview）。
 */
const CONFIRM_OVERLAY_ID = 'confirm';

/**
 * 一次确认请求的内容。
 *
 * 文案由**调用方**提供（面向用户 → 英文），文案不落在这里：确认框是通用原语，
 * 不该内置任何业务措辞。
 */
export interface ConfirmRequest {
  /** 标题（简短问句）。 */
  title: string;
  /** 正文（可多行；把「为什么问」讲清楚）。 */
  message: string;
  /** 确认按钮文案（动词短语，如 `Use host backend`）。 */
  confirmLabel: string;
  /** 取消按钮文案（默认 `Cancel`，由 `ConfirmDialog` 决定）。 */
  cancelLabel?: string;
  /** 确认是否属危险操作（红色按钮）。 */
  danger?: boolean;
}

interface ConfirmStoreState {
  /** 当前待确认请求；null = 对话框关闭。 */
  pending: ConfirmRequest | null;
  /** 弹出确认框并返回用户选择（并发请求时旧请求按**取消**结算 = fail-closed）。 */
  request: (req: ConfirmRequest) => Promise<boolean>;
  /** 结算当前请求。 */
  resolve: (accepted: boolean) => void;
}

/**
 * 挂载点是否已就绪（由 `ConfirmHost` 在挂载时置位）。
 *
 * 为什么需要：`request` 返回的 Promise 只有对话框结算才会 resolve。若宿主组件没挂载
 * （单测环境、早期启动、未来把 AppModals 换掉），调用方会**永久挂起**——比"返回 false"
 * 危险得多。故无宿主时按取消立即结算（fail-closed：绝不静默替用户确认）。
 */
let hostMounted = false;

/** `ConfirmHost` 挂载 / 卸载时同步就绪标记。 */
export function setConfirmHostMounted(mounted: boolean): void {
  hostMounted = mounted;
}

// Promise resolver 存 store 外（模块级）：未决 Promise 不可序列化，不进 zustand 状态。
let resolver: ((accepted: boolean) => void) | null = null;

/**
 * 应用级**唯一**的确认入口（替代 `window.confirm`）。
 *
 * 为什么不用 `window.confirm`：它会阻塞 JS 线程、无法主题化、绕过本应用的
 * `ConfirmDialog`，且在 Tauri 的 WKWebView 下可能直接返回 false —— 用户永远点不到
 * 「确认」，需要确认的降级 / 修复路径变成死路。
 */
export const useConfirmStore = create<ConfirmStoreState>((set) => ({
  pending: null,
  request: (req) => {
    // 并发请求：旧请求按"取消"结算（用户已转向新的确认，旧的视为未确认）。
    resolver?.(false);
    resolver = null;
    if (!hostMounted) {
      return Promise.resolve(false);
    }
    useOverlayStore.getState().setOverlayOpen(CONFIRM_OVERLAY_ID, true);
    set({ pending: req });
    return new Promise<boolean>((res) => {
      resolver = res;
    });
  },
  resolve: (accepted) => {
    useOverlayStore.getState().setOverlayOpen(CONFIRM_OVERLAY_ID, false);
    set({ pending: null });
    resolver?.(accepted);
    resolver = null;
  },
}));

/**
 * 便捷入口：非 React 模块（runner / store action）用它询问用户。
 *
 * @returns 用户是否确认；宿主未挂载时恒为 false（见 {@link setConfirmHostMounted}）。
 */
export function confirmAction(req: ConfirmRequest): Promise<boolean> {
  return useConfirmStore.getState().request(req);
}
