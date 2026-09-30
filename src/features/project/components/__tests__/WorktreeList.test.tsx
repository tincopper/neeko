import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { GitStatusSnapshot, Worktree } from '@/shared/types';
import { repoKeyOf } from '@/shared/utils/repoRef';

// spy 必须经 vi.hoisted 创建：`vi.mock` 的 factory 会被提升到模块顶层语句之前执行，
// 直接引用外层 `const api` 会拿到 undefined —— 组件调用的就不是这里断言的那个函数。
const api = vi.hoisted(() => ({
  removeWorktree: vi.fn(),
  deleteBranch: vi.fn(),
  renameWorktree: vi.fn(),
  canonicalWorktreePath: vi.fn(),
  getRepoStatus: vi.fn(),
  isWorktreeDirty: vi.fn(),
  closeTerminalSession: vi.fn(),
  cleanupTerminalsForTabKey: vi.fn(),
}));

vi.mock('@/features/git/api/gitApi', () => ({
  removeWorktree: api.removeWorktree,
  deleteBranch: api.deleteBranch,
  renameWorktree: api.renameWorktree,
  canonicalWorktreePath: api.canonicalWorktreePath,
  getRepoStatus: api.getRepoStatus,
  isWorktreeDirty: api.isWorktreeDirty,
}));
vi.mock('@/features/terminal/api/terminalApi', () => ({
  closeTerminalSession: api.closeTerminalSession,
}));
vi.mock('@/features/terminal', () => ({
  // 删除工作树时回收该 tab 空间下的全部 PTY：唯一入口是终端域自己的清理函数
  //（手拼 `${projectId}:wt:${path}` 只是前缀，查不到真实的 4 段键）。
  cleanupTerminalsForTabKey: api.cleanupTerminalsForTabKey,
}));

import WorktreeList from '../WorktreeList';

const PROJECT_ID = 'p1';
const WT_PATH = '/repo/.worktrees/dev';
const WT_KEY = String(repoKeyOf(PROJECT_ID, WT_PATH));

const worktrees = [{ path: WT_PATH, branch: 'feature/dev' }] as unknown as Worktree[];

function snapshot(version = 3): GitStatusSnapshot {
  return {
    repo_key: WT_KEY,
    project_id: PROJECT_ID,
    worktree_path: WT_PATH,
    version,
    branch: 'feature/dev',
    entries: [{ path: 'dirty.ts', status: 'Modified', additions: 1, deletions: 0 }],
    truncated: false,
  } as unknown as GitStatusSnapshot;
}

/** 铺好前置状态：当前视图 = 该 worktree 单元，且它的槽里有一份权威数据。 */
function seedActiveUnit() {
  useWorktreeStore.setState({ byProject: {} });
  useProjectStore.setState({ statuses: {} } as never);
  useWorktreeStore.getState().setActiveWorktree(PROJECT_ID, WT_PATH, 'feature/dev');
  useProjectStore.getState().applyStatus(snapshot());
}

function renderList() {
  return render(
    <WorktreeList
      worktrees={worktrees}
      projectId={PROJECT_ID}
      onRefreshGit={vi.fn()}
      onOpenWorktreeTerminal={() => undefined}
      onShowToast={() => undefined}
    />,
  );
}

