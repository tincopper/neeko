import { describe, expect, it } from 'vitest';

import { memberChips, memberRowMeta, personaChipTitle } from '../memberChips';

/**
 * 花名册那排 chip 的判据。
 *
 * 最要紧的一条是**档位**：C 档（sentinel only）意味着「完成能报，但卡住永远不可知」。
 * 缩成 `C` 之后它在花名册上与 A 档没有区别 —— 用户会把「没消息」当成「在干活」（红线 14）。
 */
const base = {
  agentId: 'pi',
  persona: null,
  channel: 'pty' as const,
  workspace: 'shared' as const,
  tier: 'a' as const,
};

function chip(member: typeof base, key: string) {
  return memberChips(member).find((row) => row.key === key);
}

/** 行内 persona chip 的 `title` 与抽屉那枚**同一句话**（同一个表示点，不写两份）。 */
function personaTitle(persona: string): string {
  return memberChips({ ...base, persona }).find((row) => row.key === 'persona')?.title ?? '';
}

describe('memberChips — 谁 / 在哪 / 能力边界', () => {
  it('无 persona 时四枚 chip 的顺序固定：身份 → 通道 → 工作区 → 档位', () => {
    expect(memberChips(base).map((row) => row.key)).toEqual([
      'agent',
      'channel',
      'workspace',
      'tier',
    ]);
  });

  it('有 persona 时多一枚角色 chip，落在身份之后（v19）；`null` = 不渲染', () => {
    const withPersona = { ...base, persona: '研究员' };
    expect(memberChips(withPersona).map((row) => row.key)).toEqual([
      'agent',
      'persona',
      'channel',
      'workspace',
      'tier',
    ]);
    const row = memberChips(withPersona).find((item) => item.key === 'persona');
    expect(row?.text).toBe('研究员');
    expect(row?.title).toContain('unrelated to permissions');
    // 行内那枚 chip 的 title 必须是同一句话（`personaChipTitle` 是唯一来源）
    expect(personaChipTitle('研究员')).toBe(personaTitle('研究员'));
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
    expect(chip({ ...base, channel: 'none' }, 'channel')?.text).toBe('No channel');
  });

  it('A / B 档不带 sentinel 字样，C 档**必须**带「sentinel only」且是警告色', () => {
    const a = chip(base, 'tier');
    const b = chip({ ...base, tier: 'b' }, 'tier');
    const c = chip({ ...base, tier: 'c' }, 'tier');

    expect(a?.text).toBe('Tier A');
    expect(b?.text).toBe('Tier B');
    expect(a?.text).not.toContain('sentinel');
    expect(b?.text).not.toContain('sentinel');

    // 红线 14 的 UI 侧：警告文字必须是**可见文案**的一部分，不能只进 title
    expect(c?.text).toContain('sentinel only');
    expect(c?.tone).toBe('warn');
    expect(c?.title).toContain('a stall is never visible');
  });

  it('worktree 工作区只显示路径末段（窄面板塞不下绝对路径）', () => {
    const worktree = chip(
      { ...base, workspace: { worktree: { path: '/repo/worktrees/feat-auth-ui' } } },
      'workspace',
    );
    expect(worktree?.text).toBe('worktree feat-auth-ui');
  });

  it('只读工作区说「只读」，不说「shared」', () => {
    expect(chip({ ...base, workspace: 'read_only' }, 'workspace')?.text).toBe('Read-only');
    expect(chip(base, 'workspace')?.text).toBe('Shared workspace');
  });
});

/**
 * 行内只留 `memberRowMeta`（B 档 R8）：身份 / 能力细节进抽屉，行内回答「在哪干活 + 要不要紧」。
 *
 * 两条判据与红线挂钩：
 *
 * - `shared` 是**缺省值**，每行都写「共享工作区」等于没有信息（R7/R8 同一条规则）；
 * - C 档的警示不许因为从 chip 缩成徽标而消失（红线 14：必须有可见文字承载）。
 */
describe('memberRowMeta — 行内的最小元信息', () => {
  it('C 档 ⇒ sentinelOnly（行内徽标 + 分区说明两处承载红线 14）；A / B 档 ⇒ false', () => {
    expect(memberRowMeta({ ...base, tier: 'c' }).sentinelOnly).toBe(true);
    expect(memberRowMeta({ ...base, tier: 'a' }).sentinelOnly).toBe(false);
    expect(memberRowMeta({ ...base, tier: 'b' }).sentinelOnly).toBe(false);
  });

  it('shared 是缺省值 ⇒ workspace 为 null（不渲染，不是渲染一个「共享工作区」）', () => {
    expect(memberRowMeta({ ...base, workspace: 'shared' }).workspace).toBeNull();
  });

  it('只读工作区 ⇒ 「只读」（它是一条真的事实，不能被当成缺省值吃掉）', () => {
    expect(memberRowMeta({ ...base, workspace: 'read_only' }).workspace).toBe('Read-only');
  });

  it('worktree ⇒ 只留路径末段（与 workspaceLabel 同源，不另写一份拆分）', () => {
    expect(
      memberRowMeta({ ...base, workspace: { worktree: { path: '/repo/wt/feat-auth-ui' } } })
        .workspace,
    ).toBe('worktree feat-auth-ui');
  });

  it('persona 回到行内（R14）：有值 ⇒ 原样带出；`null` ⇒ null（不占位）', () => {
    expect(memberRowMeta({ ...base, persona: '研究员' }).persona).toBe('研究员');
    expect(memberRowMeta({ ...base, persona: null }).persona).toBeNull();
  });
});
