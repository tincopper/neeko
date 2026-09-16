/**
 * 停点黄线（持久标记）——只负责标记，不再负责光标。
 *
 * 光标跟随（放置 / 接管判定 / 释放）归 [`useDebugStopReveal`](./useDebugStopReveal.ts)：
 * 两者职责不同（黄线是**幂等装饰**，光标是**有接管语义的一次性动作**），此前混在一个 hook 里，
 * 释放走的是「黄线变 null → 顺带还光标」的间接路径，判定不透明。
 *
 * `currentLineDecoField` 由统一 gutter 的扩展集安装（`useBreakpointGutter`）；
 * 本 hook 只按停点变化 / 视图重建派发装饰效果。
 */
import type { EditorView } from '@codemirror/view';
import { useEffect, type RefObject } from 'react';

import { useStopLocation, useVisibleDebugSession } from '@/features/runner';

import { resolveDebugHighlightLine } from '../stopMatch';

import { applyDebugCurrentLine } from './useBreakpointGutter';

export function useCurrentLineHighlight(
  absFilePath: string | null,
  tabFilePath: string | null,
  editorViewRef: RefObject<EditorView | null>,
  viewEpoch: number,
): void {
  // `useStopLocation` 已含「会话属于当前项目」门控（#14）；状态门由匹配函数统一处理。
  const stop = useStopLocation();
  const session = useVisibleDebugSession();
  const highlightedLine = resolveDebugHighlightLine(
    absFilePath,
    tabFilePath,
    stop,
    session?.status ?? null,
  );

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    applyDebugCurrentLine(view, highlightedLine);
  }, [highlightedLine, editorViewRef, viewEpoch]);
}
