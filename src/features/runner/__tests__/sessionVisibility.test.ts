// @vitest-environment node
/**
 * `isSessionVisibleFor` —— #14 门控的唯一实现（纯函数，100% 覆盖）。
 */
import { describe, expect, it } from 'vitest';

import { isSessionVisibleFor } from '../sessionVisibility';
import type { DapSessionInfo } from '../types';

function session(projectId: string): DapSessionInfo {
  return {
    sessionId: 's1',
    projectId,
    projectPath: '/repo',
    configName: 'cfg',
    status: 'stopped',
  };
}

describe('isSessionVisibleFor — 会话只对「自己的项目」可见（#14）', () => {
  it('会话项目与目标项目一致 → 可见', () => {
    expect(isSessionVisibleFor(session('p1'), 'p1')).toBe(true);
  });

  it('会话属于别的项目 → 不可见（切项目后旧会话不得污染新项目 UI）', () => {
    expect(isSessionVisibleFor(session('other'), 'p1')).toBe(false);
  });

  it('无会话 / 无项目 id → 不可见（任一侧缺失都不成立）', () => {
    expect(isSessionVisibleFor(null, 'p1')).toBe(false);
    expect(isSessionVisibleFor(session('p1'), null)).toBe(false);
    expect(isSessionVisibleFor(null, null)).toBe(false);
  });

  it('已终止的会话仍按项目判定（可见性只回答「属于谁」，状态由消费方各自负责）', () => {
    expect(isSessionVisibleFor({ ...session('p1'), status: 'terminated' }, 'p1')).toBe(true);
  });
});
