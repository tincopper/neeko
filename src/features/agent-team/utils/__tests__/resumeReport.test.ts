import { describe, expect, it } from 'vitest';

import type { TeamResumeReport } from '@/shared/types/team';

import { describeResumeReport } from '../resumeReport';

/**
 * 「一次恢复的结果 → 一句话」。
 *
 * 判据只有一条：**四个桶都要能被说出来**。曾经（修复前）用户只能得到一个「恢复会话」的
 * 点击，而回复里谁没回来、为什么没回来都没有落到界面上 —— 「静默少恢复一个」与
 * 「什么都没发生」在界面上长得一模一样。
 *
 * 三条固定口径：`resumed` 永远出现（含 0）；`cold` 带理由文字；`failed` 点名 id。
 */
function report(overrides: Partial<TeamResumeReport> = {}): TeamResumeReport {
  return {
    teamId: 'tm_1',
    resumed: [],
    skippedAlreadyLive: [],
    cold: [],
    failed: [],
    ...overrides,
  };
}

describe('describeResumeReport', () => {
  it('四个桶全空也要说出「恢复 0 个成员」（省略它就是一句空串）', () => {
    expect(describeResumeReport(report())).toBe('恢复 0 个成员');
  });

  it('只恢复了成员：只报恢复了几个（空的桶不出现）', () => {
    expect(describeResumeReport(report({ resumed: ['lead@tm_1', 'w1@tm_1'] }))).toBe(
      '恢复 2 个成员',
    );
  });

  it('已有进程的成员单独成段（幂等不是失败，用户不该以为坏了）', () => {
    expect(
      describeResumeReport(report({ resumed: ['lead@tm_1'], skippedAlreadyLive: ['w1@tm_1'] })),
    ).toBe('恢复 1 个成员；1 个已有进程');
  });

  it('两个 cold 理由各自成段并带**理由文字**（只报数量等于把可行动的信息丢掉）', () => {
    expect(
      describeResumeReport(
        report({
          cold: [
            { memberId: 'w1@tm_1', reason: 'no_native_session' },
            { memberId: 'w2@tm_1', reason: 'no_native_session' },
            { memberId: 'w3@tm_1', reason: 'unsupported_cli' },
          ],
        }),
      ),
    ).toBe('恢复 0 个成员；2 个只能新开（没有会话记录）；1 个只能新开（该 CLI 不支持续接）');
  });

  it('failed 必须点名成员 id（只说「1 个失败」时用户得自己去找是谁）', () => {
    expect(
      describeResumeReport(
        report({ failed: [{ memberId: 'w9@tm_1', error: 'pty did not start' }] }),
      ),
    ).toBe('恢复 0 个成员；1 个失败（w9@tm_1）');
  });

  it('顺序固定：resumed → skipped → cold → failed（同一份报告在任何地方都是同一句话）', () => {
    const text = describeResumeReport(
      report({
        // 后端返回顺序被刻意打乱：理由分组与段落顺序都不许跟着抖动
        cold: [
          { memberId: 'w3@tm_1', reason: 'unsupported_cli' },
          { memberId: 'w1@tm_1', reason: 'no_native_session' },
        ],
        failed: [
          { memberId: 'w8@tm_1', error: 'boom' },
          { memberId: 'w9@tm_1', error: 'boom' },
        ],
        skippedAlreadyLive: ['w2@tm_1'],
        resumed: ['lead@tm_1'],
      }),
    );

    expect(text).toBe(
      '恢复 1 个成员；1 个已有进程；1 个只能新开（没有会话记录）；' +
        '1 个只能新开（该 CLI 不支持续接）；2 个失败（w8@tm_1、w9@tm_1）',
    );
  });

  it('理由顺序与后端数组顺序无关（no_native_session 永远在前）', () => {
    const reversed = describeResumeReport(
      report({
        cold: [
          { memberId: 'b@tm_1', reason: 'unsupported_cli' },
          { memberId: 'a@tm_1', reason: 'no_native_session' },
        ],
      }),
    );
    const forward = describeResumeReport(
      report({
        cold: [
          { memberId: 'a@tm_1', reason: 'no_native_session' },
          { memberId: 'b@tm_1', reason: 'unsupported_cli' },
        ],
      }),
    );

    expect(reversed).toBe(forward);
  });
});
