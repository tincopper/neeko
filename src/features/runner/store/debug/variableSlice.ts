import { dapVariablesByReference } from '../../api/debugApi';

import { isLiveSession } from './shared';
import type { DebugSliceCreator, DebugVariableSlice } from './types';

/**
 * 变量树的惰性展开。
 *
 * 不变式：缓存键为 DAP `variablesReference`，**只在当前暂停上下文内有效** —— 失效由
 * 栈/会话切换侧统一清空（见 `shared.ts::CLEAR_EXPANSION`），本 slice 只负责本帧内的
 * 展开 / 折叠 / 错误记录。
 */
export const createVariableSlice: DebugSliceCreator<DebugVariableSlice> = (set, get) => ({
  childrenByRef: {},
  expandedRefs: {},
  loadingRefs: {},
  varErrors: {},

  toggleVariableExpand: async (ref) => {
    const sid = get().session?.sessionId;
    if (!sid || !isLiveSession(get().session) || ref <= 0) return;

    // Collapse.
    if (get().expandedRefs[ref]) {
      set({ expandedRefs: { ...get().expandedRefs, [ref]: false } });
      return;
    }
    // Re-expand from cache.
    if (get().childrenByRef[ref]) {
      set({ expandedRefs: { ...get().expandedRefs, [ref]: true } });
      return;
    }
    // First expand: fetch children lazily.
    const varErrors = { ...get().varErrors };
    delete varErrors[ref];
    set({
      expandedRefs: { ...get().expandedRefs, [ref]: true },
      loadingRefs: { ...get().loadingRefs, [ref]: true },
      varErrors,
    });
    try {
      const children = await dapVariablesByReference(sid, ref);
      set({
        childrenByRef: { ...get().childrenByRef, [ref]: children },
        loadingRefs: { ...get().loadingRefs, [ref]: false },
      });
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, '');
      set({
        expandedRefs: { ...get().expandedRefs, [ref]: false },
        loadingRefs: { ...get().loadingRefs, [ref]: false },
        varErrors: { ...get().varErrors, [ref]: msg },
      });
    }
  },
});
