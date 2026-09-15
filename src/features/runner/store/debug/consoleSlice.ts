import type { ConsoleLine } from '../../types';

import { nextConsoleSeq } from './shared';
import type { DebugConsoleSlice, DebugSliceCreator } from './types';

/**
 * 控制台行缓冲。
 *
 * 不变式：只丢弃**相邻重复的系统行**（我们自己的 Starting/Started/status 会因重渲染重复触发）；
 * 程序输出（`out`/`err`）必须逐字保留 —— 循环打印相同内容（如两次 `println("0:2")`）是合法行为，
 * 去重会掩盖真实输出。缓冲区上限 200 行。
 */
export const createConsoleSlice: DebugSliceCreator<DebugConsoleSlice> = (set, get) => ({
  consoleLines: [],

  pushConsole: (kind, text) => {
    const lines = get().consoleLines;
    const last = lines[lines.length - 1];
    if (kind === 'sys' && last && last.kind === 'sys' && last.text === text) {
      return;
    }
    const line: ConsoleLine = {
      id: nextConsoleSeq(),
      kind,
      text,
    };
    set({ consoleLines: [...lines.slice(-200), line] });
  },
});
