import { describe, expect, it } from 'vitest';

import { memberChips } from '../memberChips';

/**
 * 花名册那排 chip 的判据。
 *
 * 最要紧的一条是**档位**：C 档（sentinel only）意味着「完成能报，但卡住永远不可知」。
 * 缩成 `C` 之后它在花名册上与 A 档没有区别 —— 用户会把「没消息」当成「在干活」（红线 14）。
 */
const base = {
  agentId: 'pi',
  channel: 'pty' as const,
  workspace: 'shared' as const,
  tier: 'a' as const,
};

function chip(member: typeof base, key: string) {
  return memberChips(member).find((row) => row.key === key);
}

describe('memberChips — 谁 / 在哪 / 能力边界', () => {
  it('四枚 chip 的顺序固定：身份 → 通道 → 工作区 → 档位', () => {
    expect(memberChips(base).map((row) => row.key)).toEqual([
      'agent',
      'channel',
      'workspace',
      'tier',
    ]);
  });

  it('agentId 原样出现在 chip 上（不翻译、不缩写）', () => {
    expect(chip({ ...base, agentId: 'claude-code' }, 'agent')?.text).toBe('claude-code');
  });

  it('pty 通道写「CLI · PTY」，原始值进 title（不丢字段）', () => {
    const pty = chip(base, 'channel');
    expect(pty?.text).toBe('CLI · PTY');
    expect(pty?.title).toContain('pty');
  });

  it('mcp / none 各有自己的文案（三态不许合并）', () => {
    expect(chip({ ...base, channel: 'mcp' }, 'channel')?.text).toBe('MCP');
    expect(chip({ ...base, channel: 'none' }, 'channel')?.text).toBe('无通道');
  });

  it('A / B 档不带 sentinel 字样，C 档**必须**带「sentinel only」且是警告色', () => {
    const a = chip(base, 'tier');
    const b = chip({ ...base, tier: 'b' }, 'tier');
    const c = chip({ ...base, tier: 'c' }, 'tier');

    expect(a?.text).toBe('A 档');
    expect(b?.text).toBe('B 档');
    expect(a?.text).not.toContain('sentinel');
    expect(b?.text).not.toContain('sentinel');

    // 红线 14 的 UI 侧：警告文字必须是**可见文案**的一部分，不能只进 title
    expect(c?.text).toContain('sentinel only');
    expect(c?.tone).toBe('warn');
    expect(c?.title).toContain('卡住永远不可知');
  });

  it('worktree 工作区只显示路径末段（窄面板塞不下绝对路径）', () => {
    const worktree = chip(
      { ...base, workspace: { worktree: { path: '/repo/worktrees/feat-auth-ui' } } },
      'workspace',
    );
    expect(worktree?.text).toBe('worktree feat-auth-ui');
  });

  it('只读工作区说「只读」，不说「shared」', () => {
    expect(chip({ ...base, workspace: 'read_only' }, 'workspace')?.text).toBe('只读');
    expect(chip(base, 'workspace')?.text).toBe('共享工作区');
  });
});
