import { describe, expect, it } from 'vitest';

import type { FileChange } from '@/shared/types';
import {
  addSummary,
  buildFileSummaryMap,
  buildFolderSummaryMap,
  collectCollapsedDirs,
  resolveDecoration,
  resolveNodeStatus,
  statusToNameColorClass,
  summaryToBadge,
  summaryToDotClass,
  summaryToLabelClass,
  zeroSummary,
} from '@/shared/utils/gitFileDecoration';
import type { GitStatusSummary } from '@/shared/utils/gitFileDecoration';

const fc = (
  path: string,
  status: FileChange['status'] = 'Modified',
  is_dir = false,
): FileChange => ({
  path,
  status,
  additions: 0,
  deletions: 0,
  is_dir,
});

/** 构造 summary 的便捷工厂：仅设置感兴趣的计数 */
function summary(partial: {
  added?: number;
  modified?: number;
  deleted?: number;
  renamed?: number;
  untracked?: number;
  conflict?: number;
}): GitStatusSummary {
  const base = zeroSummary();
  base.unstaged.added = partial.added ?? 0;
  base.unstaged.modified = partial.modified ?? 0;
  base.unstaged.deleted = partial.deleted ?? 0;
  base.renamed = partial.renamed ?? 0;
  base.untracked = partial.untracked ?? 0;
  base.conflict = partial.conflict ?? 0;
  return base;
}

describe('zeroSummary / addSummary', () => {
  it('zeroSummary 返回全零 summary', () => {
    expect(zeroSummary()).toEqual({
      staged: { added: 0, modified: 0, deleted: 0 },
      unstaged: { added: 0, modified: 0, deleted: 0 },
      renamed: 0,
      untracked: 0,
      conflict: 0,
    });
  });

  it('addSummary 逐桶相加（含 staged/conflict）', () => {
    const a = summary({ added: 1, modified: 2, untracked: 3 });
    const b = summary({ modified: 1, deleted: 4, conflict: 2 });
    const merged = addSummary(a, b);
    expect(merged.unstaged.added).toBe(1);
    expect(merged.unstaged.modified).toBe(3);
    expect(merged.unstaged.deleted).toBe(4);
    expect(merged.untracked).toBe(3);
    expect(merged.conflict).toBe(2);
    // staged 桶独立累加
    a.staged.added = 5;
    b.staged.modified = 1;
    const merged2 = addSummary(a, b);
    expect(merged2.staged.added).toBe(5);
    expect(merged2.staged.modified).toBe(1);
  });

  it('addSummary 不修改入参（纯函数）', () => {
    const a = summary({ added: 1 });
    const b = summary({ modified: 1 });
    const before = JSON.stringify(a);
    addSummary(a, b);
    expect(JSON.stringify(a)).toBe(before);
  });
});

describe('buildFileSummaryMap', () => {
  it('空输入返回空 map', () => {
    expect(buildFileSummaryMap([]).size).toBe(0);
  });

  it('单文件映射到 unstaged 桶（staged 恒 0）', () => {
    const map = buildFileSummaryMap([fc('a.ts', 'Modified')]);
    expect(map.get('a.ts')).toEqual(summary({ modified: 1 }));
    expect(map.get('a.ts')?.staged.modified).toBe(0);
  });

  it('各 status 确定性落入对应桶', () => {
    const map = buildFileSummaryMap([
      fc('added.ts', 'Added'),
      fc('modified.ts', 'Modified'),
      fc('renamed.ts', 'Renamed'),
      fc('deleted.ts', 'Deleted'),
      fc('untracked.ts', 'Untracked'),
    ]);
    expect(map.get('added.ts')?.unstaged.added).toBe(1);
    expect(map.get('modified.ts')?.unstaged.modified).toBe(1);
    // Renamed 独立计数（徽标字母必须保真显示 R，不折叠进 modified）
    expect(map.get('renamed.ts')?.renamed).toBe(1);
    expect(map.get('renamed.ts')?.unstaged.modified).toBe(0);
    expect(map.get('deleted.ts')?.unstaged.deleted).toBe(1);
    expect(map.get('untracked.ts')?.untracked).toBe(1);
  });

  it('同 path 多条目合并（monoid）', () => {
    const map = buildFileSummaryMap([fc('a.ts', 'Added'), fc('a.ts', 'Modified')]);
    expect(map.size).toBe(1);
    expect(map.get('a.ts')?.unstaged.added).toBe(1);
    expect(map.get('a.ts')?.unstaged.modified).toBe(1);
  });

  it('反斜杠路径归一化为正斜杠', () => {
    const map = buildFileSummaryMap([fc('src\\util\\a.ts', 'Added')]);
    expect(map.get('src/util/a.ts')).toBeDefined();
    expect(map.get('src\\util\\a.ts')).toBeUndefined();
  });
});

