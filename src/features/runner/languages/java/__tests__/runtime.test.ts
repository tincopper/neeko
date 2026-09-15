import { describe, expect, it } from 'vitest';

import { isZeroTestSummary } from '../runtime';

describe('isZeroTestSummary — 选择器不变式 ② 的判据', () => {
  it('识别真机的零用例汇总行（缩进不固定）', () => {
    expect(isZeroTestSummary('[         0 tests found           ]')).toBe(true);
    expect(isZeroTestSummary('[0 containers found]')).toBe(true);
    expect(isZeroTestSummary('[ 0 test found ]')).toBe(true);
  });

  it('有用例、或"跑了但失败"都不得误判为零用例', () => {
    expect(isZeroTestSummary('[         1 tests found           ]')).toBe(false);
    expect(isZeroTestSummary('[         4 containers found      ]')).toBe(false);
    // 有用例但全部失败：不得当作"零用例"终止会话。
    expect(isZeroTestSummary('[         0 tests successful      ]')).toBe(false);
    expect(isZeroTestSummary('[         1 tests failed          ]')).toBe(false);
    expect(isZeroTestSummary('Test run finished after 22 ms')).toBe(false);
  });
});
