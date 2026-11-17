import { describe, expect, it } from 'vitest';

import { describeTeamClose, describeTeamDelete } from '../teamPrompts';

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
    expect(prompt.lines.join('\n')).toContain('not implemented');
  });

  it('说清在飞任务回到 pending', () => {
    expect(prompt.lines.join('\n')).toContain('`pending`');
  });

  it('说清队长自己的终端不由这次关闭关掉', () => {
    expect(prompt.lines.join('\n')).toContain("The lead's own terminal");
  });

  it('说清 worktree 一个都不删', () => {
    expect(prompt.lines.join('\n')).toContain('No worktrees are deleted');
  });

  it('确认按钮是动词短语（不是「确定」这种没有对象的词）', () => {
    expect(prompt.confirmLabel).toBe('Close team');
  });
});

/**
 * 删除的确认文案（`team_delete`）。
 *
 * 与关闭分开测：两段文案说的事不一样（关闭说「可重试、进程还在」，删除说「不可撤销、
 * 级联删掉」）。合并测试会让「删除文案被写成关闭的」这种错误变绿。
 */
describe('describeTeamDelete', () => {
  const prompt = describeTeamDelete('refactor');

  it('标题带团队名，且与关闭的标题**不同**（否则用户分不清按的是哪一个）', () => {
    expect(prompt.title).toContain('refactor');
    expect(prompt.title).toContain('Delete');
    expect(prompt.title).not.toBe(describeTeamClose('refactor').title);
  });

  it('说清不可撤销（没有恢复路径）', () => {
    expect(prompt.lines.join('\n')).toContain('recoverable');
  });

  it('说清成员 / 任务 / 审计一起删（级联）', () => {
    const text = prompt.lines.join('\n');
    expect(text).toContain('cascade');
    expect(text).toContain('audit');
  });

  it('说清 worktree 仍然保留（与 close_notes 第 3 条同口径）', () => {
    expect(prompt.lines.join('\n')).toContain('No worktrees are deleted');
  });

  it('确认按钮是动词短语，且与关闭的按钮**不同**', () => {
    expect(prompt.confirmLabel).toBe('Delete team');
    expect(prompt.confirmLabel).not.toBe(describeTeamClose('refactor').confirmLabel);
  });
});
