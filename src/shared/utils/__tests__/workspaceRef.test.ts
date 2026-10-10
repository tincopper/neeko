import { describe, expect, it } from 'vitest';

import {
  WorkspaceSession,
  WORKSPACE_KEY_SEP,
  isMainCheckout,
  workspaceKeyLabel,
  workspaceRootOf,
} from '../workspaceRef';

/**
 * `WorkspaceSession` 的 key 投影（golden / 归一 / 去重）与同模块派生工具。
 * `workspaceKeyOf` / `parseWorkspaceKey` 已退役 —— 键经 `session.key`、反解经
 * `WorkspaceSession.fromKey` / `fromKeyOrId`（唯一 codec）。
 */
describe('WorkspaceSession.key（≡ Rust WorkspaceRef::key()）', () => {
  /**
   * golden：与 Rust 侧 `src-tauri/src/common/git/workspace_ref.rs::tests::golden_key_format_matches_frontend_contract`
   * 逐字对齐。任何一侧改形态都必须同时改另一侧 —— 这是双端共用一个身份的证明点。
   */
  it('matches the backend golden contract', () => {
    expect(WorkspaceSession.of('proj-1', null).key).toBe('proj-1\0');
    expect(WorkspaceSession.of('proj-1', '/srv/app/.worktrees/dev').key).toBe(
      'proj-1\0/srv/app/.worktrees/dev',
    );
  });

  it('treats empty and whitespace worktree paths as the main checkout', () => {
    const main = WorkspaceSession.of('p1', null).key;
    expect(WorkspaceSession.of('p1', '').key).toBe(main);
    expect(WorkspaceSession.of('p1', '   ').key).toBe(main);
  });

  it('gives distinct keys to distinct worktrees of the same project', () => {
    const a = WorkspaceSession.of('p1', '/wt/a').key;
    const b = WorkspaceSession.of('p1', '/wt/b').key;
    const main = WorkspaceSession.of('p1', null).key;
    expect(new Set([a, b, main]).size).toBe(3);
  });

  it('never collides across projects even with identical worktree paths', () => {
    expect(WorkspaceSession.of('p1', '/wt/a').key).not.toBe(WorkspaceSession.of('p2', '/wt/a').key);
  });
});

describe('WorkspaceSession.fromKey / fromKeyOrId（反解 codec）', () => {
  it('round-trips both variants', () => {
    expect(WorkspaceSession.fromKey(WorkspaceSession.of('p1', null).key)).toMatchObject({
      projectId: 'p1',
      worktreePath: null,
    });
    expect(WorkspaceSession.fromKey(WorkspaceSession.of('p1', '/wt/a').key)).toMatchObject({
      projectId: 'p1',
      worktreePath: '/wt/a',
    });
  });

  it('is unambiguous for paths that contain the legacy ":" separator', () => {
    // 旧式 `${projectId}:wt:${path}` 拼法在路径含 `:wt:` 时会歧义；NUL 不可能出现在合法路径里
    const tricky = '/srv/x:wt:y';
    expect(WorkspaceSession.fromKey(WorkspaceSession.of('p1', tricky).key)).toMatchObject({
      projectId: 'p1',
      worktreePath: tricky,
    });
  });

  it('fromKey 对无分隔符返回 null；fromKeyOrId 宽容按主仓处理（旧形态载荷）', () => {
    expect(WorkspaceSession.fromKey('p1')).toBeNull();
    expect(WorkspaceSession.fromKeyOrId('p1')).toMatchObject({
      projectId: 'p1',
      worktreePath: null,
    });
  });
});

describe('isMainCheckout', () => {
  it('接受 WorkspaceSession 值形态：worktreePath=null 即主仓（唯一判别）', () => {
    expect(isMainCheckout(WorkspaceSession.of('p1', null))).toBe(true);
    expect(isMainCheckout(WorkspaceSession.of('p1', '/wt/a'))).toBe(false);
  });
  it('only the empty tail is main（key 形态）', () => {
    expect(isMainCheckout(`p1${WORKSPACE_KEY_SEP}`)).toBe(true);
    expect(isMainCheckout(WorkspaceSession.of('p1', '/wt/a').key)).toBe(false);
  });
});

describe('workspaceKeyLabel — 日志/提示用的可读标签', () => {
  it('主仓单元与 worktree 单元各有可读形态', () => {
    expect(workspaceKeyLabel(WorkspaceSession.of('p1', null).key)).toBe('p1 (main)');
    expect(workspaceKeyLabel(WorkspaceSession.of('p1', '/wt/a').key)).toBe('p1 → /wt/a');
  });

  it('绝不把 NUL 分隔符带出去（带进日志会让日志文件被判成二进制）', () => {
    expect(workspaceKeyLabel(WorkspaceSession.of('p1', '/wt/a').key)).not.toContain(
      WORKSPACE_KEY_SEP,
    );
    expect(workspaceKeyLabel(WorkspaceSession.of('p1', null).key)).not.toContain(WORKSPACE_KEY_SEP);
  });
});

describe('workspaceRootOf — 单元相对路径的基准', () => {
  /**
   * 该基准就是 Rust `WorkspaceRef::work_dir()` 的前端对偶：watcher 的 `paths` / status 条目的 path
   * 都相对它。基准取错（例如一律用项目根）会让同文件判定落到**主仓的另一个同名文件**上 ——
   * 绝不命中，且不报错。
   */
  it('主仓单元回落到项目登记路径', () => {
    expect(workspaceRootOf(WorkspaceSession.of('p1', null).key, '/repo')).toBe('/repo');
    expect(workspaceRootOf(WorkspaceSession.of('p1', '').key, '/repo')).toBe('/repo');
  });

  it('linked worktree 单元用后端回传的 canonical 路径（不管项目根是什么）', () => {
    expect(workspaceRootOf(WorkspaceSession.of('p1', '/repo-wt').key, '/repo')).toBe('/repo-wt');
  });

  it('同一项目的两个单元基准不同（相对路径同形不同义的结构原因）', () => {
    expect(workspaceRootOf(WorkspaceSession.of('p1', null).key, '/repo')).not.toBe(
      workspaceRootOf(WorkspaceSession.of('p1', '/repo-wt').key, '/repo'),
    );
  });
});
