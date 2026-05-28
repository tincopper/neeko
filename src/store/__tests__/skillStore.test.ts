import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { createManagedSkill, createTagGroup, createDiscoveredSkill } from '../../testing/factories';

const mockInvoke = vi.mocked(invoke);
const mockOpen = vi.mocked(open);

// skillStore 延迟导入，确保每个测试使用独立 state
let useSkillStore: typeof import('../skillStore').useSkillStore;

beforeEach(async () => {
  mockInvoke.mockReset();
  mockOpen.mockReset();
  // 每次测试前重置 store 到初始状态
  const mod = await import('../skillStore');
  useSkillStore = mod.useSkillStore;
  mod.useSkillStore.setState(mod.initialSkillState);
});

// ─── 初始状态 ───────────────────────────────────────────────────────────────

describe('初始状态', () => {
  it('skills 初始为空数组', () => {
    expect(useSkillStore.getState().skills).toEqual([]);
  });

  it('tagGroups 初始为空数组', () => {
    expect(useSkillStore.getState().tagGroups).toEqual([]);
  });

  it('loading 初始为 true', () => {
    expect(useSkillStore.getState().loading).toBe(true);
  });

  it('activeSkillView 初始为 "local"', () => {
    expect(useSkillStore.getState().activeSkillView).toBe('local');
  });

  it('searchQuery 初始为空字符串', () => {
    expect(useSkillStore.getState().searchQuery).toBe('');
  });

  it('selectedSkillId 初始为 null', () => {
    expect(useSkillStore.getState().selectedSkillId).toBeNull();
  });

  it('activeTagGroupId 初始为 null', () => {
    expect(useSkillStore.getState().activeTagGroupId).toBeNull();
  });
});

// ─── refreshSkills ──────────────────────────────────────────────────────────

describe('refreshSkills', () => {
  it('调用 invoke("get_managed_skills") 并更新 skills', async () => {
    const skills = [createManagedSkill({ id: 's1' }), createManagedSkill({ id: 's2' })];
    mockInvoke.mockResolvedValue(skills);

    await useSkillStore.getState().refreshSkills();

    expect(mockInvoke).toHaveBeenCalledWith('get_managed_skills');
    expect(useSkillStore.getState().skills).toEqual(skills);
  });

  it('加载完成后 loading 变为 false', async () => {
    mockInvoke.mockResolvedValue([]);

    await useSkillStore.getState().refreshSkills();

    expect(useSkillStore.getState().loading).toBe(false);
  });

  it('invoke 失败时 skills 保持不变，loading 变为 false', async () => {
    useSkillStore.setState({ skills: [createManagedSkill()] });
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    await useSkillStore.getState().refreshSkills();

    expect(useSkillStore.getState().skills).toEqual([createManagedSkill()]);
    expect(useSkillStore.getState().loading).toBe(false);
  });
});

// ─── deleteSkill ────────────────────────────────────────────────────────────

describe('deleteSkill', () => {
  it('调用 invoke("delete_managed_skill") 并从列表移除', async () => {
    const skill = createManagedSkill({ id: 'to-delete' });
    useSkillStore.setState({ skills: [skill, createManagedSkill({ id: 'keep' })] });
    mockInvoke.mockResolvedValue(undefined);

    await useSkillStore.getState().deleteSkill('to-delete');

    expect(mockInvoke).toHaveBeenCalledWith('delete_managed_skill', { skillId: 'to-delete' });
    expect(useSkillStore.getState().skills.find(s => s.id === 'to-delete')).toBeUndefined();
    expect(useSkillStore.getState().skills).toHaveLength(1);
  });

  it('invoke 失败时列表不变', async () => {
    const skill = createManagedSkill({ id: 's1' });
    useSkillStore.setState({ skills: [skill] });
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    await useSkillStore.getState().deleteSkill('s1');

    expect(useSkillStore.getState().skills).toHaveLength(1);
  });
});

// ─── getSkillDocument ───────────────────────────────────────────────────────

