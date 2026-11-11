import { describe, expect, it } from 'vitest';

import type { TeamState } from '@/shared/types/team';

import { formatCreatedAt, projectRootTail, teamStateBadge } from '../teamList';

/**
 * 团队列表的纯派生：状态徽标 / 项目根末段 / 创建时间。
 *
 * 徽标的判据是「三态互不相同」而不是「文案好看」：`closing` 是一个可查询、可重试的真实
 * 状态（成员关不掉时后端整次调用以 `Err` 结束，团队停在这里）。把它并进 `active` 会让
 * 用户以为成员进程正常跑着 —— 那是关闭流程里最贵的一次误解。
 */

const STATES: TeamState[] = ['active', 'closing', 'closed'];

describe('teamStateBadge', () => {
  it('三态的文案 / 语义色 / 可访问文本两两不同', () => {
    const badges = STATES.map((state) => teamStateBadge(state));

    expect(new Set(badges.map((b) => b.text)).size).toBe(3);
    expect(new Set(badges.map((b) => b.tone)).size).toBe(3);
    expect(new Set(badges.map((b) => b.ariaLabel)).size).toBe(3);
  });

  it('closing 明确说「还有成员没关掉」（不是修辞上的「正在关闭」）', () => {
    expect(teamStateBadge('closing').ariaLabel).toContain('还有成员没关掉');
    expect(teamStateBadge('active').ariaLabel).not.toContain('没关掉');
  });

  it('closed 说明是只读快照（不承诺任何还能执行的动作）', () => {
    expect(teamStateBadge('closed').ariaLabel).toContain('只读');
  });
});

describe('projectRootTail', () => {
  it('取末段（窄面板只摆这一段，完整路径进 title）', () => {
    expect(projectRootTail('/repo/worktrees/feat-a')).toBe('feat-a');
  });

  it('容忍尾分隔符与反斜杠（末段为空的行比多两行切分更糟）', () => {
    expect(projectRootTail('/repo/worktrees/feat-a/')).toBe('feat-a');
    expect(projectRootTail('C:\\repo\\feat-a')).toBe('feat-a');
    expect(projectRootTail('C:\\repo\\feat-a\\')).toBe('feat-a');
  });

  it('只有根时原样返回（没有「末段」可切）', () => {
    expect(projectRootTail('/')).toBe('/');
  });
});

describe('formatCreatedAt', () => {
  it('非法时间退化成占位符（不让 Invalid Date 漏到界面上）', () => {
    expect(formatCreatedAt(Number.NaN)).toBe('—');
  });

  it('格式是 YYYY-MM-DD HH:mm（本地时区）', () => {
    expect(formatCreatedAt(new Date(2024, 0, 2, 3, 4).getTime())).toBe('2024-01-02 03:04');
  });
});