describe('buildFolderSummaryMap', () => {
  it('单文件：全部祖先目录（含根段）都携带摘要', () => {
    const fileMap = buildFileSummaryMap([fc('src/features/git/a.ts', 'Modified')]);
    const dirMap = buildFolderSummaryMap(fileMap);
    expect(dirMap.get('src')).toEqual(summary({ modified: 1 }));
    expect(dirMap.get('src/features')).toEqual(summary({ modified: 1 }));
    expect(dirMap.get('src/features/git')).toEqual(summary({ modified: 1 }));
  });

  it('未展开的深层祖先目录也携带摘要（基于 changed 全集）', () => {
    const fileMap = buildFileSummaryMap([fc('a/b/c/d.ts', 'Added')]);
    const dirMap = buildFolderSummaryMap(fileMap);
    expect(dirMap.get('a')).toEqual(summary({ added: 1 }));
    expect(dirMap.get('a/b')).toEqual(summary({ added: 1 }));
    expect(dirMap.get('a/b/c')).toEqual(summary({ added: 1 }));
    expect(dirMap.size).toBe(3);
  });

  it('deleted 文件不向目录传播', () => {
    const fileMap = buildFileSummaryMap([fc('src/gone.ts', 'Deleted')]);
    const dirMap = buildFolderSummaryMap(fileMap);
    expect(dirMap.get('src')).toBeUndefined();
    expect(dirMap.size).toBe(0);
  });

  it('多文件状态向同一祖先聚合', () => {
    const fileMap = buildFileSummaryMap([fc('src/a.ts', 'Modified'), fc('src/b.ts', 'Added')]);
    const dirMap = buildFolderSummaryMap(fileMap);
    const src = dirMap.get('src');
    expect(src?.unstaged.modified).toBe(1);
    expect(src?.unstaged.added).toBe(1);
  });

  it('多状态优先级由 summaryToBadge 决定（冲突最高）', () => {
    const fileMap = buildFileSummaryMap([
      fc('src/m.ts', 'Modified'),
      fc('src/u.ts', 'Untracked'),
      fc('src/a.ts', 'Added'),
    ]);
    const dirMap = buildFolderSummaryMap(fileMap);
    // 无 conflict/deleted：modified 优先
    expect(summaryToBadge(dirMap.get('src')!)).toMatchObject({ badge: 'M' });
  });
});

describe('summaryToBadge', () => {
  it('空 summary 返回 null', () => {
    expect(summaryToBadge(zeroSummary())).toBeNull();
  });

  it('优先级 conflict > deleted > modified > renamed > untracked > added', () => {
    const all = summary({
      conflict: 1,
      deleted: 1,
      modified: 1,
      renamed: 1,
      untracked: 1,
      added: 1,
    });
    expect(summaryToBadge(all)).toMatchObject({ badge: '!' });
    expect(summaryToBadge(summary({ deleted: 1, modified: 1 }))).toMatchObject({ badge: 'D' });
    expect(summaryToBadge(summary({ modified: 1, renamed: 1 }))).toMatchObject({ badge: 'M' });
    expect(summaryToBadge(summary({ renamed: 1, untracked: 1 }))).toMatchObject({ badge: 'R' });
    expect(summaryToBadge(summary({ untracked: 1, added: 1 }))).toMatchObject({ badge: 'U' });
    expect(summaryToBadge(summary({ added: 1 }))).toMatchObject({ badge: 'A' });
  });

  it('映射正确 variant（conflict 用 deleted 红色 variant，renamed 用灰色 variant）', () => {
    expect(summaryToBadge(summary({ conflict: 1 }))).toEqual({ badge: '!', variant: 'deleted' });
    expect(summaryToBadge(summary({ deleted: 1 }))).toEqual({ badge: 'D', variant: 'deleted' });
    expect(summaryToBadge(summary({ modified: 1 }))).toEqual({ badge: 'M', variant: 'modified' });
    expect(summaryToBadge(summary({ renamed: 1 }))).toEqual({ badge: 'R', variant: 'default' });
    expect(summaryToBadge(summary({ untracked: 1 }))).toEqual({ badge: 'U', variant: 'default' });
    expect(summaryToBadge(summary({ added: 1 }))).toEqual({ badge: 'A', variant: 'added' });
  });
});

