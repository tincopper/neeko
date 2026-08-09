import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileStore } from '@/features/file/store';
import type { FileNode } from '@/shared/types';

const OWNER = 'p1:/proj';

function dirNode(name: string, path: string, children: FileNode[] = []): FileNode {
  return { name, path, is_dir: true, children };
}
function fileNode(name: string, path: string): FileNode {
  return { name, path, is_dir: false, children: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  useFileStore.getState().reset();
});

describe('useFileStore 扁平目录缓存', () => {
  it('loadDir 成功写入目录缓存并标记 loaded（缓存只存一级条目，嵌套子目录 seed 进缓存）', async () => {
    const loader = vi
      .fn()
      .mockResolvedValue([
        dirNode('src', 'src', [fileNode('a.ts', 'src/a.ts')]),
        fileNode('b.ts', 'b.ts'),
      ]);

    await useFileStore.getState().loadDir(OWNER, '', loader);

    const s = useFileStore.getState();
    expect(s.owner).toBe(OWNER);
    expect(s.dirs['']).toEqual([dirNode('src', 'src'), fileNode('b.ts', 'b.ts')]);
    expect(s.loadStates['']).toBe('loaded');
    // 嵌套子目录被 seed：展开 src 时直接命中缓存，无需再请求
    expect(s.dirs['src']).toEqual([fileNode('a.ts', 'src/a.ts')]);
    expect(s.loadStates['src']).toBe('loaded');
    expect(loader).toHaveBeenCalledOnce();
  });

  it('嵌套子目录 seed 进缓存：展开命中缓存，不重复请求', async () => {
    const loader = vi
      .fn()
      .mockResolvedValue([
        dirNode('src', 'src', [
          dirNode('utils', 'src/utils', [fileNode('b.ts', 'src/utils/b.ts')]),
        ]),
        fileNode('a.ts', 'src/a.ts'),
      ]);

    await useFileStore.getState().loadDir(OWNER, '', loader);

    const s = useFileStore.getState();
    expect(s.dirs['']).toEqual([dirNode('src', 'src'), fileNode('a.ts', 'src/a.ts')]);
    expect(s.dirs['src']).toEqual([dirNode('utils', 'src/utils')]);
    expect(s.dirs['src/utils']).toEqual([fileNode('b.ts', 'src/utils/b.ts')]);
    expect(s.loadStates['src']).toBe('loaded');
    expect(s.loadStates['src/utils']).toBe('loaded');

    // 已 seed 的目录再次 loadDir 幂等跳过：不会重复请求
    const expandLoader = vi.fn().mockResolvedValue([fileNode('x.ts', 'src/x.ts')]);
    await useFileStore.getState().loadDir(OWNER, 'src', expandLoader);
    expect(expandLoader).not.toHaveBeenCalled();
    expect(s.dirs['src']).toEqual([dirNode('utils', 'src/utils')]);
  });

  it('seed 不覆盖已加载的子目录：根刷新保留展开目录的最新缓存', async () => {
    // 先通过懒加载写入 src 缓存（新内容）
    await useFileStore
      .getState()
      .loadDir(OWNER, 'src', () => Promise.resolve([fileNode('new.ts', 'src/new.ts')]));

    // 根刷新返回旧的嵌套树（src 下是旧内容）
    await useFileStore
      .getState()
      .loadDir(OWNER, '', () =>
        Promise.resolve([dirNode('src', 'src', [fileNode('old.ts', 'src/old.ts')])]),
      );

    const s = useFileStore.getState();
    expect(s.dirs['']).toEqual([dirNode('src', 'src')]);
    // 已加载的 src 缓存不被根刷新覆盖
    expect(s.dirs['src']).toEqual([fileNode('new.ts', 'src/new.ts')]);
    expect(s.loadStates['src']).toBe('loaded');
  });

  it('空 children 的目录不 seed：展开时仍按需请求（保留穿透语义）', async () => {
    const loader = vi
      .fn()
      .mockResolvedValue([dirNode('locked', 'locked'), fileNode('a.ts', 'a.ts')]);

    await useFileStore.getState().loadDir(OWNER, '', loader);

    const s = useFileStore.getState();
    expect(s.dirs['']).toEqual([dirNode('locked', 'locked'), fileNode('a.ts', 'a.ts')]);
    // 空目录未被 seed：展开 locked 时发起请求
    expect(s.dirs['locked']).toBeUndefined();
    expect(s.loadStates['locked']).toBeUndefined();
  });

  it('seed 不打断加载中的目录：根刷新不覆盖在途请求的 loading 态', async () => {
    // 1. 建立 owner + 根缓存
    await useFileStore
      .getState()
      .loadDir(OWNER, '', () => Promise.resolve([dirNode('src', 'src')]));

    // 2. 展开 src 发起在途请求（loading、无缓存）
    const srcDeferred = deferred<FileNode[]>();
    const pSrc = useFileStore.getState().loadDir(OWNER, 'src', () => srcDeferred.promise);
    expect(useFileStore.getState().loadStates['src']).toBe('loading');

    // 3. 根刷新返回嵌套树（src 的旧快照，含子项）
    await useFileStore
      .getState()
      .loadDir(
        OWNER,
        '',
        () => Promise.resolve([dirNode('src', 'src', [fileNode('old.ts', 'src/old.ts')])]),
        { force: true, silent: true },
      );

    // seed 不应把在途请求的 src 置 loaded，也不写入旧快照
    expect(useFileStore.getState().loadStates['src']).toBe('loading');
    expect(useFileStore.getState().dirs['src']).toBeUndefined();

    // 4. src 请求返回真实内容：最终一致
    srcDeferred.resolve([fileNode('new.ts', 'src/new.ts')]);
    await pSrc;
    const finalState = useFileStore.getState();
    expect(finalState.dirs['src']).toEqual([fileNode('new.ts', 'src/new.ts')]);
    expect(finalState.loadStates['src']).toBe('loaded');
  });

  it('加载期间标记 loading', async () => {
    const d = deferred<FileNode[]>();
    const p = useFileStore.getState().loadDir(OWNER, '', () => d.promise);
    expect(useFileStore.getState().loadStates['']).toBe('loading');
    d.resolve([fileNode('a.ts', 'a.ts')]);
    await p;
    expect(useFileStore.getState().loadStates['']).toBe('loaded');
  });

  it('并发加载同一目录：过期响应（token 不匹配）被丢弃，最后一次为准', async () => {
    const first = deferred<FileNode[]>();
    const second = deferred<FileNode[]>();
    const p1 = useFileStore.getState().loadDir(OWNER, 'src', () => first.promise);
    const p2 = useFileStore.getState().loadDir(OWNER, 'src', () => second.promise);

    second.resolve([fileNode('b.ts', 'src/b.ts')]);
    await p2;
    first.resolve([fileNode('a.ts', 'src/a.ts')]);
    await p1;

    expect(useFileStore.getState().dirs['src']).toEqual([fileNode('b.ts', 'src/b.ts')]);
  });

  it('切换 owner：旧缓存与旧响应作废，新 owner 响应写入', async () => {
    const stale = deferred<FileNode[]>();
    const pStale = useFileStore.getState().loadDir(OWNER, '', () => stale.promise);

    await useFileStore
      .getState()
      .loadDir('p2:/proj2', '', () => Promise.resolve([fileNode('x.ts', 'x.ts')]));

    stale.resolve([fileNode('old.ts', 'old.ts')]);
    await pStale;

    const s = useFileStore.getState();
    expect(s.owner).toBe('p2:/proj2');
    expect(s.dirs['']).toEqual([fileNode('x.ts', 'x.ts')]);
    expect(s.dirs['']).not.toContainEqual(fileNode('old.ts', 'old.ts'));
  });

  it('加载失败：标记 error 且保留旧目录内容（绝不置空）', async () => {
    await useFileStore
      .getState()
      .loadDir(OWNER, 'src', () => Promise.resolve([fileNode('a.ts', 'src/a.ts')]));

    await useFileStore
      .getState()
      .loadDir(OWNER, 'src', () => Promise.reject(new Error('disk busy')), { force: true });

    const s = useFileStore.getState();
    expect(s.loadStates['src']).toBe('error');
    expect(s.dirs['src']).toEqual([fileNode('a.ts', 'src/a.ts')]);
  });

  it('首次失败无旧内容：标记 error，不写入空缓存', async () => {
    await useFileStore.getState().loadDir(OWNER, 'src', () => Promise.reject(new Error('boom')));
    expect(useFileStore.getState().loadStates['src']).toBe('error');
    expect(useFileStore.getState().dirs['src']).toBeUndefined();
  });

  it('silent 后台刷新：已有内容时不切换 loading 态，成功仍更新缓存', async () => {
    await useFileStore
      .getState()
      .loadDir(OWNER, '', () => Promise.resolve([fileNode('old.ts', 'old.ts')]));

    await useFileStore
      .getState()
      .loadDir(OWNER, '', () => Promise.resolve([fileNode('new.ts', 'new.ts')]), { silent: true });

    const s = useFileStore.getState();
    expect(s.loadStates['']).toBe('loaded');
    expect(s.dirs['']).toEqual([fileNode('new.ts', 'new.ts')]);
  });

  it('silent 后台刷新失败：保留旧内容并标记 error（供 UI 重试）', async () => {
    await useFileStore
      .getState()
      .loadDir(OWNER, '', () => Promise.resolve([fileNode('old.ts', 'old.ts')]));

    await useFileStore
      .getState()
      .loadDir(OWNER, '', () => Promise.reject(new Error('boom')), { silent: true });

    const s = useFileStore.getState();
    expect(s.loadStates['']).toBe('error');
    expect(s.dirs['']).toEqual([fileNode('old.ts', 'old.ts')]);
  });

  it('刷新根目录不触碰已加载的子目录缓存（根治展开目录被整树覆盖）', async () => {
    await useFileStore
      .getState()
      .loadDir(OWNER, 'src', () => Promise.resolve([fileNode('a.ts', 'src/a.ts')]));

    await useFileStore
      .getState()
      .loadDir(OWNER, '', () =>
        Promise.resolve([dirNode('src', 'src'), fileNode('new.md', 'new.md')]),
      );

    const s = useFileStore.getState();
    expect(s.dirs['']).toEqual([dirNode('src', 'src'), fileNode('new.md', 'new.md')]);
    expect(s.dirs['src']).toEqual([fileNode('a.ts', 'src/a.ts')]);
  });

  it('幂等：已加载目录再次 loadDir 不发起重复请求', async () => {
    const loader = vi.fn().mockResolvedValue([fileNode('a.ts', 'src/a.ts')]);
    await useFileStore.getState().loadDir(OWNER, 'src', loader);
    await useFileStore.getState().loadDir(OWNER, 'src', loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('加载中重复调用：token 递增，最后一次为准（不跳过，防乱序）', async () => {
    const loader = vi.fn().mockResolvedValue([fileNode('a.ts', 'src/a.ts')]);
    const p1 = useFileStore.getState().loadDir(OWNER, 'src', loader);
    const p2 = useFileStore.getState().loadDir(OWNER, 'src', loader);
    await Promise.all([p1, p2]);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(useFileStore.getState().dirs['src']).toEqual([fileNode('a.ts', 'src/a.ts')]);
  });

  it('force 强制重新加载（刷新场景）', async () => {
    const loader1 = vi.fn().mockResolvedValue([fileNode('old.ts', 'src/old.ts')]);
    const loader2 = vi.fn().mockResolvedValue([fileNode('new.ts', 'src/new.ts')]);
    await useFileStore.getState().loadDir(OWNER, 'src', loader1);
    await useFileStore.getState().loadDir(OWNER, 'src', loader2, { force: true });
    expect(useFileStore.getState().dirs['src']).toEqual([fileNode('new.ts', 'src/new.ts')]);
    expect(loader2).toHaveBeenCalledTimes(1);
  });

  it('error 后再次 loadDir 自动重试（无需 force）', async () => {
    await useFileStore.getState().loadDir(OWNER, 'src', () => Promise.reject(new Error('boom')));
    const loader = vi.fn().mockResolvedValue([fileNode('a.ts', 'src/a.ts')]);
    await useFileStore.getState().loadDir(OWNER, 'src', loader);
    expect(useFileStore.getState().loadStates['src']).toBe('loaded');
    expect(useFileStore.getState().dirs['src']).toEqual([fileNode('a.ts', 'src/a.ts')]);
  });

  it('reset 清空归属与全部缓存', async () => {
    await useFileStore
      .getState()
      .loadDir(OWNER, '', () => Promise.resolve([fileNode('a.ts', 'a.ts')]));
    useFileStore.getState().reset();
    const s = useFileStore.getState();
    expect(s.owner).toBeNull();
    expect(s.dirs).toEqual({});
    expect(s.loadStates).toEqual({});
    expect(s.requests).toEqual({});
  });
});
