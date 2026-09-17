/**
 * 用户意图导航目标的「兑现器」：把 `editorStore.navigateGoal`（目标状态模型）兑现到
 * 本 tab 的 CodeMirror 视图上。目标状态 API 收敛在 editorStore，兑现机制收敛在本 hook ——
 * 生产方只调 `setNavigateGoal`，不感知兑现细节。
 *
 * 与旧「一次性单槽 + rAF 时间窗猜测」的差别：
 * - **就绪屏障**：应用经 `view.requestMeasure` 的 write 阶段执行（测量完成后运行），
 *   替代「猜一帧够不够」的 rAF 时间窗；
 * - **货币性检查**：write 内重读 store（seq + tabKey + tabId），StrictMode 双挂载 /
 *   新 seq 取代 / 视图销毁三个窗口在此一并关闭 —— 恰好一次（I2）、新意图压旧意图（I3）；
 * - **不丢**（I1）：goal 写入时视图尚不存在也不丢 —— 挂载路径（`consumeOnViewCreate`）
 *   与视图重建重放（`viewEpoch`）都会补兑现。
 *
 * 停点跟随（派生模型，幂等可重放）归 `useDebugStopReveal`；本 hook 只处理用户意图。
 */
import type { EditorView } from '@codemirror/view';
import { useCallback, useEffect } from 'react';

import { useEditorStore } from '@/shared/store/editorStore';

import { applyNavigateCaret } from '../navigateCaret';

interface UseNavigateGoalArgs {
  tabKey: string;
  tabId: string;
  editorViewRef: React.MutableRefObject<EditorView | null>;
  /** 视图重建 / 文件 reload 时递增；变化时对仍匹配的 goal 重放（自愈，与停点跟随同一纪律）。 */
  viewEpoch: number;
}

/** CM 未公开 `destroyed`（d.ts 标 private），运行时字段存在：整对象收窄到含该字段的形状。 */
function isViewDestroyed(view: EditorView): boolean {
  // 编译器因 private 重载把交集塌缩成 never，只能经 unknown 收窄；运行时字段可读，
  // 语义由 CM 源码（EditorView.destroyed = false 起始、destroy() 置 true）背书。
  const withDestroyed = view as unknown as { readonly destroyed: boolean };
  return withDestroyed.destroyed;
}

export function useNavigateGoal({ tabKey, tabId, editorViewRef, viewEpoch }: UseNavigateGoalArgs) {
  /**
   * 把 seq 指定的 goal 调度到 view 的测量后 write 阶段兑现。
   *
   * CM 的 measure 循环先跑 `read` 再跑 `write`（两者都必须存在：仅 write 的请求会在
   * read 阶段抛错、write 被跳过）。write 阶段处于 CM 更新周期内，`view.dispatch`
   * 被禁止 —— 因此 write 只负责**武装兑现**：`queueMicrotask` 在 measure() 完全返回
   * （updateState 复位、布局已测量）后立即执行，早于下一帧 —— 这就是就绪屏障。
   * 微任务内重读 store 做货币性检查：goal 已被消费 / 被新 seq 取代 / tab 不匹配 → 放弃。
   */
  const applyGoal = useCallback(
    (seq: number, view: EditorView) => {
      view.requestMeasure({
        read: () => undefined,
        write: () => {
          queueMicrotask(() => {
            if (isViewDestroyed(view)) return;
            const goal = useEditorStore.getState().navigateGoal;
            if (!goal || goal.seq !== seq || goal.tabKey !== tabKey || goal.tabId !== tabId) return;
            const ok = applyNavigateCaret(view, goal.line, goal.col);
            // 恰好一次：无论成败都按 seq 清除（失败滞留只会造成迟到的陈旧跳转）。
            useEditorStore.getState().clearNavigateGoal(seq);
            if (!ok) {
              console.warn('[NavigateGoal] apply failed (invalid position), goal dropped', {
                seq,
                line: goal.line,
                col: goal.col,
              });
            }
          });
        },
      });
    },
    [tabKey, tabId],
  );

  /**
   * onCreateEditor 内调用：goal 匹配本 tab → 调度兑现并返回 true
   * （调用方据此跳过 snapshot 恢复 —— 目标优先于快照）；不匹配返回 false。
   */
  const consumeOnViewCreate = useCallback((): boolean => {
    const goal = useEditorStore.getState().navigateGoal;
    if (!goal || goal.tabKey !== tabKey || goal.tabId !== tabId) return false;
    const view = editorViewRef.current;
    if (!view) return false;
    applyGoal(goal.seq, view);
    return true;
  }, [tabKey, tabId, editorViewRef, applyGoal]);

  // goal 写入时视图已存在 → 兑现（复用既有 tab 的路径）；视图为 null（挂载路径
  // 尚未跑到）→ 不动，挂载路径会消费。
  useEffect(() => {
    return useEditorStore.subscribe((state) => {
      const goal = state.navigateGoal;
      if (!goal || goal.tabKey !== tabKey || goal.tabId !== tabId) return;
      const view = editorViewRef.current;
      if (!view) return;
      applyGoal(goal.seq, view);
    });
  }, [tabKey, tabId, editorViewRef, applyGoal]);

  // 视图重建（viewEpoch 变化）→ goal 仍匹配且视图存活 → 重放（自愈）。
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view) return;
    const goal = useEditorStore.getState().navigateGoal;
    if (!goal || goal.tabKey !== tabKey || goal.tabId !== tabId) return;
    applyGoal(goal.seq, view);
  }, [viewEpoch, tabKey, tabId, editorViewRef, applyGoal]);

  return { consumeOnViewCreate };
}
