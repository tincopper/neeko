/**
 * 停点代际（Stop Generation）：一次「停点事件 / 栈刷新」的身份。
 *
 * 用途只有一个 —— 判定「这条异步链还算不算数」：`refreshStackAndVars` 入口取新代际，
 * 所有 `await` 之后落地前必须 `isSameGeneration(get().generation, gen)`，否则**整条链放弃**。
 * 没有它，慢链会覆盖快链（迟到者胜），表现为「黄线在新停点、编辑器停在上一个停点」。
 *
 * 设计取舍：
 * - `seq` **全局单调**、`sessionId` 参与相等判定 ⇒ 跨会话不可能被误判成同一代际，
 *   因此不需要 per-session 计数器（更少状态 = 更少出错面）；
 * - 只做**相等**判定、不做大小比较 ⇒ 不需要时钟 / 排序语义。
 * - 计数器放模块级而非 store：它不是 UI 状态、不应被 React 订阅；store 只存
 *   「当前有效代际」这一份。
 */

export interface StopGeneration {
  sessionId: string;
  seq: number;
}

let seq = 0;

/** 取下一个代际。每次「停点事件 / 栈刷新」调用一次。 */
export function nextGeneration(sessionId: string): StopGeneration {
  seq += 1;
  return { sessionId, seq };
}

/** 代际相等（当前有效代际判定）。`null` / `undefined` 永不相等。 */
export function isSameGeneration(
  a: StopGeneration | null | undefined,
  b: StopGeneration | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.sessionId === b.sessionId && a.seq === b.seq;
}

/** 仅测试使用：重置模块级计数器，使用例不依赖执行顺序。 */
export function resetGenerationSeqForTest(): void {
  seq = 0;
}

/**
 * 「停点上下文未变」—— 用于**切帧**这类「捕获一次、await 后复查」的场景。
 *
 * 与 {@link isSameGeneration} 的区别在于**双方皆无代际**时：
 * - `isSameGeneration(null, null) === false`：这是**有意的** —— 链条是 `beginStop` 起的，
 *   若 store 的代际变成 null（continued / terminated / 复位），在途链必须被丢弃；
 * - 但切帧不 `beginStop`，它只是捕获「当前代际」以便 await 后复查。此时「捕获时无代际、
 *   复查时仍无代际」表示**什么都没发生**，应当继续（否则未经过 `beginStop` 的停止态——
 *   如 attach 到已暂停进程 / 测试直接 seed frames+session——切帧会静默不写变量、不打开源码 tab）。
 *
 * 三种情形：双方皆无 → 未变；仅一侧无 → 已变；都有 → 比代际身份。
 */
export function stopContextUnchanged(
  current: StopGeneration | null,
  captured: StopGeneration | null,
): boolean {
  if (current === null || captured === null) return current === captured;
  return isSameGeneration(current, captured);
}
