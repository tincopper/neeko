// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileChange, GitInfo, GitStatusSnapshot } from '@/shared/types';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

import type * as projectStoreModule from '../projectStore';

/**
 * `applyStatus` —— changed_files 的唯一权威写入口（G2 D4 version gate 的现形态）。
 *
 * 迁移说明：本文件此前测的是 `versionGateAccepts` + `applyGitStatus`（per-project 单槽）。
 * 一个 Neeko project 在 git 语义下是 `1 + N` 个Workspace（主仓 + N 个 linked worktree，
 * HEAD / index / workdir 各自独立），因此门控与槽位都按 `WorkspaceKey` 定址。旧 API 的两条
 * 特殊分支已整体删除，**不再有意义**，故不再保留等价用例：
 * - `version <= 0` 恒放行：那是「WSL/worktree 兜底载荷无版本语义」的补丁；现在所有生产者
 *   （含 pull 计算的 WSL/SSH）都产出恒 > 0 的 per-workspace version（见 `getWorkspaceStatus`）。
 * - `allowEqual` 同版本幂等放行：那是「worktree 激活期丢弃主快照后切回来要能恢复」的补丁；
 *   丢弃守卫已不存在（快照按 workspace_key 定址，不存在被别的单元吃掉的数据），所以恢复需求消失。
 *
 * 每个用例经 `vi.resetModules` + 动态 import 拿到全新 store 实例，保证互不依赖。
 */
async function freshModule(): Promise<typeof projectStoreModule> {
  vi.resetModules();
  return import('../projectStore');
}

const fc = (path: string): FileChange => ({
  path,
  status: 'Modified',
  additions: 1,
  deletions: 0,
  is_dir: false,
});

/** per-project 元数据（**没有** changed_files / is_clean —— 那是 per-workspace 事实） */
const gitInfo = (overrides: Partial<GitInfo> = {}): GitInfo => ({
  current_branch: 'main',
  branches: ['main', 'dev'],
  worktrees: [],
  git_provider: 'GitHub',
  ...overrides,
});

const MAIN = workspaceKeyOf('p1');
const WT_A = workspaceKeyOf('p1', '/wt/a');
const WT_B = workspaceKeyOf('p1', '/wt/b');

function snapshot(
  opts: Pick<GitStatusSnapshot, 'version'> & Partial<Omit<GitStatusSnapshot, 'version'>>,
): GitStatusSnapshot {
  const projectId = opts.project_id ?? 'p1';
  const worktreePath = opts.worktree_path ?? null;
  return {
    workspace_key: opts.workspace_key ?? workspaceKeyOf(projectId, worktreePath),
    version: opts.version,
    project_id: projectId,
    worktree_path: worktreePath,
    branch: opts.branch ?? '',
    entries: opts.entries ?? [],
    truncated: opts.truncated ?? false,
  };
}

let mod: typeof projectStoreModule;

beforeEach(async () => {
  mod = await freshModule();
});

const store = () => mod.useProjectStore.getState();

