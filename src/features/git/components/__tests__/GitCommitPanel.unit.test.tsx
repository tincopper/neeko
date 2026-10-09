import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import type { FileChange, GitStatusSnapshot, ProjectCapabilities } from '@/shared/types';
import { workspaceKeyOf, type WorkspaceKey } from '@/shared/utils/workspaceRef';

// 面板经 `useCommitPanelAux` 取 AppProvider 的 config（只用到 agentCommandOverrides），
// 这里给一个最小替身，避免为了渲染容器而把整个组合根搬进单测。
vi.mock('@/shared/contexts', () => ({
  useAppContext: () => ({ config: { agentCommandOverrides: {} } }),
}));

import GitCommitPanel from '../GitCommitPanel';

const MAIN_KEY = workspaceKeyOf('p1', null);
const WT_KEY = workspaceKeyOf('p1', '/private/tmp/repo/wt-a');

function file(path: string): FileChange {
  return {
    path,
    status: 'Modified',
    additions: 1,
    deletions: 0,
    index_status: ' ',
    worktree_status: 'M',
  };
}

function snapshot(
  workspaceKey: WorkspaceKey,
  entries: FileChange[],
  version = 1,
): GitStatusSnapshot {
  const [, tail] = String(workspaceKey).split('\u0000');
  return {
    workspace_key: String(workspaceKey),
    version,
    project_id: 'p1',
    worktree_path: tail === '' ? null : tail,
    branch: tail === '' ? 'main' : 'feat-a',
    entries,
    truncated: false,
  };
}

const project = {
  type: 'Local',
  id: 'p1',
  name: 'P1',
  path: '/repo/p1',
  gitInfo: { current_branch: 'main', branches: ['main'], worktrees: [] },
  selectedAgent: [],
  selectedIde: null,
} as never;

const capabilities = Object.fromEntries(
  [
    'canCommit',
    'canPush',
    'canPull',
    'canFetch',
    'canStage',
    'canDiscard',
    'canViewLog',
    'canCherryPick',
    'canRevert',
    'canCreateTag',
    'canBrowseFiles',
    'canEditFiles',
  ].map((k) => [k, true]),
) as unknown as ProjectCapabilities;

const commands = {
  refreshGitInfo: vi.fn().mockResolvedValue(null),
  getAheadBehind: vi.fn().mockResolvedValue(null),
  stageFiles: vi.fn().mockResolvedValue(undefined),
  unstageFiles: vi.fn().mockResolvedValue(undefined),
  discardFiles: vi.fn().mockResolvedValue(undefined),
  commitFiles: vi.fn().mockResolvedValue(undefined),
  // 行级 +A/-D 统计按需拉；本用例只关心「条目来自哪个单元」，给空统计即可
  getChangedFilesDiffStats: vi.fn().mockResolvedValue([]),
  getUntrackedFiles: vi.fn().mockResolvedValue([]),
  checkoutBranch: vi.fn().mockResolvedValue(undefined),
  fetch: vi.fn().mockResolvedValue(undefined),
  pull: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
} as never;

function renderPanel(workspaceKey: WorkspaceKey) {
  return render(
    <GitCommitPanel
      project={project}
      commands={commands}
      capabilities={capabilities}
      onRefreshGit={vi.fn().mockResolvedValue(undefined)}
      aheadBehind={null}
      workspaceKey={workspaceKey}
    />,
  );
}

beforeEach(() => {
  useProjectStore.setState({ statuses: {} } as never);
});

describe('GitCommitPanel — 面板可见性由「单元槽位」决定（issue #2 的原始症状）', () => {
  it('已挂载且有权威快照 ⇒ 文件行真的渲染出来（既不是 loading 也不是 No changes）', () => {
    useProjectStore.getState().applyStatus(snapshot(WT_KEY, [file('only-in-wt.ts')]));

    renderPanel(WT_KEY);

    expect(screen.getByText('only-in-wt.ts')).toBeInTheDocument();
    expect(screen.queryByText('Loading changes…')).not.toBeInTheDocument();
    expect(screen.queryByText('No changes')).not.toBeInTheDocument();
  });

  it('槽位缺失（未挂载 / 首个快照未到）⇒ 明示「Loading changes…」，不得伪装成干净', () => {
    // 主仓有数据，但当前视图是那个还没有快照的 worktree
    useProjectStore.getState().applyStatus(snapshot(MAIN_KEY, [file('only-in-main.ts')]));

    renderPanel(WT_KEY);

    expect(screen.getByText('Loading changes…')).toBeInTheDocument();
    expect(screen.queryByText('No changes')).not.toBeInTheDocument();
    // 「未知」被渲染成上一个单元的数据 = 本次要根治的串内容形态
    expect(screen.queryByText('only-in-main.ts')).not.toBeInTheDocument();
  });

  it('权威快照为空 ⇒ 才是真的「No changes」（与「未知」是两种界面）', () => {
    useProjectStore.getState().applyStatus(snapshot(MAIN_KEY, []));

    renderPanel(MAIN_KEY);

    expect(screen.getByText('No changes')).toBeInTheDocument();
    expect(screen.queryByText('Loading changes…')).not.toBeInTheDocument();
  });

  it('主仓 ↔ worktree 交替：每格只显示自己单元的条目，切换瞬间不残留对面内容', () => {
    useProjectStore.getState().applyStatus(snapshot(MAIN_KEY, [file('only-in-main.ts')]));
    useProjectStore
      .getState()
      .applyStatus(snapshot(WT_KEY, [file('only-in-wt.ts'), file('second-in-wt.ts')]));

    const { rerender } = renderPanel(MAIN_KEY);
    expect(screen.getByText('only-in-main.ts')).toBeInTheDocument();
    expect(screen.queryByText('only-in-wt.ts')).not.toBeInTheDocument();

    // 切到 worktree 单元
    rerender(
      <GitCommitPanel
        project={project}
        commands={commands}
        capabilities={capabilities}
        onRefreshGit={vi.fn().mockResolvedValue(undefined)}
        aheadBehind={null}
        workspaceKey={WT_KEY}
      />,
    );
    expect(screen.getByText('only-in-wt.ts')).toBeInTheDocument();
    expect(screen.getByText('second-in-wt.ts')).toBeInTheDocument();
    expect(screen.queryByText('only-in-main.ts')).not.toBeInTheDocument();

    // 切回主仓
    rerender(
      <GitCommitPanel
        project={project}
        commands={commands}
        capabilities={capabilities}
        onRefreshGit={vi.fn().mockResolvedValue(undefined)}
        aheadBehind={null}
        workspaceKey={MAIN_KEY}
      />,
    );
    expect(screen.getByText('only-in-main.ts')).toBeInTheDocument();
    expect(screen.queryByText('only-in-wt.ts')).not.toBeInTheDocument();
  });
});
