// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChange, GitStatusSnapshot } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

vi.mock('../../api/gitApi', () => ({
  getWorkspaceStatus: vi.fn(),
}));

import { getWorkspaceStatus } from '../../api/gitApi';
import { createDebouncedStatusRefresh, refreshWorkspaceStatus } from '../gitStatus';

/**
 * `refreshWorkspaceStatus` / `createDebouncedStatusRefresh`。
 *
 * 迁移说明：旧文件测的是 `refreshGitFileStates(projectId, worktreePath)` +
 * `createDebouncedGitRefresh`，并 mock 掉 projectStore 只观察 `setState` 的 updater。
 * 两处不再成立：
 * - 刷新目标是**Workspace**（`WorkspaceKey`），不再是「projectId + 从全局镜像现取的 worktreePath」；
 * - worktree / WSL 分支不再回 `version: 0` 的无版本载荷（`getWorktreeChangedFilesVersioned`
 *   已删），所以旧文件里那条「并发刷新只留最新一代」的用例失去实现载体 —— 乱序覆盖现在由
 *   `applyStatus` 的 per-workspace 门控结构性消除（见 `shared/store/__tests__/projectStore.test.ts`），
 *   本文件改为断言「刷新入口不自建第二道门控、迟到快照由 store 拒收」。
 *
 * 这里刻意**不 mock projectStore**：失败语义（「不清空也不覆盖」）只有在真实槽位上才测得准。
 */

const mockGetWorkspaceStatus = vi.mocked(getWorkspaceStatus);

const fc = (path: string): FileChange => ({
  path,
  status: 'Modified',
  additions: 1,
  deletions: 0,
  is_dir: false,
});

function snapshotOf(
  projectId: string,
  worktreePath: string | null,
  version: number,
  entries: FileChange[],
): GitStatusSnapshot {
  return {
    workspace_key: WorkspaceSession.of(projectId, worktreePath ?? null).key,
    version,
    project_id: projectId,
    worktree_path: worktreePath,
    branch: worktreePath === null ? 'main' : `wt-${version}`,
    entries,
    truncated: false,
  };
}

const slotOf = (workspaceKey: string): GitStatusSnapshot | undefined =>
  useProjectStore.getState().statuses[workspaceKey];

beforeEach(() => {
  mockGetWorkspaceStatus.mockReset();
  useProjectStore.setState({
    statuses: {},
    projects: [],
    activeProjectId: null,
    activeProject: null,
  });
});

describe('refreshWorkspaceStatus — status 的唯一显式刷新入口', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('主仓单元解析为 (projectId, null) —— 不得用空串表示主仓', async () => {
    mockGetWorkspaceStatus.mockResolvedValue(snapshotOf('p1', null, 1, []));

    await refreshWorkspaceStatus(WorkspaceSession.of('p1', null).key);

    expect(mockGetWorkspaceStatus).toHaveBeenCalledWith('p1', null);
  });

  it('worktree 单元解析出 canonical 路径并按该路径查询', async () => {
    mockGetWorkspaceStatus.mockResolvedValue(snapshotOf('p1', '/wt/a', 1, []));

    await refreshWorkspaceStatus(WorkspaceSession.of('p1', '/wt/a').key);

    expect(mockGetWorkspaceStatus).toHaveBeenCalledWith('p1', '/wt/a');
  });

  it('无分隔符的裸 projectId（防御旧形态载荷）按主仓单元处理', async () => {
    mockGetWorkspaceStatus.mockResolvedValue(snapshotOf('p1', null, 1, []));

    await refreshWorkspaceStatus('p1');

    expect(mockGetWorkspaceStatus).toHaveBeenCalledWith('p1', null);
    expect(slotOf(WorkspaceSession.of('p1', null).key)?.version).toBe(1);
  });

  it('成功时快照整体入该单元槽位（全量替换，不做增量合并）', async () => {
    useProjectStore.getState().applyStatus(snapshotOf('p1', null, 1, [fc('old.ts')]));
    mockGetWorkspaceStatus.mockResolvedValue(snapshotOf('p1', null, 2, [fc('new.ts'), fc('n.ts')]));

    await refreshWorkspaceStatus(WorkspaceSession.of('p1', null).key);

    expect(slotOf(WorkspaceSession.of('p1', null).key)?.entries).toEqual([
      fc('new.ts'),
      fc('n.ts'),
    ]);
    expect(slotOf(WorkspaceSession.of('p1', null).key)?.version).toBe(2);
  });

  it('命令失败 = 状态未知：既不写空列表也不清空既有槽位', async () => {
    useProjectStore.getState().applyStatus(snapshotOf('p1', null, 4, [fc('keep.ts')]));
    const before = slotOf(WorkspaceSession.of('p1', null).key);
    mockGetWorkspaceStatus.mockRejectedValue(new Error('boom'));

    await expect(
      refreshWorkspaceStatus(WorkspaceSession.of('p1', null).key),
    ).resolves.toBeUndefined();

    // 「空列表」是一个断言（该单元确实干净），错误不是断言 —— 绝不得据此写入
    expect(slotOf(WorkspaceSession.of('p1', null).key)).toBe(before);
    expect(slotOf(WorkspaceSession.of('p1', null).key)?.entries).toEqual([fc('keep.ts')]);
    expect(consoleError).toHaveBeenCalled();
  });

  it('失败时不得凭空造出槽位（未挂载的单元保持「未知」）', async () => {
    mockGetWorkspaceStatus.mockRejectedValue(new Error('not mounted'));

    await refreshWorkspaceStatus(WorkspaceSession.of('p1', '/wt/a').key);

    expect(slotOf(WorkspaceSession.of('p1', '/wt/a').key)).toBeUndefined();
  });

  it('刷新入口不自建第二道 version 门控：迟到快照交给 store 拒收', async () => {
    useProjectStore.getState().applyStatus(snapshotOf('p1', null, 9, [fc('newer.ts')]));
    mockGetWorkspaceStatus.mockResolvedValue(snapshotOf('p1', null, 3, [fc('stale.ts')]));

    await refreshWorkspaceStatus(WorkspaceSession.of('p1', null).key);

    expect(slotOf(WorkspaceSession.of('p1', null).key)?.entries).toEqual([fc('newer.ts')]);
    expect(slotOf(WorkspaceSession.of('p1', null).key)?.version).toBe(9);
  });

  it('刷新一个单元不触碰同项目其它单元的槽位（串数据回归）', async () => {
    useProjectStore.getState().applyStatus(snapshotOf('p1', '/wt/a', 1, [fc('wtA.ts')]));
    const wtSlotBefore = slotOf(WorkspaceSession.of('p1', '/wt/a').key);
    mockGetWorkspaceStatus.mockResolvedValue(snapshotOf('p1', null, 5, [fc('main.ts')]));

    await refreshWorkspaceStatus(WorkspaceSession.of('p1', null).key);

    expect(slotOf(WorkspaceSession.of('p1', null).key)?.entries).toEqual([fc('main.ts')]);
    expect(slotOf(WorkspaceSession.of('p1', '/wt/a').key)).toBe(wtSlotBefore);
    expect(slotOf(WorkspaceSession.of('p1', '/wt/a').key)?.entries).toEqual([fc('wtA.ts')]);
  });
});