describe('applyStatus — per-workspace version gate（槽位按 WorkspaceKey 定址）', () => {
  it('该单元首个快照直接入槽，entries 原样保存', () => {
    store().applyStatus(snapshot({ version: 7, branch: 'main', entries: [fc('a.ts')] }));

    expect(store().statuses[MAIN]?.entries).toEqual([fc('a.ts')]);
    expect(store().statuses[MAIN]?.version).toBe(7);
  });

  it('更高版本整体替换（全量快照语义，不做增量合并）', () => {
    store().applyStatus(snapshot({ version: 1, entries: [fc('a.ts')] }));
    store().applyStatus(snapshot({ version: 2, entries: [fc('b.ts')] }));

    expect(store().statuses[MAIN]?.entries).toEqual([fc('b.ts')]);
  });

  it('同单元等版本拒绝 —— 没有 allowEqual 逃生口，且槽位引用保持不变', () => {
    const first = snapshot({ version: 5, entries: [fc('a.ts')] });
    store().applyStatus(first);
    const before = store().statuses[MAIN];

    // 同一 version 的重复投递（事件重放 / 手动刷新撞上同一代快照）不得改写槽位
    store().applyStatus(snapshot({ version: 5, entries: [fc('evil.ts')] }));

    expect(store().statuses[MAIN]).toBe(before);
    expect(store().statuses[MAIN]?.entries).toEqual([fc('a.ts')]);
  });

  it('同单元旧版本拒绝，槽位保持最新一代', () => {
    store().applyStatus(snapshot({ version: 9, entries: [fc('newer.ts')] }));
    store().applyStatus(snapshot({ version: 8, entries: [fc('stale.ts')] }));
    store().applyStatus(snapshot({ version: 1, entries: [fc('ancient.ts')] }));

    expect(store().statuses[MAIN]?.entries).toEqual([fc('newer.ts')]);
    expect(store().statuses[MAIN]?.version).toBe(9);
  });

  it('切项目回来时槽位可能未作废：入槽只看号大小，没有「重新挂载 ⇒ 号归零」的特例', () => {
    // 契约两侧各半：后端 `store_snapshot` 保证号段跨挂载单调（回归由 Rust 侧
    // `remount_continues_the_unit_version_sequence` 钉），前端因此**不需要**在切回时先作废，
    // 新快照凭更大的 `version` 直接入槽。这里钉的是「前端不得为此加特例」—— 一旦补一个
    // 「看着像新纪元的 v1 也放行」的分支，pull 覆盖 push 的口子就回来了。
    store().applyStatus(snapshot({ version: 3, entries: [fc('before-leave.ts')] }));
    store().applyStatus(snapshot({ version: 4, entries: [fc('after-return.ts')] }));

    expect(store().statuses[MAIN]?.entries).toEqual([fc('after-return.ts')]);
    expect(store().statuses[MAIN]?.version).toBe(4);

    // 反向：同号/旧号仍然被拒（门控没有为「重新挂载」开口子）
    store().applyStatus(snapshot({ version: 4, entries: [fc('duplicate.ts')] }));
    expect(store().statuses[MAIN]?.entries).toEqual([fc('after-return.ts')]);
  });

  it('两个单元版本互相独立：另一单元已推进不得让本单元的旧版本被丢弃（串数据回归）', () => {
    // 主仓 worker 一路推到 v9；worktree 刚挂载，首个快照只到 v1。
    store().applyStatus(snapshot({ version: 9, entries: [fc('main9.ts')] }));
    store().applyStatus(
      snapshot({ version: 1, worktree_path: '/wt/a', branch: 'wt-a', entries: [fc('wtA1.ts')] }),
    );

    expect(store().statuses[WT_A]?.version).toBe(1);
    expect(store().statuses[WT_A]?.entries).toEqual([fc('wtA1.ts')]);

    // 反向同理：worktree 的 v2 与主仓的 v9 各自推进，互不干扰
    store().applyStatus(
      snapshot({ version: 2, worktree_path: '/wt/a', branch: 'wt-a', entries: [fc('wtA2.ts')] }),
    );
    expect(store().statuses[WT_A]?.entries).toEqual([fc('wtA2.ts')]);
    expect(store().statuses[MAIN]?.entries).toEqual([fc('main9.ts')]);
  });

  it('同项目的不同 worktree 各自成槽，互不覆盖', () => {
    store().applyStatus(snapshot({ version: 1, worktree_path: '/wt/a', entries: [fc('a.ts')] }));
    store().applyStatus(snapshot({ version: 1, worktree_path: '/wt/b', entries: [fc('b.ts')] }));

    expect(store().statuses[WT_A]?.entries).toEqual([fc('a.ts')]);
    expect(store().statuses[WT_B]?.entries).toEqual([fc('b.ts')]);
  });

  it('项目间隔离：p1 的高版本不影响 p2 的低版本', () => {
    store().applyStatus(snapshot({ version: 10, project_id: 'p1' }));
    store().applyStatus(snapshot({ version: 1, project_id: 'p2' }));

    expect(store().statuses[workspaceKeyOf('p2')]?.version).toBe(1);
  });

  it('门控拒旧时主仓投影同样不发生（不会用陈旧分支改写 git_info）', () => {
    mod.useProjectStore.setState({ projects: [createProject({ id: 'p1', git_info: gitInfo() })] });
    store().applyStatus(snapshot({ version: 3, branch: 'dev' }));

    store().applyStatus(snapshot({ version: 2, branch: 'stale-branch' }));

    expect(mod.useProjectStore.getState().projects[0]?.git_info?.current_branch).toBe('dev');
  });

  it('槽位已是版本 4 时，同版本与更低版本都被拒（门控只在 applyStatus 内）', () => {
    // 陈旧基线由 setState 直接铺设 —— applyStatus 是唯一写入口，不为此在生产接口上开注入口
    mod.useProjectStore.setState({ statuses: { [MAIN]: snapshot({ version: 4 }) } });

    store().applyStatus(snapshot({ version: 4, entries: [fc('rejected.ts')] }));
    store().applyStatus(snapshot({ version: 3, entries: [fc('rejected.ts')] }));
    expect(store().statuses[MAIN]?.entries).toEqual([]);

    store().applyStatus(snapshot({ version: 5, entries: [fc('accepted.ts')] }));
    expect(store().statuses[MAIN]?.entries).toEqual([fc('accepted.ts')]);
  });
});

