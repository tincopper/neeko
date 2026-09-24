/**
 * AC7 验证（自动化）：折叠 untracked 目录展开的**拉取次数上界** —— 事件风暴不得放大 IPC。
 *
 * AC7 判定：同一目录连续创建 10 个文件时，每事件批次每折叠目录至多 1 次拉取，
 * 总次数 ≤ 折叠目录数 × 事件批次数。
 * 「拉取」在本文件里以注入的 `onExpandUntrackedDir` 调用次数为代理 —— 真实实现中它
 * 就是 `get_untracked_files` 的唯一 IPC 出口（`GitCommitPanel.tsx` 的 handler），
 * 因此调用次数与 invoke 次数一一对应（无需插桩即可判定）。
 *
 * 契约前提（design.md §2.1/§2.4）：
 * - S1 失效订阅（FILE_CHANGED_EVENT）定义在 hook **内部**；若实现改为上游注入，
 *   请同步调整本文件的注入点，但**不要**删掉调用次数断言。
 * - 一个「批次」= 一条 `file-changed` 事件（后端已做 200ms 滑动 / 1.5s 上限去抖），
 *   载荷里的多条 `paths` 属同一批次。
 * - hook 与项目无关（面板单项目展示），payload 的 `project_id` 不参与判定。
 *
 * S2（快照替换失效）用例见下方第二个 describe：判定落在「`files` 引用被替换」上，**不用**
 * 快照 version —— local 主路径的两条刷新都不推进 version（面板刷新按钮走 `get_git_info`，
 * 不经过 version gate；窗口聚焦走 `versionGateAccepts(..., allowEqual=true)` 同版本放行）。
 * 该判定要求上游 `files` 引用稳定（`useCommitPanelAux` 已 memo），否则会退化成每次
 * render 都重拉 —— 因此**本文件所有用例都必须传稳定引用**（实测：内联数组字面量会 1s 内
 * 触发 26k 次拉取）。
 *
 * 用例覆盖：装配自检 + AC7-1～AC7-4（S1 事件驱动的调用次数上界）、S2-1～S2-3（快照替换失效）、
 * S3-1/S3-2（失败语义与防自激）、isPathUnderDir（路径段判定纯函数）。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileChange, FileChangedEvent } from '@/shared/types';

type Subscriber = (event: FileChangedEvent) => void;

const { subscribers } = vi.hoisted(() => ({ subscribers: new Set<Subscriber>() }));

// 同一份订阅注册表挂两个 mock 路径：hook 从任一入口导入 useFileChangedEvent 都命中
// （`features/git/hooks/useFileChangedEvent.ts` 只是 shared 的 re-export）。
vi.mock('@/shared/hooks/useFileChangedEvent', async () => {
  const { useEffect } = await import('react');
  return {
    useFileChangedEvent: (callback: Subscriber) => {
      useEffect(() => {
        subscribers.add(callback);
        return () => {
          subscribers.delete(callback);
        };
      }, [callback]);
    },
  };
});

vi.mock('../useFileChangedEvent', async () => {
  const { useEffect } = await import('react');
  return {
    useFileChangedEvent: (callback: Subscriber) => {
      useEffect(() => {
        subscribers.add(callback);
        return () => {
          subscribers.delete(callback);
        };
      }, [callback]);
    },
  };
});

import { isPathUnderDir, useUntrackedDirExpansion } from '../useUntrackedDirExpansion';

/** 折叠 untracked 目录条目（G1：path 无尾斜杠 + is_dir 显式表达） */
function collapsedDir(path: string): FileChange {
  return {
    path,
    status: 'Untracked',
    index_status: '?',
    worktree_status: '?',
    additions: 0,
    deletions: 0,
    is_dir: true,
  };
}

/** 模拟后端一条 file-changed 批次（含 N 条路径） */
function emitBurst(paths: string[]) {
  act(() => {
    for (const callback of [...subscribers]) {
      callback({ project_id: 'p1', paths });
    }
  });
}

