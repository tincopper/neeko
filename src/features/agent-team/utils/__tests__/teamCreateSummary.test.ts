import { describe, expect, it } from 'vitest';

import { teamCreateSummary, type TeamCreateSummaryInput } from '../teamCreateSummary';

/**
 * 建队 footer 的摘要（纯函数）。
 *
 * 钉住三件事：
 *
 * 1. **名字只在填了时出现** —— 留空时后端取工作区目录名，摘要不去重算那份目录名；
 * 2. **成员段只出现一次**（逐段 push 曾让第二个成员之后的名字重复）；
 * 3. **有角色时显示 `CLI→角色`**（摘要回答「谁带什么人设」），无角色就只写显示名。
 */
function values(overrides: Partial<TeamCreateSummaryInput> = {}): TeamCreateSummaryInput {
  return {
    selectedIds: ['claude-code'],
    workspace: 'shared',
    approvalPolicy: 'queue',
    persona: '',
    roleByAgent: {},
    ...overrides,
  };
}

const NAME_OF = (agentId: string): string =>
  ({ 'claude-code': 'Claude Code', qoder: 'Qoder' })[agentId] ?? agentId;

describe('teamCreateSummary', () => {
  it('填了名字 ⇒ 名字在最前（主语先出现）', () => {
    expect(teamCreateSummary(values(), '求和小队', NAME_OF)).toBe(
      '「求和小队」 · 1 名成员（Claude Code） · 共享工作区 · 队列审批',
    );
  });

  it('没填名字 ⇒ 整段不出现（默认的目录名由后端决定，摘要不替它猜）', () => {
    expect(teamCreateSummary(values(), null, NAME_OF)).not.toContain('「');
  });

  it('多个成员：名字只出现一次，带角色的显示 `→角色`', () => {
    const summary = teamCreateSummary(
      values({
        selectedIds: ['claude-code', 'qoder'],
        roleByAgent: { qoder: '评审' },
      }),
      null,
      NAME_OF,
    );

    expect(summary).toBe('2 名成员（Claude Code / Qoder→评审） · 共享工作区 · 队列审批');
    // 逐个 push 的历史缺陷：Qoder 会在后面再出现一次
    expect(summary.match(/Qoder/g)).toHaveLength(1);
  });

  it('三个缺省值各自有自己的词（只读 / 交互审批 / 旁路审批）', () => {
    expect(teamCreateSummary(values({ workspace: 'read_only' }), null, NAME_OF)).toContain('只读');
    expect(teamCreateSummary(values({ approvalPolicy: 'interactive' }), null, NAME_OF)).toContain(
      '交互审批',
    );
    expect(teamCreateSummary(values({ approvalPolicy: 'bypass' }), null, NAME_OF)).toContain(
      '旁路审批',
    );
  });

  it('空勾选 ⇒ 成员段不出现（空池在后端是「不限制」，不是「0 名成员」）', () => {
    const summary = teamCreateSummary(values({ selectedIds: [] }), null, NAME_OF);

    expect(summary).toBe('共享工作区 · 队列审批');
  });
});
