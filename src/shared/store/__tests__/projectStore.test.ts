// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileChange, GitInfo } from '@/shared/types';
import { createProject } from '@/testing/factories';

import type * as projectStoreModule from '../projectStore';

/**
 * G2 D4 version gate 单测。
 * 版本登记表落在 store state（`statusVersionByProject`）——每个用例经 vi.resetModules +
 * 动态 import 获得全新 store 实例，保证用例互不依赖、不共享登记状态。
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

const gitInfo: GitInfo = {
  current_branch: 'main',
  branches: ['main'],
  worktrees: [],
  changed_files: [],
  is_clean: true,
  git_provider: '',
};

describe('versionGateAccepts — G2 D4 单调 version 门控', () => {
  let accepts: typeof projectStoreModule.versionGateAccepts;

  beforeEach(async () => {
    accepts = (await freshModule()).versionGateAccepts;
  });

  it('version <= 0（WSL/SSH/worktree 兜底）恒放行且不登记版本', () => {
    expect(accepts('p1', 0)).toBe(true);
    expect(accepts('p1', -1)).toBe(true);
    // 0 版本未登记 → 之后的首个正版本不受影响
    expect(accepts('p1', 1)).toBe(true);
  });

  it('首个正版本放行；旧版本（乱序/回退）一律拒绝', () => {
    expect(accepts('p1', 3)).toBe(true);
    expect(accepts('p1', 2)).toBe(false);
    expect(accepts('p1', 1)).toBe(false);
  });

  it('同版本重复投递默认拒绝（防跨源重复覆盖）', () => {
    expect(accepts('p1', 5)).toBe(true);
    expect(accepts('p1', 5)).toBe(false);
  });

  it('allowEqual=true 放行同版本（worktree 激活期跳过快照后切回主视图的幂等恢复）', () => {
    expect(accepts('p1', 5)).toBe(true);
    expect(accepts('p1', 5, true)).toBe(true);
    // 幂等放行不推进版本，默认门继续拒绝同版本
    expect(accepts('p1', 5)).toBe(false);
  });

  it('高版本放行后，后续低版本即使 allowEqual 也拒绝', () => {
    expect(accepts('p1', 7)).toBe(true);
    expect(accepts('p1', 6, true)).toBe(false);
  });

  it('项目间隔离：p1 的高版本不影响 p2 的低版本', () => {
    expect(accepts('p1', 10)).toBe(true);
    expect(accepts('p2', 1)).toBe(true);
  });

  it('已应用版本可被 UI 响应式读取（登记表在 store state，不是模块级 Map）', async () => {
    const mod = await freshModule();
    mod.useProjectStore.setState({ statusVersionByProject: {} });

    mod.versionGateAccepts('p1', 4);
    expect(mod.useProjectStore.getState().statusVersionByProject).toEqual({ p1: 4 });

    // version<=0（无版本语义）不入表 —— 消费端据此判定「无版本信号」
    mod.versionGateAccepts('p2', 0);
    expect(mod.useProjectStore.getState().statusVersionByProject).toEqual({ p1: 4 });

    // 被拒绝的旧版本不覆盖登记值
    expect(mod.versionGateAccepts('p1', 3)).toBe(false);
    expect(mod.useProjectStore.getState().statusVersionByProject.p1).toBe(4);
  });
});

describe('applyGitStatus — changed_files 唯一权威写入口', () => {
  let mod: typeof projectStoreModule;

  beforeEach(async () => {
    mod = await freshModule();
  });

  it('整体替换 changed_files 并同步 is_clean', () => {
    const project = createProject({ id: 'p1', git_info: { ...gitInfo } });
    mod.useProjectStore.setState({
      projects: [project],
      activeProjectId: 'p1',
      activeProject: project,
    });

    mod.useProjectStore.getState().applyGitStatus('p1', [fc('a.ts'), fc('b.ts')]);

    const info = mod.useProjectStore.getState().projects[0]!.git_info!;
    expect(info.changed_files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
    expect(info.is_clean).toBe(false);
  });

  it('空列表 → is_clean=true；activeProject 同步拿到新 git_info', () => {
    const project = createProject({
      id: 'p1',
      git_info: { ...gitInfo, changed_files: [fc('a.ts')], is_clean: false },
    });
    mod.useProjectStore.setState({
      projects: [project],
      activeProjectId: 'p1',
      activeProject: project,
    });

    mod.useProjectStore.getState().applyGitStatus('p1', []);

    const state = mod.useProjectStore.getState();
    expect(state.activeProject?.git_info?.changed_files).toEqual([]);
    expect(state.activeProject?.git_info?.is_clean).toBe(true);
  });

  it('快照携带非空分支时更新 current_branch；空串不覆盖（空仓库/非 repo 语义）', () => {
    const project = createProject({ id: 'p1', git_info: { ...gitInfo } });
    mod.useProjectStore.setState({ projects: [project] });

    mod.useProjectStore.getState().applyGitStatus('p1', [], 'feat');
    expect(mod.useProjectStore.getState().projects[0]!.git_info?.current_branch).toBe('feat');

    mod.useProjectStore.getState().applyGitStatus('p1', [], '');
    expect(mod.useProjectStore.getState().projects[0]!.git_info?.current_branch).toBe('feat');
  });

  it('git_info 为 null 时兜底创建零值 git_info（快照先于 bootstrap 到达）', () => {
    const project = createProject({ id: 'p1', git_info: null });
    mod.useProjectStore.setState({ projects: [project] });

    mod.useProjectStore.getState().applyGitStatus('p1', [fc('a.ts')], 'dev');

    const info = mod.useProjectStore.getState().projects[0]!.git_info!;
    expect(info.current_branch).toBe('dev');
    expect(info.changed_files.map((f) => f.path)).toEqual(['a.ts']);
    expect(info.is_clean).toBe(false);
  });

  it('未知项目 no-op', () => {
    mod.useProjectStore.setState({ projects: [createProject({ id: 'p1', git_info: null })] });

    mod.useProjectStore.getState().applyGitStatus('missing', [fc('a.ts')]);

    const project = mod.useProjectStore.getState().projects[0]!;
    expect(project.git_info).toBeNull();
  });
});
