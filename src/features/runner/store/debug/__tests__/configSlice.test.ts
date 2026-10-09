// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '@/shared/store/workspaceStore';

import type * as DebugApi from '../../../api/debugApi';
import { useDebugStore } from '../../debugStore';

const dapListConfigs = vi.hoisted(() => vi.fn());
const dapSaveConfigs = vi.hoisted(() => vi.fn());
const dapDiscoverEntries = vi.hoisted(() => vi.fn());
const dapGetSession = vi.hoisted(() => vi.fn());
const dapGetBreakpoints = vi.hoisted(() => vi.fn());
const dapGetBreakpointsMuted = vi.hoisted(() => vi.fn());

vi.mock('../../../api/debugApi', async (importOriginal) => ({
  ...(await importOriginal<typeof DebugApi>()),
  dapListConfigs,
  dapSaveConfigs,
  dapDiscoverEntries,
  dapGetSession,
  dapGetBreakpoints,
  dapGetBreakpointsMuted,
}));

const WORKTREE = '/home/u/.neeko/worktrees/fix-1';

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({ byProject: {} });
  dapListConfigs.mockResolvedValue([]);
  dapGetSession.mockResolvedValue(null);
  dapGetBreakpoints.mockResolvedValue([]);
  dapGetBreakpointsMuted.mockResolvedValue(false);
  dapDiscoverEntries.mockResolvedValue([]);
});

describe('configSlice 启动配置 / 入口点按执行单元根读写', () => {
  it('激活 worktree → list / discover / save 的 worktreePath 均带该根', async () => {
    useWorkspaceStore.getState().setActiveWorkspace('p1', WORKTREE);

    await useDebugStore.getState().loadConfigs('p1');
    expect(dapListConfigs).toHaveBeenCalledWith('p1', WORKTREE);

    await useDebugStore.getState().loadEntries('p1');
    expect(dapDiscoverEntries).toHaveBeenCalledWith('p1', WORKTREE);

    await useDebugStore.getState().saveConfigs('p1', []);
    expect(dapSaveConfigs).toHaveBeenCalledWith('p1', WORKTREE, []);
  });

  it('无激活 worktree → null（主仓单元，后端收敛成项目根）', async () => {
    await useDebugStore.getState().loadConfigs('p1');
    expect(dapListConfigs).toHaveBeenCalledWith('p1', null);
  });
});