describe('getSkillDocument', () => {
  it('调用 invoke("get_skill_document") 并返回内容字符串', async () => {
    mockInvoke.mockResolvedValue({ content: '# My Skill\nContent here' });

    const content = await useSkillStore.getState().getSkillDocument('skill-1');

    expect(mockInvoke).toHaveBeenCalledWith('get_skill_document', { skillId: 'skill-1' });
    expect(content).toBe('# My Skill\nContent here');
  });

  it('invoke 失败时抛出错误', async () => {
    mockInvoke.mockRejectedValue(new Error('not found'));

    await expect(useSkillStore.getState().getSkillDocument('missing')).rejects.toThrow();
  });
});

// ─── refreshTagGroups ───────────────────────────────────────────────────────

describe('refreshTagGroups', () => {
  it('调用 invoke("get_tag_groups") 并更新 tagGroups', async () => {
    const groups = [createTagGroup({ id: 'g1' }), createTagGroup({ id: 'g2' })];
    mockInvoke.mockResolvedValue(groups);

    await useSkillStore.getState().refreshTagGroups();

    expect(mockInvoke).toHaveBeenCalledWith('get_tag_groups');
    expect(useSkillStore.getState().tagGroups).toEqual(groups);
  });

  it('invoke 失败时 tagGroups 保持不变', async () => {
    const existing = [createTagGroup()];
    useSkillStore.setState({ tagGroups: existing });
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    await useSkillStore.getState().refreshTagGroups();

    expect(useSkillStore.getState().tagGroups).toEqual(existing);
  });
});

// ─── createTagGroup ─────────────────────────────────────────────────────────

describe('createTagGroup', () => {
  it('调用 invoke("create_tag_group") 并追加到列表', async () => {
    const newGroup = createTagGroup({ id: 'new-tg', name: 'New Group' });
    useSkillStore.setState({ tagGroups: [] });
    mockInvoke.mockResolvedValue(newGroup);

    await useSkillStore.getState().createTagGroup('New Group');

    expect(mockInvoke).toHaveBeenCalledWith('create_tag_group', {
      name: 'New Group',
      description: undefined,
      icon: undefined,
    });
    expect(useSkillStore.getState().tagGroups).toHaveLength(1);
    expect(useSkillStore.getState().tagGroups[0]).toEqual(newGroup);
  });

  it('invoke 失败时列表不变', async () => {
    useSkillStore.setState({ tagGroups: [] });
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    await useSkillStore.getState().createTagGroup('Fail Group');

    expect(useSkillStore.getState().tagGroups).toHaveLength(0);
  });
});

// ─── deleteTagGroup ─────────────────────────────────────────────────────────

describe('deleteTagGroup', () => {
  it('调用 invoke("delete_tag_group_cmd") 并从列表移除', async () => {
    const group = createTagGroup({ id: 'tg-del' });
    useSkillStore.setState({ tagGroups: [group, createTagGroup({ id: 'tg-keep' })] });
    mockInvoke.mockResolvedValue(undefined);

    await useSkillStore.getState().deleteTagGroup('tg-del');

    expect(mockInvoke).toHaveBeenCalledWith('delete_tag_group_cmd', { id: 'tg-del' });
    expect(useSkillStore.getState().tagGroups.find(g => g.id === 'tg-del')).toBeUndefined();
    expect(useSkillStore.getState().tagGroups).toHaveLength(1);
  });

  it('invoke 失败时列表不变', async () => {
    const group = createTagGroup({ id: 'tg-1' });
    useSkillStore.setState({ tagGroups: [group] });
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    await useSkillStore.getState().deleteTagGroup('tg-1');

    expect(useSkillStore.getState().tagGroups).toHaveLength(1);
  });
});

// ─── installLocal ───────────────────────────────────────────────────────────

