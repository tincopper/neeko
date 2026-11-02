import { describe, expect, it } from 'vitest';

import { createMemberStatus, createTeamSnapshot, createTeamSummary } from '@/testing/factories';

import { memberCountOf } from '../memberCount';

/**
 * 成员数的**唯一**产出点（一个数字只能有一个答案）。
 *
 * 修之前：面板头数 `snapshot.members.length`（**含队长**），列表行用后端
 * `TeamSummary.memberCount`（**不含队长**、含已退出的成员）。于是同一个队在列表上是「3」、
 * 点进去是「4」—— 两个都自洽，用户不知道该信哪个。
 *
 * 裁决：**后端口径**（不含队长，含 `Dead`），三个面（清单 / 快照 / `team_status`）
 * 都读后端算好的字段，前端不自己数。
 */
describe('memberCountOf — 后端口径（不含队长、含已退出）', () => {
  it('列表行直接用后端的数字（不自己数）', () => {
    expect(memberCountOf(createTeamSummary({ teamId: 'tm_1', memberCount: 3 }))).toBe(3);
    // 0 与「缺失」不是同一件事：0 就是 0
    expect(memberCountOf(createTeamSummary({ teamId: 'tm_2', memberCount: 0 }))).toBe(0);
  });

  it('快照读同一列（不再从花名册派生）', () => {
    const snapshot = createTeamSnapshot({ memberCount: 2 });
    expect(memberCountOf(snapshot)).toBe(2);
  });

  it('花名册的「N 人」与成员数不是同一个量：队长只出现在前者', () => {
    // 这条用例钉住的是**两个数各自回答什么问题**，而不是它们相等。
    const snapshot = createTeamSnapshot({
      memberCount: 2,
      members: [
        createMemberStatus({ memberId: 'lead@tm_1', role: 'lead' }),
        createMemberStatus({ memberId: 'w1@tm_1' }),
        createMemberStatus({ memberId: 'w2@tm_1' }),
      ],
    });
    expect(memberCountOf(snapshot)).toBe(2);
    expect(snapshot.members.length).toBe(3);
  });

  it('已退出的成员照样占名额（与 `team_options` 的上限判据同源）', () => {
    const snapshot = createTeamSnapshot({
      memberCount: 1,
      members: [
        createMemberStatus({ memberId: 'lead@tm_1', role: 'lead' }),
        createMemberStatus({ memberId: 'w1@tm_1', state: 'dead' }),
      ],
    });
    expect(memberCountOf(snapshot)).toBe(1);
  });
});