async function clickRemoveAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTitle('Remove worktree and branch'));
  await user.click(await screen.findByRole('button', { name: /^Remove$/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.removeWorktree.mockResolvedValue(undefined);
  api.deleteBranch.mockResolvedValue(undefined);
  api.renameWorktree.mockResolvedValue(undefined);
  // 归一默认原样返回（本地无符号链接形态差的常见情形）；单个用例可覆盖成异形态
  api.canonicalWorktreePath.mockImplementation((_projectId: string, path: string) =>
    Promise.resolve(path),
  );
  api.isWorktreeDirty.mockResolvedValue(false);
  api.closeTerminalSession.mockResolvedValue(undefined);
  // 未挂载单元的侧栏 +A/-D 走 pull 通道。删除之后该 worktree 已不存在，后端解析必失败 ——
  // 若不这样收口，组件的按需 pull 会把刚作废的槽位重新填上，测试就分不清「作废」与「被重填」。
  api.getRepoStatus.mockImplementation((_projectId: string, path: string | null) =>
    path === WT_PATH ? Promise.reject(new Error('worktree is gone')) : Promise.resolve(snapshot(1)),
  );
});

describe('WorktreeList — 单元生命周期收口（R2.4 / I1-b）', () => {
  it('删除 worktree 后：该单元槽位作废，且它是当前视图时激活态回落主仓', async () => {
    seedActiveUnit();
    expect(useProjectStore.getState().statuses[WT_KEY]).toBeDefined();

    renderList();
    await clickRemoveAndConfirm(userEvent.setup());

    await waitFor(() => expect(api.removeWorktree).toHaveBeenCalledWith(PROJECT_ID, WT_PATH));
    await waitFor(() => expect(useProjectStore.getState().statuses[WT_KEY]).toBeUndefined());
    expect(useWorktreeStore.getState().byProject[PROJECT_ID]?.activePath).toBeNull();
    // PTY 回收走终端域的 tab 空间入口：真实缓存键是 `{tabKey}:{tabId}:{paneId}`，
    // 手拼 `${projectId}:wt:${path}` 两段式查不到任何条目（PTY 会一直挂着）。
    expect(api.cleanupTerminalsForTabKey).toHaveBeenCalledWith(`p1:wt:${WT_PATH}`);
  });

  it('删除命令失败时不作废槽位（工作树还在，数据仍然有效）', async () => {
    seedActiveUnit();
    api.removeWorktree.mockRejectedValue(new Error('busy'));

    renderList();
    await clickRemoveAndConfirm(userEvent.setup());

    await waitFor(() => expect(api.removeWorktree).toHaveBeenCalled());
    expect(useProjectStore.getState().statuses[WT_KEY]).toBeDefined();
    expect(useWorktreeStore.getState().byProject[PROJECT_ID]?.activePath).toBe(WT_PATH);
  });

  it('改名后：旧路径单元作废，激活态改指**后端 canonical** 的新路径', async () => {
    seedActiveUnit();
    // 后端 canonical 形态与前端派生串不同（macOS 符号链接根的常态）：激活态必须写后端形态
    const canonicalNewPath = '/private/repo/.worktrees/renamed';
    api.canonicalWorktreePath.mockResolvedValue(canonicalNewPath);

    const user = userEvent.setup();
    renderList();
    await user.dblClick(screen.getByTitle('Double-click to rename'));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'renamed');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(api.renameWorktree).toHaveBeenCalled());
    const [, oldPath, newPath] = api.renameWorktree.mock.calls[0] as unknown as [
      string,
      string,
      string,
    ];
    expect(oldPath).toBe(WT_PATH);
    expect(newPath).toBe('/repo/.worktrees/renamed');
    await waitFor(() =>
      expect(api.canonicalWorktreePath).toHaveBeenCalledWith(PROJECT_ID, newPath),
    );
    await waitFor(() => expect(useProjectStore.getState().statuses[WT_KEY]).toBeUndefined());
    expect(useWorktreeStore.getState().byProject[PROJECT_ID]?.activePath).toBe(canonicalNewPath);
  });

  it('改名后 canonical 归一失败时激活态回落主仓（宁可回落，不留第二种身份表示）', async () => {
    seedActiveUnit();
    api.canonicalWorktreePath.mockRejectedValue(new Error('path is gone'));

    const user = userEvent.setup();
    renderList();
    await user.dblClick(screen.getByTitle('Double-click to rename'));
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'renamed');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(api.canonicalWorktreePath).toHaveBeenCalled());
    await waitFor(() =>
      expect(useWorktreeStore.getState().byProject[PROJECT_ID]?.activePath).toBeNull(),
    );
  });

  it('重新挂载列表会重拉未挂载单元的 chip 数据（持久化槽位不得永久抑制重拉）', async () => {
    // 非激活视图：该单元没有 push 生产者，chip 的数据源只有按需 pull。
    // 旧守卫拿全局槽位（key in statuses）当跳过条件 ⇒ 槽位跨挂载持久 ⇒ chip 永久陈旧。
    useWorktreeStore.setState({ byProject: {} });
    useProjectStore.setState({ statuses: {} } as never);
    api.getRepoStatus.mockResolvedValue(snapshot(1));

    const { unmount } = renderList();
    await waitFor(() => expect(api.getRepoStatus).toHaveBeenCalledWith(PROJECT_ID, WT_PATH));
    await waitFor(() => expect(useProjectStore.getState().statuses[WT_KEY]).toBeDefined());
    unmount();

    renderList();
    await waitFor(() => expect(api.getRepoStatus).toHaveBeenCalledTimes(2));
  });
});
