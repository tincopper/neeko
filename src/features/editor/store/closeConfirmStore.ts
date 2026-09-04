import { create } from 'zustand';

import { closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import { useOverlayStore } from '@/shared/store/overlayStore';
import { getTabDisplayName, isDirtyFileTab } from '@/shared/utils/fileTree';

/** 未保存关闭确认对话框浮层 id（z-order 专项）。 */
const CLOSE_CONFIRM_OVERLAY_ID = 'close-confirm';

/** 未保存关闭确认的用户选择 */
export type CloseAction = 'save' | 'discard' | 'cancel';

/** 保存指定 tab（关闭确认「保存」分支调用）。返回 true 表示保存成功。 */
export type SaveTabAction = (tabId: string) => Promise<boolean>;

interface CloseConfirmStoreState {
  /** 当前待确认的文件名；null = 对话框关闭 */
  pending: { fileName: string } | null;
  /** 弹出确认框并返回用户选择的 Promise（并发请求时旧 Promise resolve 'cancel'） */
  request: (fileName: string) => Promise<CloseAction>;
  /** 用户选择（保存 / 不保存 / 取消）后结算当前请求 */
  resolve: (action: CloseAction) => void;
}

// Promise resolver 存 store 外（模块级）：未决 Promise 不可序列化，不进 zustand 状态。
let resolver: ((action: CloseAction) => void) | null = null;

export const useCloseConfirmStore = create<CloseConfirmStoreState>((set) => ({
  pending: null,
  request: (fileName) => {
    // 并发请求：旧请求按 cancel 结算 —— 用户已转向关闭另一个 tab，旧 tab 保持打开。
    resolver?.('cancel');
    // 浮层上报：对话框打开期间隐藏内容区 Browser webview（z-order 专项，id 幂等）。
    useOverlayStore.getState().setOverlayOpen(CLOSE_CONFIRM_OVERLAY_ID, true);
    set({ pending: { fileName } });
    return new Promise<CloseAction>((res) => {
      resolver = res;
    });
  },
  resolve: (action) => {
    useOverlayStore.getState().setOverlayOpen(CLOSE_CONFIRM_OVERLAY_ID, false);
    set({ pending: null });
    resolver?.(action);
    resolver = null;
  },
}));

/**
 * 三条 tab 关闭路径（TabBar X 按钮 / 菜单 Close Tab / Cmd+W 快捷键）共享的关闭编排：
 * 非 file tab 与非 dirty tab 直接关；dirty 文件 tab 弹三选确认 ——
 * 'cancel' 不关；'discard' 直接关；'save' 保存成功才关（保存失败或 Save As 取消不关）。
 *
 * @returns 是否实际关闭了 tab
 */
export async function closeTabWithConfirmation(
  tabKey: string,
  tabId: string,
  saveTab?: SaveTabAction,
): Promise<boolean> {
  const tab = useEditorStore.getState().tabs[tabKey]?.tabs.find((t) => t.id === tabId);
  if (tab && isDirtyFileTab(tab)) {
    const action = await useCloseConfirmStore.getState().request(getTabDisplayName(tab));
    if (action === 'cancel') return false;
    if (action === 'save') {
      const saved = saveTab ? await saveTab(tabId) : false;
      // 保存失败（含 untitled 的 Save As 取消/失败）→ 不关闭
      if (!saved) return false;
    }
    // 'discard' → 直接关闭
  }
  closeEditorTab(tabKey, tabId);
  return true;
}
