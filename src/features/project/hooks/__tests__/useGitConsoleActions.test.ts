import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pull, push } from '@/features/git/api/gitApi';
import {
  GIT_BUSY_MESSAGE,
  SSH_AUTH_FAILED_MESSAGE,
  runGitConsoleOp,
  type GitConsoleOpResult,
} from '@/features/git/api/gitConsoleRun';
import { useGitConsoleActions } from '@/features/project/hooks/useGitConsoleActions';
import type { PushOutcome } from '@/shared/types';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

/**
 * 侧栏 push / pull 的**一条编排，两个入口**。
 *
 * 这层不测 Console 生命周期（那是 `runGitConsoleOp` 的既有护栏），只测「本 hook 的决策」：
 * 把 `ok` / `busy` / `stopped` / `AuthRequired` / 抛错翻成什么（toast？刷新？静默？），
 * 以及 worktree 路径**只对激活项目**生效这条规则。
 */
vi.mock('@/features/git/api/gitApi', () => ({ push: vi.fn(), pull: vi.fn() }));

// 保留真实的 isAuthRequired / 文案常量（它们是同一个模块的导出），只替换 Console 编排。
vi.mock('@/features/git/api/gitConsoleRun', async () => {
  const actual = await vi.importActual<typeof import('@/features/git/api/gitConsoleRun')>(
    '@/features/git/api/gitConsoleRun',
  );
  return { ...actual, runGitConsoleOp: vi.fn() };
});

const PROJECT_ID = 'proj-1' as ProjectId;
const PROJECTS = [createProject({ id: PROJECT_ID, path: '/repo/one' })];

const SUCCESS: PushOutcome = { Success: {} };
const AUTH_SSH: PushOutcome = {
  AuthRequired: { remote_url: 'git@github.com:o/r.git', username_hint: null, ssh: true },
};
const AUTH_HTTPS: PushOutcome = {
  AuthRequired: { remote_url: 'https://github.com/o/r.git', username_hint: 'octocat', ssh: false },
};

function renderActions(overrides: Partial<Parameters<typeof useGitConsoleActions>[0]> = {}): {
  handlePush: (projectId: ProjectId) => void;
  handlePull: (projectId: ProjectId) => void;
  onRefreshGit: ReturnType<typeof vi.fn>;
  showToast: ReturnType<typeof vi.fn>;
} {
  const onRefreshGit = vi.fn();
  const showToast = vi.fn();
  const { result } = renderHook(() =>
    useGitConsoleActions({
      projects: PROJECTS,
      activeProjectId: PROJECT_ID,
      activeCheckoutPath: null,
      onRefreshGit,
      showToast,
      ...overrides,
    }),
  );
  return { ...result.current, onRefreshGit, showToast };
}

/** 让 `runGitConsoleOp` 返回给定结果。 */
function consoleReturns(result: GitConsoleOpResult<PushOutcome>): void {
  vi.mocked(runGitConsoleOp).mockResolvedValue(result);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(push).mockResolvedValue(SUCCESS);
  vi.mocked(pull).mockResolvedValue(SUCCESS);
});