/** 让已排队的微任务/effect 落地，用于「不再有额外调用」的稳定期断言 */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useUntrackedDirExpansion — AC7 事件风暴的调用次数上界', () => {
  beforeEach(() => {
    subscribers.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('装配自检：hook 必须订阅 file-changed（否则 S1 用例会「假绿」）', async () => {
    const files = [collapsedDir('dir-a')];
    const expand = vi.fn(() => Promise.resolve([]));
    renderHook(() => useUntrackedDirExpansion(files, expand));

    await waitFor(() => expect(subscribers.size).toBeGreaterThan(0));
  });

  it('AC7-1 同一批次 10 个路径命中同一目录 → 仅追加 1 次拉取', async () => {
    // 引用稳定性是契约：files 每次 render 换引用会被 S2 判为「快照替换」→ 持续重拉
    const files = [collapsedDir('tmp-untracked')];
    const expand = vi.fn(() => Promise.resolve(['tmp-untracked/a.txt']));
    renderHook(() => useUntrackedDirExpansion(files, expand));

    // 首次展开（缓存为空）→ 1 次
    await waitFor(() => expect(expand).toHaveBeenCalledTimes(1));

    // 风暴批次：同一目录内新增 10 个文件（后端去抖后落在同一条事件里）
    emitBurst(Array.from({ length: 10 }, (_, i) => `tmp-untracked/f${i}.txt`));

    await waitFor(() => expect(expand).toHaveBeenCalledTimes(2));
    await settle();
    // 同一批次必须合并为 1 次拉取
    expect(expand).toHaveBeenCalledTimes(2);
  });

  it('AC7-2 同一批次命中 2 个折叠目录 → 每目录各 1 次（总 +2）', async () => {
    const files = [collapsedDir('dir-a'), collapsedDir('dir-b')];
    const expand = vi.fn((dirPath: string) => Promise.resolve([`${dirPath}/a.txt`]));
    renderHook(() => useUntrackedDirExpansion(files, expand));

    await waitFor(() => expect(expand).toHaveBeenCalledTimes(2));

    emitBurst(['dir-a/1.txt', 'dir-a/2.txt', 'dir-b/1.txt', 'dir-b/2.txt', 'dir-b/3.txt']);

    await waitFor(() => expect(expand).toHaveBeenCalledTimes(4));
    await settle();
    // 每批次每目录至多 1 次：2 个目录 → +2
    expect(expand).toHaveBeenCalledTimes(4);
  });

  it('AC7-3 in-flight 期间连来 3 个批次 → 合并为 1 次 trailing（总 ≤ 2）', async () => {
    let releaseFirst: ((files: string[]) => void) | undefined;
    let isFirstCall = true;
    const expand = vi.fn((dirPath: string) => {
      if (isFirstCall) {
        isFirstCall = false;
        return new Promise<string[]>((resolve) => {
          releaseFirst = (files) => resolve(files.map((f) => `${dirPath}/${f}`));
        });
      }
      return Promise.resolve([`${dirPath}/trailing.txt`]);
    });

    const files = [collapsedDir('dir-a')];
    renderHook(() => useUntrackedDirExpansion(files, expand));
    await waitFor(() => expect(expand).toHaveBeenCalledTimes(1));

    // 首次拉取未落地时连续 3 个批次命同一目录 → 不得并发 3 次拉取
    emitBurst(['dir-a/1.txt']);
    emitBurst(['dir-a/2.txt']);
    emitBurst(['dir-a/3.txt']);
    // in-flight 期间不得再次发起拉取
    expect(expand).toHaveBeenCalledTimes(1);

    act(() => {
      releaseFirst?.(['1.txt']);
    });

    await waitFor(() => expect(expand).toHaveBeenCalledTimes(2));
    await settle();
    // 3 个批次合并为 1 次 trailing 重拉
    expect(expand).toHaveBeenCalledTimes(2);
  });

  it('AC7-4 批次内路径不命中任何折叠目录 → 0 次额外拉取', async () => {
    const files = [collapsedDir('dir-a')];
    const expand = vi.fn(() => Promise.resolve(['dir-a/a.txt']));
    renderHook(() => useUntrackedDirExpansion(files, expand));

    await waitFor(() => expect(expand).toHaveBeenCalledTimes(1));

    emitBurst(['src/main.ts', 'docs/readme.md', 'dir-ab/foreign.txt']);
    await settle();

    // 不相关路径不得触发重拉
    expect(expand).toHaveBeenCalledTimes(1);
  });
});

/** 当前平铺后的 Unversioned 行路径（含未展开时残留的目录条目） */
function rowPaths(result: { current: { flattenedUntracked: FileChange[] } }): string[] {
  return result.current.flattenedUntracked.map((f) => f.path);
}