describe('resolveDecoration — 折叠 untracked 目录的后代继承', () => {
  // Rust 侧不递归 untracked 目录：折叠为单条目录条目（G1：无尾斜杠 path + is_dir=true）
  const collapsed = [fc('.trellis/tasks/08-27-x', 'Untracked', true)];
  const cFileSummaries = buildFileSummaryMap(collapsed);
  const cCollapsedDirs = collectCollapsedDirs(collapsed);
  const cFolderSummaries = buildFolderSummaryMap(cFileSummaries, cCollapsedDirs);

  it('collectCollapsedDirs 仅收集目录条目且输出无尾斜杠路径并排序', () => {
    const files = [
      fc('b/inner', 'Untracked', true),
      fc('a.ts', 'Modified'),
      fc('.trellis/x', 'Untracked', true),
    ];
    expect(collectCollapsedDirs(files)).toEqual(['.trellis/x', 'b/inner']);
  });

  it('collectCollapsedDirs 兼容旧 payload（无 is_dir 的尾斜杠目录条目）', () => {
    // 旧 payload 不含 is_dir 字段（undefined），需走尾斜杠兜底 —— 字面量刻意不写 is_dir
    const legacy: FileChange[] = [
      { path: 'b/inner/', status: 'Untracked', additions: 0, deletions: 0 },
      { path: 'a.ts', status: 'Modified', additions: 0, deletions: 0 },
    ];
    expect(collectCollapsedDirs(legacy)).toEqual(['b/inner']);
  });

  it('折叠目录内的深层文件继承该目录的 untracked 色', () => {
    const deco = resolveDecoration(
      '.trellis/tasks/08-27-x/prd.md',
      false,
      cFileSummaries,
      cFolderSummaries,
      undefined,
      false,
      cCollapsedDirs,
    );
    expect(deco?.color).toBe('text-accent-brick');
  });

  it('中间层目录已有 folder 聚合色时语义不变', () => {
    const deco = resolveDecoration(
      '.trellis/tasks',
      true,
      cFileSummaries,
      cFolderSummaries,
      undefined,
      false,
      cCollapsedDirs,
    );
    expect(deco?.color).toBe('text-accent-brick');
  });

  it('非后代路径不受折叠条目影响', () => {
    expect(
      resolveDecoration(
        '.other/file.txt',
        false,
        cFileSummaries,
        cFolderSummaries,
        undefined,
        false,
        cCollapsedDirs,
      ),
    ).toBeNull();
  });

  it('兄弟前缀相近的路径不误匹配（须以条目+分隔符为界）', () => {
    const two = [fc('ab', 'Untracked', true)];
    const dirs = collectCollapsedDirs(two);
    const fileSummaries = buildFileSummaryMap(two);
    const folderSummaries = buildFolderSummaryMap(fileSummaries, dirs);
    expect(
      resolveDecoration('abc/f.txt', false, fileSummaries, folderSummaries, undefined, false, dirs),
    ).toBeNull();
    expect(
      resolveDecoration('ab/c.txt', false, fileSummaries, folderSummaries, undefined, false, dirs)
        ?.color,
    ).toBe('text-accent-brick');
  });
});

describe('summaryToLabelClass', () => {
  it('active 最高优先（accent）', () => {
    expect(summaryToLabelClass(summary({ conflict: 1 }), false, true)).toBe('text-accent');
  });

  it('优先级 conflict > deleted > modified > untracked > added', () => {
    expect(summaryToLabelClass(summary({ conflict: 1, deleted: 1 }), false, false)).toBe(
      'text-accent-red',
    );
    expect(summaryToLabelClass(summary({ deleted: 1 }), false, false)).toBe('text-accent-orange');
    expect(summaryToLabelClass(summary({ modified: 1 }), false, false)).toBe('text-accent-blue');
    expect(summaryToLabelClass(summary({ untracked: 1 }), false, false)).toBe('text-accent-brick');
    expect(summaryToLabelClass(summary({ added: 1 }), false, false)).toBe('text-accent-green');
  });

  it('无状态时 ignored → dimmed 灰，否则默认', () => {
    expect(summaryToLabelClass(zeroSummary(), true, false)).toBe('text-text-muted');
    expect(summaryToLabelClass(zeroSummary(), false, false)).toBe('text-text-primary');
  });

  it('ignored 与变更共存时 git 状态优先（不灰化）', () => {
    expect(summaryToLabelClass(summary({ modified: 1 }), true, false)).toBe('text-accent-blue');
  });
});