describe('applyStatus — 主仓 HEAD 投影（git_info.current_branch 的唯一写者）', () => {
  it('主仓单元快照更新 projects[i].git_info.current_branch，并同步 activeProject', () => {
    const project = createProject({ id: 'p1', git_info: gitInfo() });
    mod.useProjectStore.setState({
      projects: [project],
      activeProjectId: 'p1',
      activeProject: project,
    });

    store().applyStatus(snapshot({ version: 1, branch: 'feat' }));

    const state = mod.useProjectStore.getState();
    expect(state.projects[0]?.git_info?.current_branch).toBe('feat');
    // activeProject 与 projects 里的对象是同一个引用（不再各存一份镜像）
    expect(state.activeProject).toBe(state.projects[0]);
  });

  it('worktree 单元快照不得触碰 git_info.current_branch（分支只进自己槽位）', () => {
    const project = createProject({ id: 'p1', git_info: gitInfo() });
    mod.useProjectStore.setState({
      projects: [project],
      activeProjectId: 'p1',
      activeProject: project,
    });

    store().applyStatus(snapshot({ version: 1, worktree_path: '/wt/a', branch: 'wt-a' }));

    const state = mod.useProjectStore.getState();
    expect(state.projects[0]?.git_info?.current_branch).toBe('main');
    expect(state.activeProject).toBe(project);
    expect(store().statuses[WT_A]?.branch).toBe('wt-a');
  });

  it('主仓快照落在 worktree 激活期：写主仓槽位 + 投影主仓 HEAD，worktree 槽位原封不动', () => {
    // 用户正在看 /wt/a 的变更列表，此时后端推来主仓的新快照。
    // 旧实现在这里要么「丢弃主快照」（切回主视图拿到陈旧列表），要么「覆盖同一槽」
    // （列表串成主仓内容）。现在两者都不成立：定址写入。
    const project = createProject({ id: 'p1', git_info: gitInfo() });
    mod.useProjectStore.setState({
      projects: [project],
      activeProjectId: 'p1',
      activeProject: project,
    });
    store().applyStatus(
      snapshot({ version: 1, worktree_path: '/wt/a', branch: 'wt-a', entries: [fc('wt.ts')] }),
    );
    const wtSlotBefore = store().statuses[WT_A];

    store().applyStatus(snapshot({ version: 2, branch: 'main', entries: [fc('main-only.ts')] }));

    expect(store().statuses[MAIN]?.entries).toEqual([fc('main-only.ts')]);
    expect(store().statuses[WT_A]).toBe(wtSlotBefore);
    expect(store().statuses[WT_A]?.entries).toEqual([fc('wt.ts')]);
    // 视图渲染哪个槽位由「当前单元」决定，store 不感知激活视图
  });

  it('分支未变时不换项目对象引用（避免每次快照都重渲染项目卡片）', () => {
    const project = createProject({ id: 'p1', git_info: gitInfo() });
    mod.useProjectStore.setState({ projects: [project] });

    store().applyStatus(snapshot({ version: 1, branch: 'main', entries: [fc('a.ts')] }));

    expect(mod.useProjectStore.getState().projects[0]).toBe(project);
  });

  it('投影对别的项目无副作用', () => {
    mod.useProjectStore.setState({
      projects: [
        createProject({ id: 'p1', git_info: gitInfo() }),
        createProject({ id: 'p2', git_info: gitInfo({ current_branch: 'trunk' }) }),
      ],
    });

    store().applyStatus(snapshot({ version: 1, project_id: 'p1', branch: 'dev' }));

    const state = mod.useProjectStore.getState();
    expect(state.projects[0]?.git_info?.current_branch).toBe('dev');
    expect(state.projects[1]?.git_info?.current_branch).toBe('trunk');
  });

  it('非 git 项目（git_info === null）不会被快照凭空造出元数据', () => {
    // 旧 applyGitStatus 有「兜底创建零值 git_info」分支；快照携带的分支名不足以证明
    // 这个项目是 git 仓库，故该特例删除 —— 元数据的写入者是 bootstrap / refreshGitInfo。
    mod.useProjectStore.setState({ projects: [createProject({ id: 'p1', git_info: null })] });

    store().applyStatus(snapshot({ version: 1, branch: 'dev', entries: [fc('a.ts')] }));

    const state = mod.useProjectStore.getState();
    expect(state.projects[0]?.git_info).toBeNull();
    expect(state.statuses[MAIN]?.entries).toEqual([fc('a.ts')]);
  });

  /**
   * 现状固定（**不是**期望行为）：后端 `get_current_branch` 在 `git rev-parse` 失败时
   * 回空串，而投影是无条件的 —— 一次瞬时失败就会把项目卡片的分支名清空。
   * 旧 `applyGitStatus` 有「空串不覆盖」守卫，本次迁移时未在新写入口中复活。
   * 已作为疑似回归上报；若修回守卫，本用例应改成断言 'main' 保留。
   */
  it('空串分支目前也会被投影（清空卡片分支）—— 已上报的回归风险，非期望语义', () => {
    mod.useProjectStore.setState({
      projects: [createProject({ id: 'p1', git_info: gitInfo({ current_branch: 'main' }) })],
    });

    store().applyStatus(snapshot({ version: 1, branch: '' }));

    expect(mod.useProjectStore.getState().projects[0]?.git_info?.current_branch).toBe('');
  });
});