describe('useUntrackedDirExpansion — S2 快照替换失效（changed_files 引用被替换）', () => {
  beforeEach(() => {
    subscribers.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('S2-1 引用被替换 → 后台重拉；新值落地前旧值保留（SWR，不闪回目录占位）', async () => {
    const expand = vi.fn(async () => ['dir-a/old.txt']);
    const { result, rerender } = renderHook(
      ({ files }: { files: FileChange[] }) => useUntrackedDirExpansion(files, expand),
      { initialProps: { files: [collapsedDir('dir-a')] } },
    );

    await waitFor(() => expect(expand).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rowPaths(result)).toEqual(['dir-a/old.txt']));

    let release!: (files: string[]) => void;
    expand.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          release = resolve;
        }),
    );

    // 内容相同但引用换新 = 快照事件 / 刷新按钮 / 窗口聚焦后的 changed_files 整体替换
    rerender({ files: [collapsedDir('dir-a')] });
    await waitFor(() => expect(expand).toHaveBeenCalledTimes(2));

    // SWR：新值未落地时旧子行仍在
    expect(rowPaths(result)).toEqual(['dir-a/old.txt']);

    act(() => {
      release(['dir-a/new.txt']);
    });
    await waitFor(() => expect(rowPaths(result)).toEqual(['dir-a/new.txt']));
  });

  it('S2-2 引用不变（无关重渲染）→ 不重拉', async () => {
    const files = [collapsedDir('dir-a')];
    const expand = vi.fn(async () => ['dir-a/a.txt']);
    const { rerender } = renderHook(
      ({ f }: { f: FileChange[] }) => useUntrackedDirExpansion(f, expand),
      { initialProps: { f: files } },
    );

    await waitFor(() => expect(expand).toHaveBeenCalledTimes(1));

    rerender({ f: files });
    await settle();

    expect(expand).toHaveBeenCalledTimes(1);
  });

  it('S2-3 折叠目录从列表消失 → 缓存键丢弃；再次出现时重新拉取', async () => {
    const expand = vi.fn(async () => ['dir-a/a.txt']);
    const { rerender } = renderHook(
      ({ f }: { f: FileChange[] }) => useUntrackedDirExpansion(f, expand),
      { initialProps: { f: [collapsedDir('dir-a')] } },
    );

    await waitFor(() => expect(expand).toHaveBeenCalledTimes(1));

    // 目录被 stage / 删除 → 条目消失：不重拉已消失的目录
    rerender({ f: [] });
    await settle();
    expect(expand).toHaveBeenCalledTimes(1);

    // 再次出现（视为新目录）：缓存键已丢弃 → 必须重新拉取
    rerender({ f: [collapsedDir('dir-a')] });
    await waitFor(() => expect(expand).toHaveBeenCalledTimes(2));
  });
});

describe('isPathUnderDir — 路径段语义（红线 12，禁止前缀别名匹配）', () => {
  it('同路径与任意深度子路径命中', () => {
    expect(isPathUnderDir('dir-a', 'dir-a')).toBe(true);
    expect(isPathUnderDir('dir-a/x.txt', 'dir-a')).toBe(true);
    expect(isPathUnderDir('dir-a/sub/x.txt', 'dir-a')).toBe(true);
  });

  it('前缀相似的兄弟目录不误命中', () => {
    expect(isPathUnderDir('dir-ab/x.txt', 'dir-a')).toBe(false);
    expect(isPathUnderDir('other/dir-a/x.txt', 'dir-a')).toBe(false);
  });

  it('目录侧尾斜杠（旧 payload）兼容；空目录不误判', () => {
    expect(isPathUnderDir('dir-a/x.txt', 'dir-a/')).toBe(true);
    expect(isPathUnderDir('dir-a', 'dir-a/')).toBe(true);
    expect(isPathUnderDir('dir-a/x.txt', '')).toBe(false);
  });
});

describe('useUntrackedDirExpansion — S3 失败语义（不缓存空列表 + 防自激）', () => {
  beforeEach(() => {
    subscribers.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('S3-1 拉取失败不缓存空列表：目录条目继续占位，下一次失效信号可重试成功', async () => {
    const files = [collapsedDir('dir-a')];
    const expand = vi.fn(async () => {
      throw new Error('IPC failed');
    });
    const { result } = renderHook(() => useUntrackedDirExpansion(files, expand));

    await waitFor(() => expect(expand).toHaveBeenCalledTimes(1));
    await settle();

    // 失败不得写成空列表：目录条目继续占位（写成 [] 会让「目录里的文件全消失」）
    expect(rowPaths(result)).toEqual(['dir-a']);
    // 失败抑制：不自发重试
    expect(expand).toHaveBeenCalledTimes(1);

    // 下一次失效信号（目录内变化）→ 复位失败抑制并重试；本次成功
    expand.mockImplementation(async () => ['dir-a/a.txt']);
    emitBurst(['dir-a/new.txt']);

    await waitFor(() => expect(expand).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(rowPaths(result)).toEqual(['dir-a/a.txt']));
  });

  it('S3-2 持续失败不产生无限重试（静默窗口内至多 1 次拉取）', async () => {
    const files = [collapsedDir('dir-a'), collapsedDir('dir-b')];
    const expand = vi.fn(async () => {
      throw new Error('boom');
    });
    renderHook(() => useUntrackedDirExpansion(files, expand));

    await waitFor(() => expect(expand).toHaveBeenCalledTimes(2));
    await settle();
    await settle();

    // 两个目录各失败一次即止：不得因「不写缓存 → effect 重跑 → 立即重试」自激
    expect(expand).toHaveBeenCalledTimes(2);
  });
});