describe('summaryToDotClass', () => {
  it('各状态映射到 bg-accent-*', () => {
    expect(summaryToDotClass(summary({ conflict: 1 }))).toBe('bg-accent-red');
    expect(summaryToDotClass(summary({ deleted: 1 }))).toBe('bg-accent-orange');
    expect(summaryToDotClass(summary({ modified: 1 }))).toBe('bg-accent-blue');
    expect(summaryToDotClass(summary({ renamed: 1 }))).toBe('bg-accent-blue');
    expect(summaryToDotClass(summary({ untracked: 1 }))).toBe('bg-accent-brick');
    expect(summaryToDotClass(summary({ added: 1 }))).toBe('bg-accent-green');
    expect(summaryToDotClass(zeroSummary())).toBe('');
  });
});

describe('resolveDecoration', () => {
  const buildMaps = (files: FileChange[]) => {
    const fileSummaries = buildFileSummaryMap(files);
    const folderSummaries = buildFolderSummaryMap(fileSummaries);
    return { fileSummaries, folderSummaries };
  };

  it('无变更文件返回 null', () => {
    const { fileSummaries, folderSummaries } = buildMaps([]);
    expect(
      resolveDecoration('src/a.ts', false, fileSummaries, folderSummaries, undefined, false),
    ).toBeNull();
  });

  it('变更文件返回全量展示（color/badge/variant/dot）', () => {
    const { fileSummaries, folderSummaries } = buildMaps([fc('src/a.ts', 'Modified')]);
    expect(
      resolveDecoration('src/a.ts', false, fileSummaries, folderSummaries, undefined, false),
    ).toEqual({
      color: 'text-accent-blue',
      badge: 'M',
      variant: 'modified',
      dot: 'bg-accent-blue',
      dimmed: false,
    });
  });

  it('目录取文件夹摘要返回全量展示', () => {
    const { fileSummaries, folderSummaries } = buildMaps([fc('src/a.ts', 'Added')]);
    expect(
      resolveDecoration('src', true, fileSummaries, folderSummaries, undefined, false),
    ).toEqual({
      color: 'text-accent-green',
      badge: 'A',
      variant: 'added',
      dot: 'bg-accent-green',
      dimmed: false,
    });
  });

  it('renamed 文件保真产出 R 徽标与蓝色文字', () => {
    const { fileSummaries, folderSummaries } = buildMaps([fc('src/a.ts', 'Renamed')]);
    expect(
      resolveDecoration('src/a.ts', false, fileSummaries, folderSummaries, undefined, false),
    ).toMatchObject({ color: 'text-accent-blue', badge: 'R', variant: 'default' });
  });

  it('被忽略文件返回 dimmed', () => {
    const { fileSummaries, folderSummaries } = buildMaps([]);
    const ignored = new Set(['dist']);
    expect(
      resolveDecoration('dist/bundle.js', false, fileSummaries, folderSummaries, ignored, false),
    ).toEqual({ color: 'text-text-muted', dimmed: true });
  });

  it('忽略祖先上行匹配：深层文件位于被剪枝忽略目录内仍 dimmed', () => {
    const { fileSummaries, folderSummaries } = buildMaps([]);
    // 只有顶层忽略目录在集合内（子树被剪枝，深层后代不在集合）
    const ignored = new Set(['node_modules']);
    expect(
      resolveDecoration(
        'node_modules/pkg/deep/index.js',
        false,
        fileSummaries,
        folderSummaries,
        ignored,
        false,
      ),
    ).toEqual({ color: 'text-text-muted', dimmed: true });
  });

  it('忽略目录自身也 dimmed', () => {
    const { fileSummaries, folderSummaries } = buildMaps([]);
    const ignored = new Set(['node_modules']);
    expect(
      resolveDecoration('node_modules', true, fileSummaries, folderSummaries, ignored, false),
    ).toEqual({ color: 'text-text-muted', dimmed: true });
  });

  it('ignored 与变更共存：git 状态优先，不灰化', () => {
    const { fileSummaries, folderSummaries } = buildMaps([fc('dist/bundle.js', 'Added')]);
    const ignored = new Set(['dist']);
    const deco = resolveDecoration(
      'dist/bundle.js',
      false,
      fileSummaries,
      folderSummaries,
      ignored,
      false,
    );
    expect(deco).toMatchObject({ color: 'text-accent-green', badge: 'A', dimmed: false });
  });

  it('active 文件返回 accent 色', () => {
    const { fileSummaries, folderSummaries } = buildMaps([fc('src/a.ts', 'Modified')]);
    expect(
      resolveDecoration('src/a.ts', false, fileSummaries, folderSummaries, undefined, true),
    ).toEqual({
      color: 'text-accent',
      badge: 'M',
      variant: 'modified',
      dot: 'bg-accent-blue',
      dimmed: false,
    });
  });

  it('被忽略的激活文件保持 accent 高亮（激活优先）', () => {
    const { fileSummaries, folderSummaries } = buildMaps([]);
    const ignored = new Set(['.env']);
    expect(resolveDecoration('.env', false, fileSummaries, folderSummaries, ignored, true)).toEqual(
      { color: 'text-accent', dimmed: true },
    );
  });
});

