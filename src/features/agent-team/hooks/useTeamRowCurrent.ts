import { useMemo } from 'react';

import { useActiveSessionRefs } from '@/shared/hooks/useActiveSessionRefs';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { TeamSummary } from '@/shared/types/team';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { currentTeamIdOf } from '../utils/teamRowSelection';

import { useTeamsOfProject } from './useTeamsOfProject';

/**
 * 侧栏**第二级当前的团队行**（判据在 `utils/teamRowSelection.ts`，本文件只是 React 绑定）。
 *
 * 两个消费面，同一份判据：
 *
 * - [`useCurrentTeamId`] —— 团队行拿 id（「这一行是不是当前」）；
 * - [`useTeamRowSelected`] —— 单元行拿布尔（「团队行是当前 ⇒ 我让出高亮」）。
 *
 * 为什么拆成两个 hook 而不是让宿主自己组合：半个判据在宿主里各写一遍正是历史缺陷的形态
 * （团队行按「前台 ∪ 点过」，单元行只按「点过」⇒ 双亮）。宿主只做一件事：
 * `isActive={unitIsActive && !teamRowSelected}`。
 *
 * `useTeamRowSelected` 需要本项目的团队清单：它同时是「点过的那一行还在不在」的唯一依据 ——
 * 队被删掉之后没人会去清 `activeTeam`，只有清单能回答「那一行已经不存在了」。
 */
export function useCurrentTeamId(teams: readonly TeamSummary[]): string | null {
  const refs = useActiveSessionRefs();
  const sessions = useLiveSessionsStore((s) => s.sessions);
  const activeTeam = useWorkspaceStore((s) => s.activeTeam);
  return useMemo(
    () => currentTeamIdOf({ teams, refs, sessions, activeTeam }),
    [teams, refs, sessions, activeTeam],
  );
}

/** 稳定的空清单：没有团队的项目不因 `?? []` 每帧换引用而让 memo 失效。 */
const NO_TEAMS: readonly TeamSummary[] = [];

/**
 * 本项目的第二级「当前行」是不是团队（单元行据此让出选中底）。
 *
 * 入参是 `ProjectId` 而不是团队清单：单元行的宿主手里只有项目 —— 分组口径仍只有
 * `useTeamsOfProject` 一处（与团队块的读面同源）。
 */
export function useTeamRowSelected(projectId: ProjectId): boolean {
  const teams = useTeamsOfProject().get(projectId) ?? NO_TEAMS;
  return useCurrentTeamId(teams) !== null;
}
