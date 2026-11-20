import { describe, expect, it } from 'vitest';

import type { SessionRef, SessionView } from '@/shared/types/liveSessions';
import type { TeamSummary } from '@/shared/types/team';

import { currentTeamIdOf } from '../teamRowSelection';

/**
 * 第二级的「当前行」判据（`currentTeamIdOf`）—— **唯一**实现。
 *
 * 这里钉住它的两条输入事实与三条失效判据。为什么失效判据也在这里：它们是「让出高亮」的
 * 前提 —— 判据一旦多认一行出来，单元行就会在没有团队行亮着的情况下把填充让掉，
 * 用户看到的是「当前」在侧栏里消失（第六轮与本次 review 各踩过一次的同族形态）。
 */

function team(teamId: string, overrides: Partial<TeamSummary> = {}): TeamSummary {
  return {
    teamId,
    projectId: 'p1',
    name: teamId,
    state: 'open',
    projectPath: '/repo',
    workspaceWorktree: null,
    leadAgentId: 'claude-code',
    leadMemberId: 'lead@' + teamId,
    createdAt: 1_700_000_000_000,
    sealedAt: null,
    memberCount: 1,
    taskTotal: 1,
    taskOpen: 1,
    taskDone: 0,
    ...overrides,
  } as TeamSummary;
}

function memberSession(teamId: string, overrides: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 'pty-1',
    kind: 'terminal',
    attribution: { kind: 'teamMember', teamId, memberId: 'lead@' + teamId },
    agentId: 'claude-code',
    workspaceKey: 'p1\u0000',
    title: 'task',
    titleSource: 'native',
    state: 'running',
    startedAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    turnCount: 1,
    hasUserInput: true,
    ...overrides,
  };
}

const REF: SessionRef = { workspaceKey: 'p1\u0000', kind: 'terminal', sessionId: 'pty-1' };

describe('currentTeamIdOf', () => {
  it('前台是某个成员的会话 ⇒ 那个队（与「我点过谁」无关）', () => {
    expect(
      currentTeamIdOf({
        teams: [team('tm_1'), team('tm_2')],
        refs: [REF],
        sessions: [memberSession('tm_2')],
        activeTeam: { projectId: 'p1', teamId: 'tm_1' },
      }),
    ).toBe('tm_2');
  });

  it('没有前台团队会话 ⇒ 认用户点过的那一行（队长不在跑也能亮）', () => {
    expect(
      currentTeamIdOf({
        teams: [team('tm_1')],
        refs: [],
        sessions: [],
        activeTeam: { projectId: 'p1', teamId: 'tm_1' },
      }),
    ).toBe('tm_1');
  });

  it('点过的那一行属于**别的项目** ⇒ 不生效（跨项目不串高亮）', () => {
    expect(
      currentTeamIdOf({
        teams: [team('tm_1')],
        refs: [],
        sessions: [],
        activeTeam: { projectId: 'p2', teamId: 'tm_1' },
      }),
    ).toBeNull();
  });

  it('点过的那一行**已经不在清单里**（被删）⇒ 不生效，别让单元行白让出高亮', () => {
    expect(
      currentTeamIdOf({
        teams: [team('tm_1')],
        refs: [],
        sessions: [],
        activeTeam: { projectId: 'p1', teamId: 'tm_gone' },
      }),
    ).toBeNull();
  });

  it('前台属于一个**不在清单里的**队 ⇒ null，且不回落成点过的那一行', () => {
    // 清单还没拉到 / 队已删：前台会话说了算，但它此刻没有行可亮 ——
    // 让出高亮而不亮任何行，就是「当前」凭空消失。
    expect(
      currentTeamIdOf({
        teams: [team('tm_1')],
        refs: [REF],
        sessions: [memberSession('tm_gone')],
        activeTeam: { projectId: 'p1', teamId: 'tm_1' },
      }),
    ).toBeNull();
  });

  it('两条事实都没有 ⇒ null（单元行成为当前）', () => {
    expect(
      currentTeamIdOf({ teams: [team('tm_1')], refs: [], sessions: [], activeTeam: null }),
    ).toBeNull();
  });
});