describe('installLocal', () => {
  it('用户选择文件后调用 invoke("install_skill_from_local") 并刷新列表', async () => {
    mockOpen.mockResolvedValue('/path/to/skill.md');
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'install_local_skill') return undefined;
      if (cmd === 'get_managed_skills') return [];
      return undefined;
    });

    await useSkillStore.getState().installLocal();

    expect(mockOpen).toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith('install_local_skill', {
      sourcePath: '/path/to/skill.md',
    });
    expect(mockInvoke).toHaveBeenCalledWith('get_managed_skills');
  });

  it('用户取消选择时不调用 invoke', async () => {
    mockOpen.mockResolvedValue(null);

    await useSkillStore.getState().installLocal();

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// ─── scanSkills ─────────────────────────────────────────────────────────────

describe('scanSkills', () => {
  it('调用 invoke("scan_skills") 并返回发现的技能列表', async () => {
    const discovered = [createDiscoveredSkill({ id: 'd1' }), createDiscoveredSkill({ id: 'd2' })];
    mockInvoke.mockResolvedValue(discovered);

    const result = await useSkillStore.getState().scanSkills();

    expect(mockInvoke).toHaveBeenCalledWith('scan_local_skills');
    expect(result).toEqual(discovered);
  });

  it('invoke 失败时返回空数组', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    const result = await useSkillStore.getState().scanSkills();

    expect(result).toEqual([]);
  });
});

// ─── createSkill ────────────────────────────────────────────────────────────

describe('createSkill', () => {
  it('调用 invoke("create_managed_skill") 后自动刷新列表', async () => {
    const newSkill = createManagedSkill({ id: 'new-s', name: 'My Skill' });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'create_skill') return undefined;
      if (cmd === 'get_managed_skills') return [newSkill];
      return undefined;
    });

    await useSkillStore.getState().createSkill('My Skill', '# content');

    expect(mockInvoke).toHaveBeenCalledWith('create_skill', {
      name: 'My Skill',
      skillContent: '# content',
    });
    expect(mockInvoke).toHaveBeenCalledWith('get_managed_skills');
    expect(useSkillStore.getState().skills).toEqual([newSkill]);
  });

  it('invoke 失败时不影响列表', async () => {
    const existing = createManagedSkill();
    useSkillStore.setState({ skills: [existing] });
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    await useSkillStore.getState().createSkill('Fail', '');

    expect(useSkillStore.getState().skills).toEqual([existing]);
  });
});

// ─── importDiscoveredSkill ──────────────────────────────────────────────────

describe('importDiscoveredSkill', () => {
  it('调用 invoke("import_discovered_skill") 后自动刷新列表', async () => {
    const imported = createManagedSkill({ id: 'imported' });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'import_discovered_skill') return undefined;
      if (cmd === 'get_managed_skills') return [imported];
      return undefined;
    });

    await useSkillStore.getState().importDiscoveredSkill('/path/skill.md', 'My Skill');

    expect(mockInvoke).toHaveBeenCalledWith('import_discovered_skill', {
      discoveredPath: '/path/skill.md',
      name: 'My Skill',
    });
    expect(useSkillStore.getState().skills).toEqual([imported]);
  });

  it('invoke 失败时不影响列表', async () => {
    const existing = createManagedSkill();
    useSkillStore.setState({ skills: [existing] });
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    await useSkillStore.getState().importDiscoveredSkill('/bad/path');

    expect(useSkillStore.getState().skills).toEqual([existing]);
  });
});

// ─── UI 动作 ────────────────────────────────────────────────────────────────

