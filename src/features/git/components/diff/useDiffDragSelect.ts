import { useCallback, useEffect, useRef, useState } from 'react';

import { computeSelectionRange, selectionKeys } from './diffViewUtils';
import type { DiffPos, SelectionMode } from './diffViewUtils';

/**
 * 拖拽选择多行（AI review 选区）。
 *
 * - mousedown 在某行开始拖拽（左键），记录锚点并阻止原生文本选择；
 * - 行级 mouseenter 实时扩展当前点并生成预览选区；
 * - window mouseup 提交：无位移视为单击（交给 onClick toggle），
 *   有位移则调用 `onDragCommit(keys, mode)`（Shift=追加，否则替换）。
 *
 * `hunkLineCounts` 必须与表格的 key 方案一致（unified 用 hunk.lines.length，
 * split 用 buildSplitRows(hunk).length），否则跨 hunk 选区会越界。
 */
export function useDiffDragSelect(
  hunkLineCounts: number[],
  onDragCommit?: (keys: Set<string>, mode: SelectionMode) => void,
) {
  const anchorRef = useRef<DiffPos | null>(null);
  const currentRef = useRef<DiffPos | null>(null);
  const suppressClickRef = useRef(false);
  const [dragPreview, setDragPreview] = useState<Set<string> | null>(null);

  // mouseenter 回调不随 hunkLineCounts 重建，用 ref 保存最新值；
  // ref 同步放在 effect 中（渲染期写 ref 是 React 反模式）
  const hunkLineCountsRef = useRef(hunkLineCounts);
  useEffect(() => {
    hunkLineCountsRef.current = hunkLineCounts;
  }, [hunkLineCounts]);

  // finishDrag 需要自我注销：通过 ref 间接引用自身，避免闭包自引用
  // （react-hooks/immutability 禁止在声明前访问变量）
  const finishDragRef = useRef<((e: MouseEvent) => void) | null>(null);

  const finishDrag = useCallback(
    (e: MouseEvent) => {
      const handler = finishDragRef.current;
      if (handler) window.removeEventListener('mouseup', handler);
      const anchor = anchorRef.current;
      const current = currentRef.current;
      anchorRef.current = null;
      currentRef.current = null;
      setDragPreview(null);
      if (!anchor || !current) return;
      // 锚点与终点相同 = 单击，交由 onClick 处理 toggle
      if (anchor.hunk === current.hunk && anchor.line === current.line) return;
      const { start, end } = computeSelectionRange(anchor, current);
      const keys = selectionKeys(start, end, hunkLineCountsRef.current);
      suppressClickRef.current = true;
      onDragCommit?.(keys, e.shiftKey ? 'append' : 'replace');
    },
    [onDragCommit],
  );

  useEffect(() => {
    finishDragRef.current = finishDrag;
  }, [finishDrag]);

  const onRowMouseDown = useCallback(
    (e: React.MouseEvent, pos: DiffPos) => {
      if (e.button !== 0) return;
      // 阻止拖拽过程中选中文本
      e.preventDefault();
      anchorRef.current = pos;
      currentRef.current = pos;
      setDragPreview(new Set([`${pos.hunk}:${pos.line}`]));
      window.addEventListener('mouseup', finishDrag);
    },
    [finishDrag],
  );

  const onRowMouseEnter = useCallback((pos: DiffPos) => {
    if (!anchorRef.current) return;
    currentRef.current = pos;
    const { start, end } = computeSelectionRange(anchorRef.current, pos);
    setDragPreview(selectionKeys(start, end, hunkLineCountsRef.current));
  }, []);

  /** 单击经过一次拖拽后调用：若刚提交过拖拽选区则吞掉这次 click。 */
  const shouldSuppressClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    return false;
  }, []);

  useEffect(() => () => window.removeEventListener('mouseup', finishDrag), [finishDrag]);

  return { dragPreview, onRowMouseDown, onRowMouseEnter, shouldSuppressClick };
}
