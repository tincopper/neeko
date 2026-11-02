/**
 * `invoke` 的拒绝原因 → **可读原文**（全仓唯一实现）。
 *
 * # 为什么必须只有一份
 *
 * 这段逻辑此前在三个地方各写了一遍（`agent-team/utils/errors.ts`、
 * `git/utils/prLoadError.ts` 的 `getInvokeErrorMessage`、以及若干组件里的内联 `catch`）。
 * 它们的判断顺序（字符串 → `Error.message` → `String(err)` → fallback）与「`[object Object]`
 * 不算消息」这条边角完全一样，任何一处的独自漂移都表现为「同一个后端错误在两个面板上
 * 说法不同」，而且两边都自洽、没有一处报错。所以它沉到 `shared/`：
 * feature 可以 import shared，反向禁止（见 `src/AGENTS.md` 的导入防火墙）。
 *
 * # 为什么不改写内容
 *
 * 后端 `AppError` 的 `Display` 已经是给人看的句子（`Unsupported: …` / `Not found: …`）。
 * 前端自己编一句「操作失败」会把唯一有用的信息丢掉；`fallback` 只在**真的什么也没有**
 * 时出现（`null` / `undefined` / 空串）。
 */
export function invokeErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err.trim() !== '') return err.trim();
  if (err instanceof Error && err.message.trim() !== '') return err.message.trim();
  if (err != null) {
    const text = String(err);
    // `String({})` 是 `'[object Object]'`：那是「没有消息」而不是一条消息。
    if (text !== '' && text !== '[object Object]') return text;
  }
  return fallback;
}
