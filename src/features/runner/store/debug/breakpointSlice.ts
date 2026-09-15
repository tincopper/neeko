import { dapGetBreakpoints, dapSetBreakpoints } from '../../api/debugApi';
import type { BreakpointSpec } from '../../types';

import { EMPTY_BP_LINES, isLiveSession, notifyError } from './shared';
import type { DebugBreakpointSlice, DebugSliceCreator } from './types';

/** 断点集合（`projectId → filePath → lines`，行号始终升序、去重）。 */
export const createBreakpointSlice: DebugSliceCreator<DebugBreakpointSlice> = (set, get) => ({
  breakpoints: {},

  toggleBreakpoint: async (projectId, filePath, line) => {
    const current = get().getFileBreakpoints(projectId, filePath);
    const next = current.includes(line)
      ? current.filter((l) => l !== line)
      : [...current, line].sort((a, b) => a - b);

    const projectBps = { ...(get().breakpoints[projectId] ?? {}) };
    if (next.length === 0) delete projectBps[filePath];
    else projectBps[filePath] = next;
    set({
      breakpoints: { ...get().breakpoints, [projectId]: projectBps },
    });

    try {
      const live = isLiveSession(get().session) ? get().session?.sessionId : null;
      const returned = await dapSetBreakpoints(projectId, filePath, next, live);
      // Offline/no-session: backend echoes lines with verified=false — still keep them.
      // Live session: adapter may remap to a nearby executable line.
      if (next.length === 0) {
        // already cleared optimistically
        return;
      }
      const returnedLines = [...new Set(returned.map((b) => b.line).filter((l) => l > 0))].sort(
        (a, b) => a - b,
      );
      // Prefer verified locations when the adapter confirmed any; otherwise keep all returned.
      const confirmed = returned
        .filter((b) => b.verified === true && b.line > 0)
        .map((b) => b.line);
      const finalLines =
        confirmed.length > 0
          ? [...new Set(confirmed)].sort((a, b) => a - b)
          : returnedLines.length > 0
            ? returnedLines
            : next;
      const projectBps2 = { ...(get().breakpoints[projectId] ?? {}) };
      projectBps2[filePath] = finalLines;
      set({
        breakpoints: { ...get().breakpoints, [projectId]: projectBps2 },
      });
    } catch (e) {
      const msg = String(e);
      set({ error: msg });
      notifyError(msg);
    }
  },

  removeBreakpoint: async (projectId, filePath, line) => {
    const current = get().getFileBreakpoints(projectId, filePath);
    if (!current.includes(line)) return;
    await get().toggleBreakpoint(projectId, filePath, line);
  },

  loadBreakpoints: async (projectId) => {
    try {
      const list = await dapGetBreakpoints(projectId);
      const remote: Record<string, number[]> = {};
      for (const b of list) {
        (remote[b.filePath] ??= []).push(b.line);
      }
      for (const lines of Object.values(remote)) {
        lines.sort((a, b) => a - b);
      }
      // Disk is source of truth on load (survives restart)
      set({
        breakpoints: { ...get().breakpoints, [projectId]: remote },
      });
    } catch {
      // keep local
    }
  },

  getFileBreakpoints: (projectId, filePath) => {
    return get().breakpoints[projectId]?.[filePath] ?? EMPTY_BP_LINES;
  },

  listAllBreakpoints: (projectId) => {
    const map = get().breakpoints[projectId] ?? {};
    const out: BreakpointSpec[] = [];
    for (const [filePath, lines] of Object.entries(map)) {
      for (const line of lines) {
        out.push({ filePath, line });
      }
    }
    out.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line);
    return out;
  },

  breakpointCount: (projectId) => {
    if (!projectId) return 0;
    const map = get().breakpoints[projectId] ?? {};
    let n = 0;
    for (const lines of Object.values(map)) n += lines.length;
    return n;
  },
});
