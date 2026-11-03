import { useCallback } from 'react';
import type React from 'react';

import { isEditableElement, resolveShortcut } from '../utils/shortcuts';

/**
 * 面板级快捷键的**接线层**（判据在 [`utils/shortcuts.ts`](../utils/shortcuts.ts)，design §11.7）。
 *
 * # 监听器挂在面板根元素上，不挂 `document`
 *
 * 挂 `document` 会让快捷键在整个应用里生效：用户在终端里按 `Cmd+N`（新建终端标签）时会
 * 同时新建一个工作项，而面板可能根本没开。挂在面板根 div 的 `onKeyDown` 上，只有**焦点在
 * 面板内部**时才收得到事件 —— 这就是 PRD 说的「面板获得焦点」的全部含义，不需要额外的
 * 焦点状态或 `document.hasFocus()`。
 *
 * # 为什么还要再看一眼 `document.activeElement`
 *
 * 事件从焦点元素冒泡上来，所以在搜索框里按 Backspace **也会**到这里。判据需要知道
 * 「这次按键是不是在编辑文本」，而 `event.target` 与 `document.activeElement` 在合成事件里
 * 语义不同（前者是事件源，后者是真实焦点）—— 用 `activeElement` 更接近「用户此刻在哪儿打字」。
 *
 * # 动作由宿主给
 *
 * 本 hook 不认识 store、不认识对话框：三个回调就是三个动作。`preventDefault()` 只在
 * 判据真的认领了这次按键时调用 —— 否则会把 `Cmd+N` 从别处（浏览器新窗口）也一起吃掉。
 */
export interface PanelShortcutState {
  /** 新建 / 编辑对话框开着。 */
  dialogOpen: boolean;
  /** 有选中的行（今天选中即详情面板打开）。 */
  hasSelection: boolean;
}

export interface PanelShortcutHandlers {
  onCreate: () => void;
  /** 删除**选中的**那一行（实现复用详情面板的删除入口：同一个乐观删除 + 撤销窗口）。 */
  onDelete: () => void;
  /** 关闭详情面板（对话框的 Escape 由 Radix Dialog 自己处理，见判据文件头）。 */
  onClose: () => void;
}

export function usePanelShortcuts(
  state: PanelShortcutState,
  handlers: PanelShortcutHandlers,
): (event: React.KeyboardEvent<HTMLElement>) => void {
  const { dialogOpen, hasSelection } = state;
  const { onCreate, onDelete, onClose } = handlers;

  return useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const action = resolveShortcut(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
        },
        {
          editable: isEditableElement(document.activeElement),
          dialogOpen,
          hasSelection,
        },
      );

      if (action === null) return;
      event.preventDefault();

      if (action === 'create') onCreate();
      else if (action === 'delete') onDelete();
      else onClose();
    },
    [dialogOpen, hasSelection, onCreate, onDelete, onClose],
  );
}
