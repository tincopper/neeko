import { describe, expect, it } from 'vitest';

import { describeTeamClose } from '../teamClose';

/**
 * 关闭团队的确认文案。
 *
 * 判据只有一条：**每一句都能在后端找到出处**。`execution.rs::close_notes` 把三处
 * 「看起来做了其实没做」的陷阱逐条写进了关闭回复（`graceful` 未兑现 / 队长 PTY 不关 /
 * worktree 保留），`finish_member_close` 负责把在飞任务放回 `pending`。确认弹窗在按下
 * 按钮**之前**就要说这些事 —— 等关闭成功后才由 `notes` 揭示，用户已经没有选择权了。
 */
describe('describeTeamClose', () => {
  const prompt = describeTeamClose('refactor');

  it('标题带团队名（面板里可能同时存在多个队）', () => {
    expect(prompt.title).toContain('refactor');
  });

  it('说清 graceful 本期未兑现（直接关进程，不承诺协商关机）', () => {
    expect(prompt.lines.join('\n')).toMatch(/graceful/);
    expect(prompt.lines.join('\n')).toContain('未兑现');
  });

  it('说清在飞任务回到 pending', () => {
    expect(prompt.lines.join('\n')).toContain('`pending`');
  });

  it('说清队长自己的终端不由这次关闭关掉', () => {
    expect(prompt.lines.join('\n')).toContain('队长自己的终端');
  });

  it('说清 worktree 一个都不删', () => {
    expect(prompt.lines.join('\n')).toContain('worktree 一个都不会删');
  });

  it('确认按钮是动词短语（不是「确定」这种没有对象的词）', () => {
    expect(prompt.confirmLabel).toBe('确认关闭');
  });
});
