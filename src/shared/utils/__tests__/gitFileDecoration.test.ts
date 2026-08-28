import { describe, expect, it } from 'vitest';

import type { FileChange } from '@/shared/types';
import {
  addSummary,
  buildFileSummaryMap,
  buildFolderSummaryMap,
  collectCollapsedDirs,
  createDecorationResolver,
  getSharedDecorationResolver,
  resolveDecoration,
  summaryToBadge,
  summaryToDotClass,
  summaryToLabelClass,
  zeroSummary,
} from '@/shared/utils/gitFileDecoration';
import type { GitStatusSummary } from '@/shared/utils/gitFileDecoration';

const fc = (path: string, status: FileChange['status'] = 'Modified'): FileChange => ({
  path,
  status,
  additions: 0,
  deletions: 0,
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
  // Rust 侧不递归 untracked 目录：折叠为单条目录条目（尾斜杠），其下子路径不在变更列表内
  const collapsed = [fc('.trellis/tasks/08-27-x/', 'Untracked')];
  const cFileSummaries = buildFileSummaryMap(collapsed);
  const cFolderSummaries = buildFolderSummaryMap(cFileSummaries);
  const cCollapsedDirs = collectCollapsedDirs(collapsed);

  it('collectCollapsedDirs 仅收集目录条目且排序', () => {
    const files = [
      fc('b/inner/', 'Untracked'),
      fc('a.ts', 'Modified'),
      fc('.trellis/x/', 'Untracked'),
    ];
    expect(collectCollapsedDirs(files)).toEqual(['.trellis/x/', 'b/inner/']);
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
    const two = [fc('ab/', 'Untracked')];
    const dirs = collectCollapsedDirs(two);
    const fileSummaries = buildFileSummaryMap(two);
    const folderSummaries = buildFolderSummaryMap(fileSummaries);
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

describe('createDecorationResolver 实例复用缓存', () => {
  const buildMaps = (files: FileChange[]) => {
    const fileSummaries = buildFileSummaryMap(files);
    const folderSummaries = buildFolderSummaryMap(fileSummaries);
    return { fileSummaries, folderSummaries };
  };

  it('同一输入集合同一路径多次解析返回同一 Decoration 实例', () => {
    const resolver = createDecorationResolver();
    const { fileSummaries, folderSummaries } = buildMaps([fc('src/a.ts', 'Modified')]);
    const d1 = resolver.resolve(
      'src/a.ts',
      false,
      fileSummaries,
      folderSummaries,
      undefined,
      false,
    );
    const d2 = resolver.resolve(
      'src/a.ts',
      false,
      fileSummaries,
      folderSummaries,
      undefined,
      false,
    );
    expect(d1).not.toBeNull();
    expect(d1).toBe(d2);
  });

  it('快照更新后结构等值的 Decoration 沿用上一实例', () => {
    const resolver = createDecorationResolver();
    const snap1 = buildMaps([fc('src/a.ts', 'Modified'), fc('src/b.ts', 'Added')]);
    const d1a = resolver.resolve(
      'src/a.ts',
      false,
      snap1.fileSummaries,
      snap1.folderSummaries,
      undefined,
      false,
    );
    // 新快照：b.ts 状态变化，a.ts 不变
    const snap2 = buildMaps([fc('src/a.ts', 'Modified'), fc('src/b.ts', 'Deleted')]);
    const d2a = resolver.resolve(
      'src/a.ts',
      false,
      snap2.fileSummaries,
      snap2.folderSummaries,
      undefined,
      false,
    );
    expect(d1a).toBe(d2a);
  });

  it('status 真变的路径产出新实例', () => {
    const resolver = createDecorationResolver();
    const snap1 = buildMaps([fc('src/a.ts', 'Modified')]);
    const d1 = resolver.resolve(
      'src/a.ts',
      false,
      snap1.fileSummaries,
      snap1.folderSummaries,
      undefined,
      false,
    );
    const snap2 = buildMaps([fc('src/a.ts', 'Added')]);
    const d2 = resolver.resolve(
      'src/a.ts',
      false,
      snap2.fileSummaries,
      snap2.folderSummaries,
      undefined,
      false,
    );
    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();
    expect(d1).not.toBe(d2);
    expect(d2).toMatchObject({ badge: 'A', color: 'text-accent-green' });
  });

  it('不同文件树（不同容器引用）同路径同结构值互不串数据', () => {
    const resolver = createDecorationResolver();
    const treeA = buildMaps([fc('src/a.ts', 'Modified')]);
    const treeB = buildMaps([]);
    const da = resolver.resolve(
      'src/a.ts',
      false,
      treeA.fileSummaries,
      treeA.folderSummaries,
      undefined,
      false,
    );
    // 树 B 中该路径无变更 → null，不得复用树 A 的实例
    const db = resolver.resolve(
      'src/a.ts',
      false,
      treeB.fileSummaries,
      treeB.folderSummaries,
      undefined,
      false,
    );
    expect(da).not.toBeNull();
    expect(db).toBeNull();
  });

  it('active 只影响激活节点自身，其余节点仍复用实例', () => {
    const resolver = createDecorationResolver();
    const snap = buildMaps([fc('src/a.ts', 'Modified'), fc('src/b.ts', 'Added')]);
    const inactiveB = resolver.resolve(
      'src/b.ts',
      false,
      snap.fileSummaries,
      snap.folderSummaries,
      undefined,
      false,
    );
    // 切换 active 到 a.ts，b.ts 不受影响
    const activeA = resolver.resolve(
      'src/a.ts',
      false,
      snap.fileSummaries,
      snap.folderSummaries,
      undefined,
      true,
    );
    const inactiveB2 = resolver.resolve(
      'src/b.ts',
      false,
      snap.fileSummaries,
      snap.folderSummaries,
      undefined,
      false,
    );
    expect(activeA).toMatchObject({ color: 'text-accent' });
    expect(inactiveB).toBe(inactiveB2);
  });
});

describe('getSharedDecorationResolver — publish 输入转发', () => {
  it('publish 携带折叠目录条目时，后代节点继承目录态色', () => {
    const resolver = getSharedDecorationResolver();
    const files = [fc('pub-test/collapsed/', 'Untracked')];
    const fileSummaries = buildFileSummaryMap(files);
    const folderSummaries = buildFolderSummaryMap(fileSummaries);
    resolver.publish(fileSummaries, folderSummaries, undefined, collectCollapsedDirs(files));
    expect(resolver.resolve('pub-test/collapsed/deep.md', false, false)?.color).toBe(
      'text-accent-brick',
    );
  });

  it('publish 未携带折叠条目时不发生继承', () => {
    const resolver = getSharedDecorationResolver();
    const files = [fc('pub-test2/plain.md', 'Untracked')];
    const fileSummaries = buildFileSummaryMap(files);
    const folderSummaries = buildFolderSummaryMap(fileSummaries);
    resolver.publish(fileSummaries, folderSummaries, undefined, undefined);
    expect(resolver.resolve('pub-test2/other.md', false, false)).toBeNull();
  });
});