describe('useGitConsoleActions', () => {
  it('push 走 git push 的 Console run，成功只刷新、不打扰用户', async () => {
    consoleReturns({ status: 'ok', value: SUCCESS });
    const { handlePush, onRefreshGit, showToast } = renderActions();

    await act(async () => handlePush(PROJECT_ID));

    expect(runGitConsoleOp).toHaveBeenCalledWith(
      expect.objectContaining({
        header: 'git push',
        projectId: PROJECT_ID,
        projectPath: '/repo/one',
        isAuthRequired: expect.any(Function),
      }),
    );
    expect(onRefreshGit).toHaveBeenCalledWith(PROJECT_ID);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('pull 与 push 共用编排：同一套 busy / 取消 / 刷新语义', async () => {
    consoleReturns({ status: 'ok', value: SUCCESS });
    const { handlePull, onRefreshGit } = renderActions();

    await act(async () => handlePull(PROJECT_ID));

    expect(runGitConsoleOp).toHaveBeenCalledWith(
      expect.objectContaining({ header: 'git pull', projectPath: '/repo/one' }),
    );
    expect(onRefreshGit).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('该仓库已有操作在跑 ⇒ 只提示 busy，不刷新', async () => {
    consoleReturns({ status: 'busy' });
    const { handlePush, onRefreshGit, showToast } = renderActions();

    await act(async () => handlePush(PROJECT_ID));

    expect(showToast).toHaveBeenCalledWith(GIT_BUSY_MESSAGE, 'error');
    expect(onRefreshGit).not.toHaveBeenCalled();
  });

  it('用户取消 ⇒ 静默（不弹错误、不刷新）', async () => {
    consoleReturns({ status: 'stopped' });
    const { handlePush, onRefreshGit, showToast } = renderActions();

    await act(async () => handlePush(PROJECT_ID));

    expect(showToast).not.toHaveBeenCalled();
    expect(onRefreshGit).not.toHaveBeenCalled();
  });

  it('SSH 认证失败 ⇒ 与 Git 面板同一句文案，且不刷新（没有发生变更）', async () => {
    consoleReturns({ status: 'ok', value: AUTH_SSH });
    const { handlePush, onRefreshGit, showToast } = renderActions();

    await act(async () => handlePush(PROJECT_ID));

    expect(showToast).toHaveBeenCalledWith(SSH_AUTH_FAILED_MESSAGE, 'error');
    expect(onRefreshGit).not.toHaveBeenCalled();
  });

  it('需要用户名密码 ⇒ 指出去哪儿解决（URL + 用户名提示）', async () => {
    consoleReturns({ status: 'ok', value: AUTH_HTTPS });
    const { handlePull, showToast } = renderActions();

    await act(async () => handlePull(PROJECT_ID));

    const [message, type] = vi.mocked(showToast).mock.calls[0];
    expect(type).toBe('error');
    expect(message).toContain('https://github.com/o/r.git');
    expect(message).toContain('(user: octocat)');
    expect(message).toContain('main commit panel');
  });

  it('命令抛错 ⇒ 把原因交给 toast（不吞掉）', async () => {
    vi.mocked(runGitConsoleOp).mockRejectedValue(new Error('ipc down'));
    const { handlePush, showToast } = renderActions();

    await act(async () => handlePush(PROJECT_ID));

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('ipc down'), 'error');
  });

  it('worktree 路径只对激活项目生效：非激活项目一律走主 checkout', async () => {
    consoleReturns({ status: 'ok', value: SUCCESS });
    const { handlePull } = renderActions({ activeCheckoutPath: '/repo/one-wt/feature-a' });

    await act(async () => handlePull(PROJECT_ID));
    // 激活项目 + 有 checkout 路径 ⇒ 带上 worktree
    expect(vi.mocked(runGitConsoleOp).mock.calls[0][0].projectPath).toBe('/repo/one');
    const opts = vi.mocked(runGitConsoleOp).mock.calls[0][0];
    await act(async () => {
      await opts.run('run-1');
    });
    expect(vi.mocked(pull).mock.calls[0][0].worktreePath).toBe('/repo/one-wt/feature-a');
  });

  it('非激活项目：checkout 路径不得串台（worktreePath = null）', async () => {
    consoleReturns({ status: 'ok', value: SUCCESS });
    const otherProject = 'proj-2' as ProjectId;
    const { handlePull } = renderActions({
      projects: [...PROJECTS, createProject({ id: otherProject, path: '/repo/two' })],
      activeCheckoutPath: '/repo/one-wt/feature-a',
    });

    await act(async () => handlePull(otherProject));
    const opts = vi.mocked(runGitConsoleOp).mock.calls[0][0];
    expect(opts.projectPath).toBe('/repo/two');
    await act(async () => {
      await opts.run('run-1');
    });
    expect(vi.mocked(pull).mock.calls[0][0].worktreePath).toBeNull();
  });
});
