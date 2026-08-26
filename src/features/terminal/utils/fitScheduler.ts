/**
 * Resize 统一入口调度器：RAF 合帧 + 120ms trailing 兜底 + 收敛去重 + 失败 pending 重试
 * 四触发源（RO/attach/字体/session-ready）统一调用。
 */

export interface FitEntry {
  term: { cols: number; rows: number };
  fitAddon: { fit: () => void };
  sessionId: string | null;
}

export interface FitSchedulerDeps {
  getEntry: () => FitEntry | null;
  resize: (sessionId: string, cols: number, rows: number) => Promise<void>;
}

export function createFitScheduler(deps: FitSchedulerDeps) {
  let rafId: number | null = null;
  let trailingId: number | undefined;
  let lastCols = -1;
  let lastRows = -1;
  let pendingCols: number | null = null;
  let pendingRows: number | null = null;

  const doFit = () => {
    const c = deps.getEntry();
    if (!c) return;
    const colsBefore = c.term.cols;
    const rowsBefore = c.term.rows;
    try {
      c.fitAddon.fit();
    } catch {
      return;
    }
    const colsAfter = c.term.cols;
    const rowsAfter = c.term.rows;
    const converged = colsAfter === colsBefore && rowsAfter === rowsBefore;
    if (converged && pendingCols === null) return;
    if (colsAfter === lastCols && rowsAfter === lastRows && pendingCols === null) return;
    if (!c.sessionId) {
      pendingCols = colsAfter;
      pendingRows = rowsAfter;
      return;
    }
    const targetCols = colsAfter;
    const targetRows = rowsAfter;
    deps.resize(c.sessionId, targetCols, targetRows).then(
      () => {
        lastCols = targetCols;
        lastRows = targetRows;
        pendingCols = null;
        pendingRows = null;
      },
      () => {
        pendingCols = targetCols;
        pendingRows = targetRows;
      },
    );
  };

  const scheduleFit = () => {
    if (trailingId !== undefined) window.clearTimeout(trailingId);
    trailingId = window.setTimeout(() => {
      trailingId = undefined;
      doFit();
    }, 120);
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      doFit();
    });
  };

  const dispose = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (trailingId !== undefined) window.clearTimeout(trailingId);
    rafId = null;
    trailingId = undefined;
  };

  return {
    scheduleFit,
    dispose,
    /** test-only introspection */
    _getState: () => ({ lastCols, lastRows, pendingCols, pendingRows }),
  };
}
