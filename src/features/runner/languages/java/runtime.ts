/**
 * JUnit Console Launcher 汇总行的判定（纯函数，Java 专属）。
 *
 * 住在 `languages/java/`：判据只服务 Java 会话（Console Launcher 汇总行），
 * 通用 store 经 `LanguageModule.debugHooks.inspectConsoleLine` 消费它（阶段 4 接线）。
 */

/**
 * 汇总行是否表示**零用例**（选择器不变式 ② 的判据）。
 *
 * 真机格式：`[         0 tests found           ]`（缩进/空白不固定）。
 * 只匹配 `found` —— `0 tests successful` 在"有用例但失败"时也会出现，用它判定会误杀。
 */
export function isZeroTestSummary(line: string): boolean {
  return /\[\s*0\s+(tests?|containers?)\s+found\s*\]/i.test(line);
}

/**
 * 会话输出不变式 ②（选择器）：Console Launcher 汇总「0 用例」→ **终止会话 + 明确报错**，
 * 不允许留下「running 但断点永不命中」的静默会话（design §0.3 / §3）。
 *
 * 纯函数（状态由调用方传入），故可脱离 store 单测；`stopped` 的**一次语义**由调用方的
 * `alreadyReported` 闩锁保证（同一个会话只报一次）。
 */
export function javaConsoleInvariant(
  line: string,
  state: { backendLabel: string | null; alreadyReported: boolean },
): { stop: true; message: string } | null {
  // 只在 JDTLS 后端成立：host（自写 adapter）路径的启动失败有自己的呈现。
  if (state.backendLabel !== 'jdtls' || state.alreadyReported) return null;
  if (!isZeroTestSummary(line)) return null;
  return {
    stop: true,
    message:
      'No tests were discovered for the requested selector — stopping the session. ' +
      'Check the test method name, or that the project finished importing.',
  };
}
