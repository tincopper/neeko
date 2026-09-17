// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { shouldReportNoMatch, type RunOutcome } from '../results';

/**
 * 「命令成功但 0 个用例命中」的判定 —— 治理静默失败（Run 链路）。
 * 背景：`cargo test '<name>'` 的目标/过滤器不覆盖该用例时（`examples/`、自定义
 * `[[test]]` path、`test = false` 的目标、名称未对齐），命令 exit 0 却一个用例没跑，
 * 用户只看到 Task Console 有输出、gutter 无状态，无从判断。本判定把这种情形显式化。
 */
describe('shouldReportNoMatch', () => {
  const outcome = (exitCode: number): RunOutcome => ({ exitCode, command: "cargo test 'foo'" });

  it('命中 > 0 → 不报告（正常路径）', () => {
    expect(shouldReportNoMatch(outcome(0), 1, 'rust', false)).toBe(false);
    expect(shouldReportNoMatch(outcome(1), 3, 'rust', false)).toBe(false);
  });

  it('0 命中 + 退出码 0 → 报告（可疑静默失败）', () => {
    const langs = ['rust', 'go', 'java', 'ts'] as const;
    const reported = langs.map((lang) => [lang, shouldReportNoMatch(outcome(0), 0, lang, false)]);
    expect(reported).toEqual([
      ['rust', true],
      ['go', true],
      ['java', true],
      ['ts', true],
    ]);
  });

  it('0 命中 + 退出码非 0 → 不报告（编译/运行失败，Task Console 已有错误输出）', () => {
    const codes = [1, 101, 137];
    const reported = codes.map((code) => [
      code,
      shouldReportNoMatch(outcome(code), 0, 'rust', false),
    ]);
    expect(reported).toEqual([
      [1, false],
      [101, false],
      [137, false],
    ]);
  });

  it('Windows 本地 Rust 的 0 命中 → 不报告（已声明限制：cmd.exe 无 `VAR=x cmd` 前缀，libtest JSON 不可用）', () => {
    expect(shouldReportNoMatch(outcome(0), 0, 'rust', true)).toBe(false);
    // 同一平台下其它语言的结果通道不经 env 前缀，仍应报告
    expect(shouldReportNoMatch(outcome(0), 0, 'go', true)).toBe(true);
    expect(shouldReportNoMatch(outcome(0), 0, 'ts', true)).toBe(true);
  });
});