describe('createDebouncedStatusRefresh — 按单元去抖合并', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('窗口内同一单元多次调度只执行一次，并拿到该单元的 key', () => {
    const debounced = createDebouncedStatusRefresh(500);
    const run = vi.fn();
    const key = WorkspaceSession.of('p1', '/wt/a').key;

    debounced.schedule(key, run);
    debounced.schedule(key, run);
    debounced.schedule(key, run);

    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(String(key));
  });

  it('同一项目的两个单元各占一个窗口，互不取消（旧实现按 projectId 去抖会丢一次刷新）', () => {
    const debounced = createDebouncedStatusRefresh(500);
    const run = vi.fn();
    const main = WorkspaceSession.of('p1', null).key;
    const worktree = WorkspaceSession.of('p1', '/wt/a').key;

    debounced.schedule(main, run);
    debounced.schedule(worktree, run);

    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledWith(String(main));
    expect(run).toHaveBeenCalledWith(String(worktree));
  });

  it('不同单元的窗口相互独立：重置本单元不影响另一单元到期', () => {
    const debounced = createDebouncedStatusRefresh(500);
    const runMain = vi.fn();
    const runWt = vi.fn();
    const main = WorkspaceSession.of('p1', null).key;
    const worktree = WorkspaceSession.of('p1', '/wt/a').key;

    debounced.schedule(main, runMain);
    debounced.schedule(worktree, runWt);

    vi.advanceTimersByTime(300);
    debounced.schedule(main, runMain); // 主仓风暴：只重置主仓窗口

    vi.advanceTimersByTime(200);
    expect(runWt).toHaveBeenCalledTimes(1); // worktree 满 500ms 到期
    expect(runMain).not.toHaveBeenCalled(); // 主仓刚被重置

    vi.advanceTimersByTime(300);
    expect(runMain).toHaveBeenCalledTimes(1);
  });

  it('执行后定时器条目即释放：同一单元可再次调度并再次执行', () => {
    const debounced = createDebouncedStatusRefresh(500);
    const run = vi.fn();
    const key = WorkspaceSession.of('p1', null).key;

    debounced.schedule(key, run);
    vi.advanceTimersByTime(500);
    debounced.schedule(key, run);
    vi.advanceTimersByTime(500);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('WorkspaceKey 与等价裸字符串视为同一单元（去重键取字符串形态）', () => {
    const debounced = createDebouncedStatusRefresh(500);
    const run = vi.fn();
    const key = WorkspaceSession.of('p1', '/wt/a').key;

    debounced.schedule(key, run);
    debounced.schedule(String(key), run);

    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('clear() 取消全部 pending 调度（卸载防泄漏）', () => {
    const debounced = createDebouncedStatusRefresh(500);
    const run = vi.fn();

    debounced.schedule(WorkspaceSession.of('p1', null).key, run);
    debounced.schedule(WorkspaceSession.of('p1', '/wt/a').key, run);
    debounced.schedule(WorkspaceSession.of('p2', null).key, run);
    debounced.clear();

    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });
});