describe('resolveNodeStatus — 语义状态判定（S3 状态入模的组装期 join 核心）', () => {
  const buildInputs = (files: FileChange[], ignored?: string[]) => {
    const fileSummaries = buildFileSummaryMap(files);
    const collapsedDirs = collectCollapsedDirs(files);
    const folderSummaries = buildFolderSummaryMap(fileSummaries, collapsedDirs);
    return {
      fileSummaries,
      folderSummaries,
      collapsedDirs,
      ignoredSet: ignored ? new Set(ignored) : undefined,
    };
  };

  it('文件精确命中：返回自身主导状态，ignored 为原始事实', () => {
    const inputs = buildInputs([fc('src/a.ts', 'Modified')], ['src/a.ts']);
    expect(resolveNodeStatus('src/a.ts', false, inputs)).toEqual({
      status: 'modified',
      ignored: true,
    });
  });

  it('目录取聚合主导状态（含未展开深层祖先）', () => {
    const inputs = buildInputs([fc('a/b/c/d.ts', 'Added')]);
    expect(resolveNodeStatus('a/b', true, inputs)).toEqual({ status: 'added', ignored: false });
  });

  it('目录聚合优先级：conflict > deleted > modified > renamed > untracked > added', () => {
    const inputs = buildInputs([fc('src/m.ts', 'Modified'), fc('src/u.ts', 'Untracked')]);
    expect(resolveNodeStatus('src', true, inputs)?.status).toBe('modified');
  });

  it('折叠 untracked 目录的后代继承目录态色（与 resolveDecoration parity）', () => {
    const inputs = buildInputs([fc('.trellis/tasks/08-27-x', 'Untracked', true)]);
    expect(resolveNodeStatus('.trellis/tasks/08-27-x/prd.md', false, inputs)).toEqual({
      status: 'untracked',
      ignored: false,
    });
  });

  it('ignored 祖先上行匹配：深层文件位于被剪枝忽略目录内仍 ignored', () => {
    const inputs = buildInputs([], ['node_modules']);
    expect(resolveNodeStatus('node_modules/pkg/deep/index.js', false, inputs)).toEqual({
      status: null,
      ignored: true,
    });
  });

  it('无状态且未忽略：status null / ignored false', () => {
    const inputs = buildInputs([fc('other.ts', 'Modified')]);
    expect(resolveNodeStatus('plain.txt', false, inputs)).toEqual({
      status: null,
      ignored: false,
    });
  });

  it('与 resolveDecoration 语义 parity：同一输入集逐路径对照', () => {
    const files = [
      fc('src/a.ts', 'Modified'),
      fc('src/inner/b.ts', 'Added'),
      fc('dist/.env', 'Untracked'),
      fc('coll', 'Untracked', true),
    ];
    const ignored = ['node_modules'];
    const inputs = buildInputs(files, ignored);
    const paths: Array<[string, boolean]> = [
      ['src/a.ts', false],
      ['src/inner/b.ts', false],
      ['src', true],
      ['src/inner', true],
      ['dist/.env', false],
      ['dist', true],
      ['coll/deep.txt', false],
      ['node_modules/x.js', false],
      ['plain.txt', false],
    ];
    for (const [path, isDir] of paths) {
      const deco = resolveDecoration(
        path,
        isDir,
        inputs.fileSummaries,
        inputs.folderSummaries,
        inputs.ignoredSet,
        false,
        inputs.collapsedDirs,
      );
      const semantic = resolveNodeStatus(path, isDir, inputs);
      if (semantic.status !== null) {
        // 有状态：dimmed 恒 false，色由主导状态决定
        expect(deco?.dimmed).toBe(false);
        expect(deco?.color).toBe(statusToNameColorClass(semantic.status, semantic.ignored, false));
      } else if (semantic.ignored) {
        expect(deco).toMatchObject({ color: 'text-text-muted', dimmed: true });
      } else {
        expect(deco).toBeNull();
      }
    }
  });
});