describe('invalidateStatus — 作废 = 未知，而不是「干净」', () => {
  it('删除该单元的槽位：selectEntries 返回 undefined（消费端须渲染空/加载态）', () => {
    store().applyStatus(snapshot({ version: 3, entries: [fc('a.ts')] }));
    const withEntries = mod.useProjectStore.getState();
    expect(mod.selectEntries(withEntries, MAIN)).toEqual([fc('a.ts')]);

    store().invalidateStatus(MAIN);

    const after = mod.useProjectStore.getState();
    expect(mod.selectEntries(after, MAIN)).toBeUndefined();
    expect(after.statuses[MAIN]).toBeUndefined();
    // 「未知」不得被读成「无变更」
    expect(after.statuses).toEqual({});
  });

  it('只影响目标单元：作废主仓不带走 worktree 槽位', () => {
    store().applyStatus(snapshot({ version: 1, entries: [fc('main.ts')] }));
    store().applyStatus(snapshot({ version: 1, worktree_path: '/wt/a', entries: [fc('wt.ts')] }));

    store().invalidateStatus(MAIN);

    expect(store().statuses[MAIN]).toBeUndefined();
    expect(store().statuses[WT_A]?.entries).toEqual([fc('wt.ts')]);
  });

  it('作废不存在的单元是 no-op（不换 state 引用，避免无谓重渲染）', () => {
    store().applyStatus(snapshot({ version: 1 }));
    const before = mod.useProjectStore.getState();

    store().invalidateStatus(WT_B);

    expect(mod.useProjectStore.getState()).toBe(before);
  });

  it('作废后任意版本可重新入槽（门控只看「有无前值」）', () => {
    store().applyStatus(snapshot({ version: 8, entries: [fc('old.ts')] }));
    store().invalidateStatus(MAIN);

    // 同一 worker 重启后 version 从头计数 —— 不得因为「曾经见过 v8」而丢弃 v1
    store().applyStatus(snapshot({ version: 1, entries: [fc('fresh.ts')] }));

    expect(store().statuses[MAIN]?.entries).toEqual([fc('fresh.ts')]);
  });
});

describe('selectors — 消费端唯一读取口', () => {
  it('selectStatus / selectEntries / selectBranch 一律按单元读取', () => {
    store().applyStatus(snapshot({ version: 1, branch: 'main', entries: [fc('m.ts')] }));
    store().applyStatus(
      snapshot({ version: 1, worktree_path: '/wt/a', branch: 'wt-a', entries: [] }),
    );
    const state = mod.useProjectStore.getState();

    expect(mod.selectStatus(state, MAIN)?.branch).toBe('main');
    expect(mod.selectBranch(state, WT_A)).toBe('wt-a');
    // 空数组 = 「确实干净」（与 undefined = 未知 严格区分）
    expect(mod.selectEntries(state, WT_A)).toEqual([]);
    expect(mod.selectEntries(state, WT_B)).toBeUndefined();
    expect(mod.selectBranch(state, WT_B)).toBe('');
  });

  it('selectHasStatus 区分「未知」与「已知且干净」', () => {
    store().applyStatus(snapshot({ version: 1, branch: 'main', entries: [fc('m.ts')] }));
    store().applyStatus(
      snapshot({ version: 1, worktree_path: '/wt/a', branch: 'wt-a', entries: [] }),
    );
    const state = mod.useProjectStore.getState();

    expect(mod.selectHasStatus(state, MAIN)).toBe(true);
    // 空数组 = 已知且干净 ⇒ 仍是「有状态」（与无效单元的「未知」严格区分）
    expect(mod.selectHasStatus(state, WT_A)).toBe(true);
    expect(mod.selectHasStatus(state, WT_B)).toBe(false);
  });
});
