import { useCallback, useRef, useState } from 'react';

import type { SplitStateInfo } from '@/features/terminal';

/**
 * EditorGroupPane 的分栏状态：pane 数量、分栏方向按钮回调注册。
 */
export function usePaneSplit() {
  const [splitInfo, setSplitInfo] = useState<SplitStateInfo>({
    paneCount: 1,
    canSplit: true,
    activePaneId: 'p1',
  });
  const splitHorizontalRef = useRef<(() => void) | null>(null);
  const splitVerticalRef = useRef<(() => void) | null>(null);
  const closePaneRef = useRef<(() => void) | null>(null);

  const handleSplitStateChange = useCallback((info: SplitStateInfo) => setSplitInfo(info), []);
  const handleSetSplitHorizontal = useCallback((cb: () => void) => {
    splitHorizontalRef.current = cb;
  }, []);
  const handleSetSplitVertical = useCallback((cb: () => void) => {
    splitVerticalRef.current = cb;
  }, []);
  const handleSetClosePane = useCallback((cb: () => void) => {
    closePaneRef.current = cb;
  }, []);

  return {
    splitInfo,
    splitHorizontalRef,
    splitVerticalRef,
    closePaneRef,
    handleSplitStateChange,
    handleSetSplitHorizontal,
    handleSetSplitVertical,
    handleSetClosePane,
  };
}
