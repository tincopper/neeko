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

import { useStopLocation } from '@/features/runner';

import { applyNavigateCaret, releaseDebugCaret, resolveDocPos } from '../navigateCaret';
import { resolveDebugHighlightLine } from '../stopMatch';

export interface DebugStopRevealParams {
  /** 规范源身份（FileEditor 用 `sourceIdentityOf` 算好），用于判定停点是否落在本 tab。 */
  absFilePath: string | null;
  editorViewRef: RefObject<EditorView | null>;
  /** 视图重建 / 文件 reload 时递增；用于重放（自愈）。 */
  viewEpoch: number;
}

/** 本视图上一次放置的记录。`seq` 是「事件键」：位置值相同也可能是新事件。 */
interface PlacedCaret {
  seq: number;
  line: number;
}

/**
 * 越界告警的「同一事件只报一次」记忆（键 = `identity#seq`）。
 *
 * 为什么需要去重：同一 `tabId` 在 split / pinned 布局下有多份挂载（切片 4 之前
 * `FileViewer` 对每个 pane 渲染全部 file tab），且视图重建（`viewEpoch`）会让本 effect
 * 重放 —— 不去重会把同一条诊断打印 2–3 次甚至更多，淹没日志。
 *
 * 只记**最后一条**键（而非累积集合）：多副本是**同时**打印同一键，重放也是同一键，
 * 两者都被挡住；代价是「A 越界 → B 越界 → A 又重放」这种交替场景可能重复打印一次
 * —— 对该诊断而言可接受，换来的是零状态增长、无需清理与容量控制。
 */
let lastOutOfRangeWarnKey: string | null = null;

/** 仅测试使用：清空越界告警记忆，使用例独立（先例：`resetGenerationSeqForTest`）。 */
export function resetOutOfRangeWarnForTests(): void {
  lastOutOfRangeWarnKey = null;
}

function warnOutOfRangeOnce(key: string, info: Record<string, unknown>): void {
  if (lastOutOfRangeWarnKey === key) return;
  lastOutOfRangeWarnKey = key;
  console.warn('[debug] stop line is beyond the document', info);
}

export function useDebugStopReveal({
  absFilePath,
  editorViewRef,
  viewEpoch,
}: DebugStopRevealParams): void {
  // 位置与状态同源、一次订阅（`useStopLocation` 已含 #14 的项目门控）。
  const stop = useStopLocation();
  const targetLine = resolveDebugHighlightLine(absFilePath, stop, stop?.status ?? null);
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
      warnOutOfRangeOnce(`${stop.identity}#${stop.seq}`, {
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
