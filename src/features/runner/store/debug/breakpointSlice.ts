import {
  dapGetBreakpoints,
  dapGetBreakpointsMuted,
  dapSetBreakpoints,
  dapSetBreakpointsMuted,
} from '../../api/debugApi';
import type { BreakpointEntry, BreakpointSpec } from '../../types';

import { EMPTY_BP_ENTRIES, isLiveSession, notifyError } from './shared';
import type { DebugBreakpointSlice, DebugSliceCreator } from './types';

/** 断点集合（`projectId → filePath → entries`，行号升序、`(line)` 唯一）。
 *  `enabled` 是 `(file, line)` 身份的属性位：禁用留模型、不进适配器载荷。 */
export const createBreakpointSlice: DebugSliceCreator<DebugBreakpointSlice> = (set, get) => ({
  breakpoints: {},
  breakpointsMuted: {},

  toggleBreakpoint: async (projectId, filePath, line) => {
    const current = get().getFileBreakpoints(projectId, filePath);
    const has = current.some((e) => e.line === line);
    const next: BreakpointEntry[] = has
      ? current.filter((e) => e.line !== line)
      : [...current, { line, enabled: true }].sort((a, b) => a.line - b.line);

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
      const merged = mergeBreakpointEntries(next, returned);
      const projectBps2 = { ...(get().breakpoints[projectId] ?? {}) };
      if (merged.length === 0) delete projectBps2[filePath];
      else projectBps2[filePath] = merged;
      set({
        breakpoints: { ...get().breakpoints, [projectId]: projectBps2 },
      });
    } catch (e) {
      // 存在性 toggle 维持不回滚（既有语义）——错误进 console。
      const msg = String(e);
      set({ error: msg });
      notifyError(msg);
    }
  },

  setBreakpointEnabled: async (projectId, filePath, line, enabled) => {
    const current = get().getFileBreakpoints(projectId, filePath);
    if (!current.some((e) => e.line === line)) return; // 缺行 no-op
    const next: BreakpointEntry[] = current
      .map((e) => (e.line === line ? { line, enabled } : e))
      .sort((a, b) => a.line - b.line);

    // 可写位（enabled）乐观更新；失败回滚（评审 P7，与 mute 同策略）。
    const projectBps = { ...(get().breakpoints[projectId] ?? {}) };
    projectBps[filePath] = next;
    set({
      breakpoints: { ...get().breakpoints, [projectId]: projectBps },
    });

    try {
      const live = isLiveSession(get().session) ? get().session?.sessionId : null;
      const returned = await dapSetBreakpoints(projectId, filePath, next, live);
      const merged = mergeBreakpointEntries(next, returned);
      const projectBps2 = { ...(get().breakpoints[projectId] ?? {}) };
      projectBps2[filePath] = merged;
      set({
        breakpoints: { ...get().breakpoints, [projectId]: projectBps2 },
      });
    } catch (e) {
      const projectBps3 = { ...(get().breakpoints[projectId] ?? {}) };
      projectBps3[filePath] = [...current];
      set({
        breakpoints: { ...get().breakpoints, [projectId]: projectBps3 },
      });
      const msg = String(e);
      set({ error: msg });
      notifyError(msg);
    }
  },

  removeBreakpoint: async (projectId, filePath, line) => {
    const current = get().getFileBreakpoints(projectId, filePath);
    if (!current.some((e) => e.line === line)) return;
    await get().toggleBreakpoint(projectId, filePath, line);
  },

  setBreakpointsMuted: async (projectId, muted) => {
    const prev = get().breakpointsMuted[projectId] ?? false;
    if (prev === muted) return;
    // 乐观更新；entries 不动（D8：叠加态，不改单个位）。
    set({
      breakpointsMuted: { ...get().breakpointsMuted, [projectId]: muted },
    });
    try {
      await dapSetBreakpointsMuted(projectId, muted);
    } catch (e) {
      // 失败回滚（评审 P7）
      set({
        breakpointsMuted: { ...get().breakpointsMuted, [projectId]: prev },
      });
      const msg = String(e);
      set({ error: msg });
      notifyError(msg);
    }
  },

  loadBreakpoints: async (projectId) => {
    try {
      const [list, muted] = await Promise.all([
        dapGetBreakpoints(projectId),
        dapGetBreakpointsMuted(projectId),
      ]);
      const remote: Record<string, BreakpointEntry[]> = {};
      for (const b of list) {
        (remote[b.filePath] ??= []).push({ line: b.line, enabled: b.enabled ?? true });
      }
      for (const entries of Object.values(remote)) {
        entries.sort((a, b) => a.line - b.line);
      }
      // Disk is source of truth on load (survives restart)
      set({
        breakpoints: { ...get().breakpoints, [projectId]: remote },
        breakpointsMuted: { ...get().breakpointsMuted, [projectId]: muted },
      });
    } catch {
      // keep local
    }
  },

  getFileBreakpoints: (projectId, filePath) => {
    return get().breakpoints[projectId]?.[filePath] ?? EMPTY_BP_ENTRIES;
  },

  listAllBreakpoints: (projectId) => {
    const map = get().breakpoints[projectId] ?? {};
    const out: BreakpointSpec[] = [];
    for (const [filePath, entries] of Object.entries(map)) {
      for (const e of entries) {
        out.push({ filePath, line: e.line, enabled: e.enabled });
      }
    }
    out.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line);
    return out;
  },

  breakpointCount: (projectId) => {
    if (!projectId) return 0;
    const map = get().breakpoints[projectId] ?? {};
    let n = 0;
    for (const entries of Object.values(map)) n += entries.length;
    return n;
  },
});

