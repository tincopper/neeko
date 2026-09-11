/**
 * tier ①（LSP runnable）覆盖的**状态定义**（叶子模块，无内部依赖）。
 *
 * 拆出理由：这三个定义被**两个方向**使用 —— `runMarkers.ts` **读**覆盖结果构建 marker payload，
 * `runContribution.ts` 的异步 loader **写**入结果。若把它放进任一使用方，都会形成
 * `markers ↔ contribution` 的循环依赖；放成本层叶子模块后依赖保持单向。
 */
import { StateEffect, StateField } from '@codemirror/state';

import type { LspRunnable } from '../runnables/runnable';

/** Debounced reparse trigger (dispatched from the update listener after doc changes). */
export const refreshRunCodelensEffect = StateEffect.define<null>();

/**
 * LSP runnable 覆盖（行号 1-based → runnable），由**异步** provider 注入。
 *
 * 刻意做成 StateField 而不是读全局 store/闭包：快路径 markers 的构建（`StateField.create`）
 * 必须保持**同步纯函数**，异步结果只能在就绪后经 effect 落进来。
 */
export const setLspRunnablesEffect = StateEffect.define<Map<number, LspRunnable>>();

export const lspRunnablesField = StateField.define<Map<number, LspRunnable>>({
  create: () => new Map(),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setLspRunnablesEffect)) return e.value;
    }
    return value;
  },
});