describe('UI 动作', () => {
  it('setActiveSkillView 更新 activeSkillView', () => {
    useSkillStore.getState().setActiveSkillView('marketplace');
    expect(useSkillStore.getState().activeSkillView).toBe('marketplace');
  });

  it('setSearchQuery 更新 searchQuery', () => {
    useSkillStore.getState().setSearchQuery('hello');
    expect(useSkillStore.getState().searchQuery).toBe('hello');
  });

  it('setSelectedSkillId 更新 selectedSkillId', () => {
    useSkillStore.getState().setSelectedSkillId('skill-42');
    expect(useSkillStore.getState().selectedSkillId).toBe('skill-42');
  });

  it('setActiveTagGroupId 更新 activeTagGroupId', () => {
    useSkillStore.getState().setActiveTagGroupId('tg-99');
    expect(useSkillStore.getState().activeTagGroupId).toBe('tg-99');
  });

  it('setActiveTagGroupId 传入 null 可清除选中', () => {
    useSkillStore.setState({ activeTagGroupId: 'tg-1' });
    useSkillStore.getState().setActiveTagGroupId(null);
    expect(useSkillStore.getState().activeTagGroupId).toBeNull();
  });
});

// ─── updateSkillDocument ─────────────────────────────────────────────────────

describe('updateSkillDocument', () => {
  it('调用 write_file_content 并传入 transport={ Local: central_path }', async () => {
    const skill = createManagedSkill({ id: 'sk-1', central_path: '/home/.neeko/skills/my-skill' });
    useSkillStore.setState({ skills: [skill] });

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'write_file_content') return undefined;
      if (cmd === 'get_managed_skills') return [skill];
      return undefined;
    });

    await useSkillStore.getState().updateSkillDocument('sk-1', 'my-skill', '# Content');

    expect(mockInvoke).toHaveBeenCalledWith('write_file_content', {
      transport: { Local: { project_path: '/home/.neeko/skills/my-skill' } },
      filePath: 'SKILL.md',
      content: '# Content',
    });
  });

  it('保存后自动刷新 skills 列表', async () => {
    const skill = createManagedSkill({ id: 'sk-1', central_path: '/skills/my-skill' });
    const updated = createManagedSkill({ id: 'sk-1', name: 'updated' });
    useSkillStore.setState({ skills: [skill] });

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'write_file_content') return undefined;
      if (cmd === 'get_managed_skills') return [updated];
      return undefined;
    });

    await useSkillStore.getState().updateSkillDocument('sk-1', 'my-skill', '# New content');

    expect(useSkillStore.getState().skills).toEqual([updated]);
  });

  it('skill 不存在时不调用 write_file_content', async () => {
    useSkillStore.setState({ skills: [] });

    await useSkillStore.getState().updateSkillDocument('nonexistent', 'name', 'content');

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// ─── fetchSkillsForTagGroup ──────────────────────────────────────────────────

describe('fetchSkillsForTagGroup', () => {
  it('调用 get_skills_for_tag_group_cmd 并返回结果', async () => {
    const skills = [createManagedSkill({ id: 's1' }), createManagedSkill({ id: 's2' })];
    mockInvoke.mockResolvedValue(skills);

    const result = await useSkillStore.getState().fetchSkillsForTagGroup('tg-1');

    expect(mockInvoke).toHaveBeenCalledWith('get_skills_for_tag_group_cmd', {
      tagGroupId: 'tg-1',
    });
    expect(result).toEqual(skills);
  });

  it('invoke 失败时返回空数组', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC error'));

    const result = await useSkillStore.getState().fetchSkillsForTagGroup('tg-bad');

    expect(result).toEqual([]);
  });
});

// ─── selector 隔离 ──────────────────────────────────────────────────────────

describe('selector 隔离', () => {
  it('修改 searchQuery 不改变 skills 引用', () => {
    const skills = [createManagedSkill()];
    useSkillStore.setState({ skills });

    const before = useSkillStore.getState().skills;
    useSkillStore.getState().setSearchQuery('new query');
    const after = useSkillStore.getState().skills;

    expect(after).toBe(before);
  });

  it('修改 activeSkillView 不改变 tagGroups 引用', () => {
    const groups = [createTagGroup()];
    useSkillStore.setState({ tagGroups: groups });

    const before = useSkillStore.getState().tagGroups;
    useSkillStore.getState().setActiveSkillView('marketplace');
    const after = useSkillStore.getState().tagGroups;

    expect(after).toBe(before);
  });
});
