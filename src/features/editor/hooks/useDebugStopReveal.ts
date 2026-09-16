/**
 * 停点跟随：把「编辑器应展示当前停点」当作**派生状态**（而非一次性事件）。
 *
 * 旧实现把跳转意图放进全局单槽（`pendingNavigateTarget.debug`），由「命中即清槽 + rAF 兑现」
 * 的两条路径消费：清槽后若兑现落在被销毁 / 未测量的视图上，跳转就**静默丢失且无法补偿**
 * （issue #13 的第二个成因）。这里改为：
 * - **派生**：目标由 `location` + `locationSeq` 推出，不需要任何可清空的槽；
 * - **幂等重放**：视图重建 / 切回 tab（`viewEpoch` 变化）会重跑 effect，丢失后自愈；
 * - **用户接管**：光标被用户挪走后，本次 `seq` 内不再夺回（新停点恢复跟随）；
 * - **释放**：停点结束（`location` 不再匹配本文件）时把光标还回调试前位置 —— 仅当光标
 *   仍停在我们放置的那一行（用户已改动则绝不夺走）。
 *
 * 与黄线共用 `stopMatch` 的匹配判定，避免「黄线在、位置不在」这类口径分叉。
 */
import type { EditorView } from '@codemirror/view';
import { useEffect, useRef, type RefObject } from 'react';

import { useStopLocation, useVisibleDebugSession } from '@/features/runner';

import { applyNavigateCaret, releaseDebugCaret, resolveDocPos } from '../navigateCaret';
import { resolveDebugHighlightLine } from '../stopMatch';

export interface DebugStopRevealParams {
  /** 规范化身份（FileEditor 已算好），用于判定停点是否落在本 tab。 */
  absFilePath: string | null;
  tabFilePath: string | null;
  editorViewRef: RefObject<EditorView | null>;
  /** 视图重建 / 文件 reload 时递增；用于重放（自愈）。 */
  viewEpoch: number;
}

/** 本视图上一次放置的记录。`seq` 是「事件键」：位置值相同也可能是新事件。 */
interface PlacedCaret {
  seq: number;
  line: number;
}

export function useDebugStopReveal({
  absFilePath,
  tabFilePath,
  editorViewRef,
  viewEpoch,
}: DebugStopRevealParams): void {
  const stop = useStopLocation();
  const session = useVisibleDebugSession();
  const targetLine = resolveDebugHighlightLine(
    absFilePath,
    tabFilePath,
    stop,
    session?.status ?? null,
  );
  const placedRef = useRef<PlacedCaret | null>(null);

  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;

    // 分支 1：本视图当前不承载停点（停点结束 / 继续运行 / 切到别的文件）→ 释放。
    if (!stop || targetLine == null) {
      if (placedRef.current) {
        releaseDebugCaret(view, placedRef.current.line);
        placedRef.current = null;
      }
      return;
    }

    // 分支 2：是否新事件 + 光标是否仍在我们放的位置（用户接管的惰性判定）。
    const placed = placedRef.current;
    const isNewEvent = placed?.seq !== stop.seq;
    const sel = view.state.selection.main;
    const caretUntouched =
      placed != null && sel.empty && view.state.doc.lineAt(sel.head).number === placed.line;
    if (!isNewEvent && !caretUntouched) return;

    // 停点行超出文档长度（源码与二进制不一致 / tab 内容陈旧）→ **不伪造位置**。
    // `resolveDocPos` 是钳制语义：越界时会落到末行，而黄线与闪蓝都会因越界被丢弃 ——
    // 用户看到的是「光标停在末行 + 无高亮」，即「跳错了」。这里直接放弃本次放置并留日志，
    // 且**不记账**：下一次停点 / 视图重建会重试（文档内容变更本身不触发本 effect）。
    if (stop.line > view.state.doc.lines) {
      console.warn('[debug] stop line is beyond the document', {
        identity: stop.identity,
        line: stop.line,
        docLines: view.state.doc.lines,
      });
      return;
    }

    // doc 尚未就绪 / 空文档 → 同样不放置、不记账。
    if (!resolveDocPos(view, stop.line, stop.column)) return;

    if (applyNavigateCaret(view, stop.line, stop.column, { rememberPrevCaret: true })) {
      placedRef.current = { seq: stop.seq, line: stop.line };
    }
  }, [stop, targetLine, viewEpoch, editorViewRef]);
}
