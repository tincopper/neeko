import { describe, expect, it } from 'vitest';

import type { TeamState } from '@/shared/types/team';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';
import { createTeamSummary } from '@/testing/factories';

import {
  formatCreatedAt,
  projectRootTail,
  teamStateBadge,
  teamsOfProject,
  teamUnitKeys,
} from '../teamList';

/**
 * 团队列表的纯派生：状态徽标 / 项目根末段 / 创建时间。
 *
 * 徽标的判据是「三态互不相同」而不是「文案好看」：`closing` 是一个可查询、可重试的真实
 * 状态（成员关不掉时后端整次调用以 `Err` 结束，团队停在这里）。把它并进 `active` 会让
 * 用户以为成员进程正常跑着 —— 那是关闭流程里最贵的一次误解。
 */

const STATES: TeamState[] = ['open', 'closing', 'sealed'];

describe('teamStateBadge', () => {
  it('三态的文案 / 语义色 / 可访问文本两两不同', () => {
    const badges = STATES.map((state) => teamStateBadge(state));

    expect(new Set(badges.map((b) => b.text)).size).toBe(3);
    expect(new Set(badges.map((b) => b.tone)).size).toBe(3);
    expect(new Set(badges.map((b) => b.ariaLabel)).size).toBe(3);
  });

  it('closing 明确说「还有成员没关掉」（不是修辞上的「正在关闭」）', () => {
    expect(teamStateBadge('closing').ariaLabel).toContain('some members did not shut down');
    expect(teamStateBadge('open').ariaLabel).not.toContain('did not shut down');
  });

  it('sealed 说明是只读快照（不承诺任何还能执行的动作）', () => {
    expect(teamStateBadge('sealed').ariaLabel).toContain('read-only');
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

/**
 * 分组口径换了**层级**（单元 → 项目）：团队是容器不是地点。
 *
 * 这些用例替代了原先按 `workspaceKey` 分组的断言 —— 那个语义正是本任务要被替代的东西
 * （成员可以跑在另一棵树里，挂在某棵单元下必然漏人）。
 */
describe('teamsOfProject', () => {
  it('按 projectId 分组（同一项目多队共存，顺序即后端顺序）', () => {
    const byProject = teamsOfProject([
      createTeamSummary({ teamId: 'tm_1', projectId: 'p1' }),
      createTeamSummary({ teamId: 'tm_2', projectId: 'p2' }),
      createTeamSummary({ teamId: 'tm_3', projectId: 'p1' }),
    ]);

    expect([...byProject.keys()]).toEqual(['p1', 'p2']);
    expect(byProject.get('p1')?.map((t) => t.teamId)).toEqual(['tm_1', 'tm_3']);
    expect(byProject.get('p2')?.map((t) => t.teamId)).toEqual(['tm_2']);
  });

  it('同一个项目、不同工作树的队仍在同一条下（容器跨单元）', () => {
    const byProject = teamsOfProject([
      createTeamSummary({ teamId: 'tm_main', projectId: 'p1', workspaceWorktree: null }),
      createTeamSummary({
        teamId: 'tm_wt',
        projectId: 'p1',
        workspaceWorktree: '/repo/wt',
      }),
    ]);

    expect(byProject.get('p1')?.map((t) => t.teamId)).toEqual(['tm_main', 'tm_wt']);
  });

  it('空 projectId（v16 之前的旧行）丢弃：挂到哪个项目下都是猜', () => {
    const byProject = teamsOfProject([createTeamSummary({ teamId: 'tm_old', projectId: '' })]);
    expect(byProject.size).toBe(0);
  });

  it('没有团队 ⇒ 空表（宿主据此不挂载团队块）', () => {
    expect(teamsOfProject([]).size).toBe(0);
  });
});

/**
 * 被团队占用的单元的判据：**两个后端字段相等**（经单元 key 的唯一 mint 比较）。
 * 消费点是「哪些工作树不再作为地点行列出」（`useTeamFreeWorktrees`）。
 *
 * 反向用例（「不做路径前缀比较」）在这里落成一条：`/repo/wt` 与 `/repo/wt/nested` 是两棵
 * 不同的树，前缀匹配会把不相干的工作树从侧栏里隐去，而那种错没有任何报错。
 */
describe('teamUnitKeys', () => {
  it('团队记的 (projectId, workspaceWorktree) 命中对应单元', () => {
    const keys = teamUnitKeys([
      createTeamSummary({ teamId: 'tm_main', projectId: 'p1', workspaceWorktree: null }),
      createTeamSummary({ teamId: 'tm_wt', projectId: 'p1', workspaceWorktree: '/repo/wt' }),
    ]);

    expect(keys.has(WorkspaceSession.of('p1', null).key)).toBe(true);
    expect(keys.has(WorkspaceSession.of('p1', '/repo/wt').key)).toBe(true);
    expect(keys.size).toBe(2);
  });

  it('同路径不同项目不算（项目 id 也是判据的一半）', () => {
    const keys = teamUnitKeys([
      createTeamSummary({ teamId: 'tm_1', projectId: 'p1', workspaceWorktree: '/repo/wt' }),
    ]);

    expect(keys.has(WorkspaceSession.of('p2', '/repo/wt').key)).toBe(false);
  });

  it('不做路径前缀比较：嵌套树是另一个单元', () => {
    const keys = teamUnitKeys([
      createTeamSummary({ teamId: 'tm_1', projectId: 'p1', workspaceWorktree: '/repo/wt' }),
    ]);

    expect(keys.has(WorkspaceSession.of('p1', '/repo/wt/nested').key)).toBe(false);
  });

  it('空 projectId 的旧行不占用任何单元', () => {
    expect(
      teamUnitKeys([
        createTeamSummary({ teamId: 'tm_old', projectId: '', workspaceWorktree: null }),
      ]).size,
    ).toBe(0);
  });
});