describe('statusToNameColorClass — 叶子级名字色（优先级链单处收敛）', () => {
  it('active 最高优先（accent），即使有状态或 ignored', () => {
    expect(statusToNameColorClass('conflict', true, true)).toBe('text-accent');
    expect(statusToNameColorClass(undefined, true, true)).toBe('text-accent');
  });

  it('状态优先于 ignored（共存不灰化）', () => {
    expect(statusToNameColorClass('modified', true, false)).toBe('text-accent-blue');
    expect(statusToNameColorClass('untracked', true, false)).toBe('text-accent-brick');
  });

  it('各状态映射 JetBrains 词表色', () => {
    expect(statusToNameColorClass('conflict', false, false)).toBe('text-accent-red');
    expect(statusToNameColorClass('deleted', false, false)).toBe('text-accent-orange');
    expect(statusToNameColorClass('modified', false, false)).toBe('text-accent-blue');
    expect(statusToNameColorClass('renamed', false, false)).toBe('text-accent-blue');
    expect(statusToNameColorClass('untracked', false, false)).toBe('text-accent-brick');
    expect(statusToNameColorClass('added', false, false)).toBe('text-accent-green');
  });

  it('无状态：ignored 灰显，否则默认色', () => {
    expect(statusToNameColorClass(undefined, true, false)).toBe('text-text-muted');
    expect(statusToNameColorClass(null, false, false)).toBe('text-text-primary');
  });
});

describe('fileChangeToSummary（经 buildFileSummaryMap）— G6 XY 契约分桶', () => {
  const fxy = (
    path: string,
    status: FileChange['status'],
    xy?: { x?: string; y?: string },
  ): FileChange => ({
    path,
    status,
    additions: 0,
    deletions: 0,
    ...(xy?.x !== undefined ? { index_status: xy.x } : {}),
    ...(xy?.y !== undefined ? { worktree_status: xy.y } : {}),
  });

  it('X 侧计数进 staged 桶（staged 桶自此转真）', () => {
    const map = buildFileSummaryMap([fxy('a.txt', 'Added', { x: 'A', y: ' ' })]);
    expect(map.get('a.txt')?.staged.added).toBe(1);
    expect(map.get('a.txt')?.unstaged.added).toBe(0);
  });

  it('XY 双侧同现：staged + unstaged 同时计数（README 场景）', () => {
    const map = buildFileSummaryMap([fxy('r.md', 'Modified', { x: 'M', y: 'M' })]);
    expect(map.get('r.md')?.staged.modified).toBe(1);
    expect(map.get('r.md')?.unstaged.modified).toBe(1);
  });

  it('unversioned 与 conflict 桶转真', () => {
    const map = buildFileSummaryMap([
      fxy('new.ts', 'Untracked', { x: '?', y: '?' }),
      fxy('c.txt', 'Modified', { x: 'U', y: 'U' }),
    ]);
    expect(map.get('new.ts')?.untracked).toBe(1);
    expect(map.get('c.txt')?.conflict).toBe(1);
  });

  it('缺 XY 回退单 status 映射（旧 payload 不炸）', () => {
    const map = buildFileSummaryMap([fc('m.ts', 'Modified')]);
    expect(map.get('m.ts')?.unstaged.modified).toBe(1);
    expect(map.get('m.ts')?.staged.modified).toBe(0);
  });
});
