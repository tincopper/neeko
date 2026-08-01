import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: { setState: vi.fn() },
}));

vi.mock('../../api/gitApi', () => ({
  getWorktreeChangedFiles: vi.fn(),
  getIgnoredFiles: vi.fn(),
}));

import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChange, GitInfo } from '@/shared/types';

import { getIgnoredFiles, getWorktreeChangedFiles } from '../../api/gitApi';
import { refreshGitFileStates } from '../gitStatus';

const mockGetWorktreeChangedFiles = vi.mocked(getWorktreeChangedFiles);
const mockGetIgnoredFiles = vi.mocked(getIgnoredFiles);
const mockSetState = vi.mocked(useProjectStore.setState);

const makeGitInfo = (changedFiles: FileChange[] = []): GitInfo => ({
  current_branch: 'main',
  branches: ['main'],
  worktrees: [],
  changed_files: changedFiles,
  is_clean: changedFiles.length === 0,
  git_provider: 'local',
});

interface TestProject {
  id: string;
  git_info: GitInfo;
}

const makeState = (projects: TestProject[], activeProjectId: string | null) => ({
  projects,
  activeProjectId,
  activeProject: activeProjectId ? (projects.find((p) => p.id === activeProjectId) ?? null) : null,
});

describe('refreshGitFileStates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('获取 changed_files 与 ignored_files 并 patch 到指定项目', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue([
      { path: 'new.ts', status: 'Untracked', additions: 0, deletions: 0 },
    ]);
    mockGetIgnoredFiles.mockResolvedValue(['.env', 'dist']);
    mockSetState.mockImplementation((updater) => {
      const state = makeState(
        [
          { id: 'p1', git_info: makeGitInfo() },
          { id: 'p2', git_info: makeGitInfo() },
        ],
        'p1',
      );
      const next = updater(state as never) as typeof state;
      // 目标项目被 patch（changed_files + ignored_files）
      expect(next.projects[0].git_info.changed_files).toHaveLength(1);
      expect(next.projects[0].git_info.changed_files[0].status).toBe('Untracked');
      expect(next.projects[0].git_info.is_clean).toBe(false);
      expect(next.projects[0].git_info.ignored_files).toEqual(['.env', 'dist']);
      // 其他项目不受影响
      expect(next.projects[1].git_info.changed_files).toHaveLength(0);
      expect(next.projects[1].git_info.ignored_files).toBeUndefined();
      // activeProject 同步更新
      expect(next.activeProject?.id).toBe('p1');
    });

    await refreshGitFileStates('p1', '');
    expect(mockGetWorktreeChangedFiles).toHaveBeenCalledWith('p1', '');
    expect(mockGetIgnoredFiles).toHaveBeenCalledWith('p1', '');
    expect(mockSetState).toHaveBeenCalledTimes(1);
  });

  it('worktree 路径透传给两个 API', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue([]);
    mockGetIgnoredFiles.mockResolvedValue([]);
    await refreshGitFileStates('p1', '/wt/path');
    expect(mockGetWorktreeChangedFiles).toHaveBeenCalledWith('p1', '/wt/path');
    expect(mockGetIgnoredFiles).toHaveBeenCalledWith('p1', '/wt/path');
  });

  it('get_ignored_files 失败时回退为空列表（非 git 仓库）', async () => {
    mockGetWorktreeChangedFiles.mockResolvedValue([]);
    mockGetIgnoredFiles.mockRejectedValue(new Error('not a repo'));
    mockSetState.mockImplementation((updater) => {
      const state = makeState([{ id: 'p1', git_info: makeGitInfo() }], 'p1');
      const next = updater(state as never) as typeof state;
      expect(next.projects[0].git_info.ignored_files).toEqual([]);
    });
    await refreshGitFileStates('p1', '');
    expect(mockSetState).toHaveBeenCalledTimes(1);
  });

  it('changed_files 失败时静默忽略（不抛出、不 patch）', async () => {
    mockGetWorktreeChangedFiles.mockRejectedValue(new Error('boom'));
    mockGetIgnoredFiles.mockResolvedValue([]);
    await expect(refreshGitFileStates('p1', '')).resolves.toBeUndefined();
    expect(mockSetState).not.toHaveBeenCalled();
  });
});
