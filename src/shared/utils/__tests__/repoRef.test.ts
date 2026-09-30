import { describe, expect, it } from 'vitest';

import {
  REPO_KEY_SEP,
  isMainUnit,
  parseRepoKey,
  repoKeyLabel,
  repoKeyOf,
  unitWorkDir,
} from '../repoRef';

describe('repoKeyOf', () => {
  /**
   * golden：与 Rust 侧 `src-tauri/src/common/git/repo_ref.rs::tests::golden_key_format_matches_frontend_contract`
   * 逐字对齐。任何一侧改形态都必须同时改另一侧 —— 这是双端共用一个身份的证明点。
   */
  it('matches the backend golden contract', () => {
    expect(repoKeyOf('proj-1')).toBe('proj-1\0');
    expect(repoKeyOf('proj-1', '/srv/app/.worktrees/dev')).toBe('proj-1\0/srv/app/.worktrees/dev');
  });

  it('treats empty and whitespace worktree paths as the main unit', () => {
    expect(repoKeyOf('p1', '')).toBe(repoKeyOf('p1'));
    expect(repoKeyOf('p1', '   ')).toBe(repoKeyOf('p1'));
    expect(repoKeyOf('p1', null)).toBe(repoKeyOf('p1'));
    expect(repoKeyOf('p1', undefined)).toBe(repoKeyOf('p1'));
  });

  it('gives distinct keys to distinct worktrees of the same project', () => {
    const a = repoKeyOf('p1', '/wt/a');
    const b = repoKeyOf('p1', '/wt/b');
    const main = repoKeyOf('p1');
    expect(new Set([a, b, main]).size).toBe(3);
  });

  it('never collides across projects even with identical worktree paths', () => {
    expect(repoKeyOf('p1', '/wt/a')).not.toBe(repoKeyOf('p2', '/wt/a'));
  });
});

describe('parseRepoKey', () => {
  it('round-trips both variants', () => {
    expect(parseRepoKey(repoKeyOf('p1'))).toEqual({ projectId: 'p1', worktreePath: null });
    expect(parseRepoKey(repoKeyOf('p1', '/wt/a'))).toEqual({
      projectId: 'p1',
      worktreePath: '/wt/a',
    });
  });

  it('is unambiguous for paths that contain the legacy ":" separator', () => {
    // 旧式 `${projectId}:wt:${path}` 拼法在路径含 `:wt:` 时会歧义；NUL 不可能出现在合法路径里
    const tricky = '/srv/x:wt:y';
    expect(parseRepoKey(repoKeyOf('p1', tricky))).toEqual({
      projectId: 'p1',
      worktreePath: tricky,
    });
  });

  it('tolerates a key without separator (defensive: legacy payload)', () => {
    expect(parseRepoKey('p1')).toEqual({ projectId: 'p1', worktreePath: null });
  });
});

describe('isMainUnit', () => {
  it('only the empty tail is main', () => {
    expect(isMainUnit(`p1${REPO_KEY_SEP}`)).toBe(true);
    expect(isMainUnit(repoKeyOf('p1', '/wt/a'))).toBe(false);
  });
});

describe('repoKeyLabel — 日志/提示用的可读标签', () => {
  it('主仓单元与 worktree 单元各有可读形态', () => {
    expect(repoKeyLabel(repoKeyOf('p1'))).toBe('p1 (main)');
    expect(repoKeyLabel(repoKeyOf('p1', '/wt/a'))).toBe('p1 → /wt/a');
  });

  it('绝不把 NUL 分隔符带出去（带进日志会让日志文件被判成二进制）', () => {
    expect(repoKeyLabel(repoKeyOf('p1', '/wt/a'))).not.toContain(REPO_KEY_SEP);
    expect(repoKeyLabel(repoKeyOf('p1'))).not.toContain(REPO_KEY_SEP);
  });
});

describe('unitWorkDir — 单元相对路径的基准', () => {
  /**
   * 该基准就是 Rust `RepoRef::work_dir()` 的前端对偶：watcher 的 `paths` / status 条目的 path
   * 都相对它。基准取错（例如一律用项目根）会让同文件判定落到**主仓的另一个同名文件**上 ——
   * 绝不命中，且不报错。
   */
  it('主仓单元回落到项目登记路径', () => {
    expect(unitWorkDir(repoKeyOf('p1'), '/repo')).toBe('/repo');
    expect(unitWorkDir(repoKeyOf('p1', ''), '/repo')).toBe('/repo');
  });

  it('linked worktree 单元用后端回传的 canonical 路径（不管项目根是什么）', () => {
    expect(unitWorkDir(repoKeyOf('p1', '/repo-wt'), '/repo')).toBe('/repo-wt');
  });

  it('同一项目的两个单元基准不同（相对路径同形不同义的结构原因）', () => {
    expect(unitWorkDir(repoKeyOf('p1'), '/repo')).not.toBe(
      unitWorkDir(repoKeyOf('p1', '/repo-wt'), '/repo'),
    );
  });
});
