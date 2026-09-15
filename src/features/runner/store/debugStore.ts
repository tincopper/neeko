import { create } from 'zustand';

import { registerDebugPanelCloser } from '@/shared/utils/bottomPanelExclusive';

import { createBreakpointSlice } from './debug/breakpointSlice';
import { createConfigSlice } from './debug/configSlice';
import { createConsoleSlice } from './debug/consoleSlice';
import { createEventsSlice } from './debug/eventsSlice';
import { withExclusiveDebugPanel } from './debug/middleware';
import { createPanelSlice } from './debug/panelSlice';
import { createSessionSlice } from './debug/sessionSlice';
import { EMPTY_BP_LINES } from './debug/shared';
import { createStackSlice } from './debug/stackSlice';
import type { DebugStore } from './debug/types';
import { createVariableSlice } from './debug/variableSlice';

/**
 * Debug store 的**组合根**：把 8 个职责切片拼成唯一 store 实例（21 处消费方零改动）。
 *
 * 依职责切分（各自 state + 动作，互不横向 import，跨 slice 一律经 `get()`）：
 *   panel     面板可见性 / 页签
 *   console   控制台行缓冲（相邻 sys 去重 + 200 行上限）
 *   config    启动配置与入口点（含项目切换时的一次性水合）
 *   session   会话生命周期（启动 / 附加 / 停止 / 控制 / 复位 / 面板级错误）
 *   stack     调用栈、当前帧、求值上下文
 *   variable  变量树惰性展开（引用号缓存随上下文失效）
 *   breakpoint 断点集合
 *   events    DAP 事件 → 各 slice 投影（无自身 state）
 *
 * 依赖方向：`debug/types.ts`（叶子）→ `debug/shared.ts` → 各 slice → `debug/middleware.ts` → 本文件。
 * 「开面板即关 Task Console」是不变式，落在中间件里（只有一处实现），不下沉到各 slice。
 */
export const useDebugStore = create<DebugStore>()(
  withExclusiveDebugPanel((...a) => ({
    ...createPanelSlice(...a),
    ...createConsoleSlice(...a),
    ...createConfigSlice(...a),
    ...createSessionSlice(...a),
    ...createStackSlice(...a),
    ...createVariableSlice(...a),
    ...createBreakpointSlice(...a),
    ...createEventsSlice(...a),
  })),
);

registerDebugPanelCloser(() => {
  useDebugStore.setState({ panelOpen: false });
});

export { EMPTY_BP_LINES };
