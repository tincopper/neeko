import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as libraryApi from '@/features/library/api/libraryApi';
import type { McpTagGroup } from '@/shared/types/mcpServer';

import { useMcpStore, resetMcpState } from '../mcpStore';

function makeTagGroup(overrides: Partial<McpTagGroup> = {}): McpTagGroup {
  return {
    id: 'tg-1',
    name: 'Backend',
    description: null,
    icon: null,
    sortOrder: 0,
    serverCount: 2,
    ...overrides,
  };
}

describe('mcpStore tag group actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMcpState();
  });

  it('refreshMcpTagGroups 拉取并写入 tag groups 缓存', async () => {
    const groups = [makeTagGroup(), makeTagGroup({ id: 'tg-2', name: 'Frontend' })];
    vi.spyOn(libraryApi, 'getMcpTagGroups').mockResolvedValue(groups);

    await useMcpStore.getState().refreshMcpTagGroups();

    expect(useMcpStore.getState().mcpTagGroups).toEqual(groups);
    expect(useMcpStore.getState().mcpTagGroupsLoading).toBe(false);
  });

  it('refreshMcpTagGroups 失败时静默重置 loading 状态', async () => {
    vi.spyOn(libraryApi, 'getMcpTagGroups').mockRejectedValue(new Error('db error'));

    await useMcpStore.getState().refreshMcpTagGroups();

    expect(useMcpStore.getState().mcpTagGroups).toEqual([]);
    expect(useMcpStore.getState().mcpTagGroupsLoading).toBe(false);
  });

  it('createMcpTagGroup 创建成功后刷新列表', async () => {
    const created = makeTagGroup({ id: 'tg-new', name: 'Frontend' });
    vi.spyOn(libraryApi, 'createMcpTagGroup').mockResolvedValue(created);
    vi.spyOn(libraryApi, 'getMcpTagGroups').mockResolvedValue([created]);

    const result = await useMcpStore.getState().createMcpTagGroup({ name: 'Frontend' });

    expect(result).toEqual(created);
    expect(useMcpStore.getState().mcpTagGroups).toEqual([created]);
  });

  it('deleteMcpTagGroup 删除后刷新列表', async () => {
    const groups = [makeTagGroup(), makeTagGroup({ id: 'tg-2', name: 'Frontend' })];
    vi.spyOn(libraryApi, 'getMcpTagGroups').mockResolvedValue(groups);
    await useMcpStore.getState().refreshMcpTagGroups();

    vi.spyOn(libraryApi, 'deleteMcpTagGroup').mockResolvedValue(undefined);
    vi.spyOn(libraryApi, 'getMcpTagGroups').mockResolvedValue([groups[1]]);

    await useMcpStore.getState().deleteMcpTagGroup('tg-1');

    expect(useMcpStore.getState().mcpTagGroups).toEqual([groups[1]]);
  });

  it('addServerToMcpTagGroup 透传 tagGroupId 与 serverId', async () => {
    const addSpy = vi.spyOn(libraryApi, 'addServerToMcpTagGroup').mockResolvedValue(undefined);

    await useMcpStore.getState().addServerToMcpTagGroup('tg-1', 'srv-9');

    expect(addSpy).toHaveBeenCalledWith('tg-1', 'srv-9');
  });

  it('setActiveMcpTagGroup 设置当前筛选分组', () => {
    useMcpStore.getState().setActiveMcpTagGroup('tg-2');
    expect(useMcpStore.getState().activeMcpTagGroup).toBe('tg-2');

    useMcpStore.getState().setActiveMcpTagGroup(null);
    expect(useMcpStore.getState().activeMcpTagGroup).toBeNull();
  });
});