/**
 * 后端回传（verified 归一）与 UI 全量 entries 的按行 merge —— **评审 P2**。
 *
 * 语义（DAP 回显按请求 1:1，只覆盖**下发过的有效行**，disabled 行不在其中）：
 * - 模型保留原则：disabled 行**永远留在模型**（enabled 原样），绝不被回显吞掉；
 *   sent 中 enabled 且被回显的行保留为 enabled —— 无论该行回显 `verified` 与否
 *   （verified=false 只是「尚未确认命中」，不是「删除断点」）。
 * - remap 替换：sent 中 enabled 但**未出现在回显**的行 = 被适配器 remap 走 → 由回显的
 *   remap 目标行替换（目标行无论 verified 与否都进模型，保持 enabled）；remap 落到原本
 *   disabled 的行 → 同行一个 entry、确认行 **enabled 优先**。
 * - 回显为空（mute 扣留 / 无会话）：模型原样保留。
 */
export function mergeBreakpointEntries(
  sent: readonly BreakpointEntry[],
  returned: BreakpointSpec[],
): BreakpointEntry[] {
  const echoed = new Set(returned.filter((b) => b.line > 0).map((b) => b.line));
  if (echoed.size === 0) {
    // 无回显（mute 扣留 / 无会话）：模型原样保留（enabled 不动）。
    return sent.map((e) => ({ ...e }));
  }
  const sentLines = new Set(sent.map((e) => e.line));
  const result = new Map<number, boolean>();
  for (const e of sent) {
    if (!e.enabled) result.set(e.line, false);
    else if (echoed.has(e.line)) result.set(e.line, true);
  }
  for (const b of returned) {
    if (b.line <= 0) continue;
    // 确认行（verified=true，含 remap 到 sent 已有行）强制 enabled（"enabled 优先"）；
    // 回显中出现但 sent 没有的行 = remap 目标 → 追加为 enabled。其余（离线回显的
    // disabled 行）保留 sent 的 enabled 位，不被吞掉。
    if (b.verified === true || !sentLines.has(b.line)) result.set(b.line, true);
  }
  return [...result.entries()]
    .map(([line, enabled]) => ({ line, enabled }))
    .sort((a, b) => a.line - b.line);
}
