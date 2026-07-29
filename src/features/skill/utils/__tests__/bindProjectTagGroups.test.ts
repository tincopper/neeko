import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createManagedSkill } from '../../../../testing/factories';
import {
  bindProjectTagGroups,
  type BindProjectTagGroupsDeps,
  type BindProjectTagGroupsInput,
} from '../bindProjectTagGroups';

function baseInput(overrides?: Partial<BindProjectTagGroupsInput>): BindProjectTagGroupsInput {
  return {
    projectId: 'proj-1',
    projectPath: '/tmp/proj',
    tagGroupIds: ['tg-1'],
    previousBoundIds: [],
    targetAgentIds: ['claude-code'],
    ...overrides,
  };
}

describe('bindProjectTagGroups', () => {
  let deps: BindProjectTagGroupsDeps;

  beforeEach(() => {
    deps = {
      setProjectTagGroups: vi.fn().mockResolvedValue(undefined),
      getSkillsForTagGroup: vi.fn().mockResolvedValue([]),
      importSkillsToProject: vi.fn().mockResolvedValue(0),
    };
  });

  it('persists the full tag group set with project path', async () => {
    await bindProjectTagGroups(
      baseInput({ tagGroupIds: ['tg-1', 'tg-2'], previousBoundIds: ['tg-1'] }),
      deps,
    );

    expect(deps.setProjectTagGroups).toHaveBeenCalledWith('proj-1', ['tg-1', 'tg-2'], '/tmp/proj');
  });

  it('imports skills only for newly added groups', async () => {
    vi.mocked(deps.getSkillsForTagGroup).mockImplementation(async (id: string) => {
      if (id === 'tg-2') return [createManagedSkill({ id: 's-new', name: 'new-skill' })];
      if (id === 'tg-1') return [createManagedSkill({ id: 's-old', name: 'old-skill' })];
      return [];
    });
    vi.mocked(deps.importSkillsToProject).mockResolvedValue(1);

    const result = await bindProjectTagGroups(
      baseInput({
        tagGroupIds: ['tg-1', 'tg-2'],
        previousBoundIds: ['tg-1'],
        targetAgentIds: ['claude-code'],
      }),
      deps,
    );

    expect(deps.getSkillsForTagGroup).toHaveBeenCalledTimes(1);
    expect(deps.getSkillsForTagGroup).toHaveBeenCalledWith('tg-2');
    expect(deps.importSkillsToProject).toHaveBeenCalledWith(
      '/tmp/proj',
      ['s-new'],
      ['claude-code'],
    );
    expect(result.imported).toBe(1);
    expect(result.addedGroupIds).toEqual(['tg-2']);
    expect(result.syncSkippedReason).toBeNull();
    expect(result.summary).toMatch(/Bound 2 groups/i);
    expect(result.summary).toMatch(/synced 1/i);
  });

  it('dedupes skill ids across newly added groups', async () => {
    vi.mocked(deps.getSkillsForTagGroup).mockResolvedValue([
      createManagedSkill({ id: 'shared', name: 'shared' }),
      createManagedSkill({ id: 'a', name: 'a' }),
    ]);
    // second group call also returns shared
    vi.mocked(deps.getSkillsForTagGroup)
      .mockResolvedValueOnce([
        createManagedSkill({ id: 'shared', name: 'shared' }),
        createManagedSkill({ id: 'a', name: 'a' }),
      ])
      .mockResolvedValueOnce([
        createManagedSkill({ id: 'shared', name: 'shared' }),
        createManagedSkill({ id: 'b', name: 'b' }),
      ]);
    vi.mocked(deps.importSkillsToProject).mockResolvedValue(3);

    await bindProjectTagGroups(
      baseInput({ tagGroupIds: ['tg-a', 'tg-b'], previousBoundIds: [], targetAgentIds: ['cc'] }),
      deps,
    );

    const skillIds = vi.mocked(deps.importSkillsToProject).mock.calls[0][1];
    expect(skillIds.sort()).toEqual(['a', 'b', 'shared']);
  });

  it('skips disk import when there is no target agent but still binds', async () => {
    vi.mocked(deps.getSkillsForTagGroup).mockResolvedValue([
      createManagedSkill({ id: 's1', name: 'skill' }),
    ]);

    const result = await bindProjectTagGroups(
      baseInput({ tagGroupIds: ['tg-1'], previousBoundIds: [], targetAgentIds: [] }),
      deps,
    );

    expect(deps.setProjectTagGroups).toHaveBeenCalled();
    expect(deps.importSkillsToProject).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
    expect(result.syncSkippedReason).toMatch(/no target agent/i);
    expect(result.summary).toMatch(/Bound 1 group/i);
  });

  it('does not import when newly added groups have no skills', async () => {
    vi.mocked(deps.getSkillsForTagGroup).mockResolvedValue([]);

    const result = await bindProjectTagGroups(
      baseInput({ tagGroupIds: ['tg-1'], previousBoundIds: [], targetAgentIds: ['claude-code'] }),
      deps,
    );

    expect(deps.importSkillsToProject).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
    expect(result.syncSkippedReason).toBeNull();
  });

  it('does not fetch skills when the set is unchanged', async () => {
    const result = await bindProjectTagGroups(
      baseInput({
        tagGroupIds: ['tg-1'],
        previousBoundIds: ['tg-1'],
        targetAgentIds: ['claude-code'],
      }),
      deps,
    );

    expect(deps.getSkillsForTagGroup).not.toHaveBeenCalled();
    expect(deps.importSkillsToProject).not.toHaveBeenCalled();
    expect(result.addedGroupIds).toEqual([]);
    expect(result.imported).toBe(0);
  });

  it('propagates setProjectTagGroups failures', async () => {
    vi.mocked(deps.setProjectTagGroups).mockRejectedValue(new Error('db down'));

    await expect(bindProjectTagGroups(baseInput(), deps)).rejects.toThrow('db down');
    expect(deps.importSkillsToProject).not.toHaveBeenCalled();
  });

  it('rolls back binding declaration when skill sync fails', async () => {
    vi.mocked(deps.getSkillsForTagGroup).mockResolvedValue([
      createManagedSkill({ id: 's1', name: 'skill' }),
    ]);
    vi.mocked(deps.importSkillsToProject).mockRejectedValue(new Error('sync failed'));

    await expect(
      bindProjectTagGroups(
        baseInput({ tagGroupIds: ['tg-1', 'tg-2'], previousBoundIds: ['tg-1'] }),
        deps,
      ),
    ).rejects.toThrow('sync failed');

    // First call persists the desired set; second call rolls back to previous ids.
    expect(deps.setProjectTagGroups).toHaveBeenCalledTimes(2);
    expect(deps.setProjectTagGroups).toHaveBeenLastCalledWith('proj-1', ['tg-1'], '/tmp/proj');
  });
});
