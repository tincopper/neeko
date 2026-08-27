import { create } from 'zustand';

import type { DirLoadState, FileNode } from '@/shared/types';

/** 目录缓存 key：项目内相对路径，'' 表示项目根目录 */
export type DirPath = string;
/** 文件树数据归属：`${projectId}:${rootPath}`，用于切换项目/root 时丢弃过期响应 */
export type FileTreeOwner = string;

export interface LoadDirOptions {
  /** 强制重新加载：跳过「已 loaded 幂等跳过」；用于初始加载与手动/后台刷新 */
  force?: boolean;
  /** 后台静默加载：已有内容时不切换 loading 态（避免刷新闪烁），失败保留旧内容并标记 error */
  silent?: boolean;
}

interface FileStoreState {
  /** 当前数据归属；与传入 owner 不一致时，旧缓存与在途响应一律作废 */
  owner: FileTreeOwner | null;
  /** 各目录内容缓存：dirPath → 该目录一级条目（children 一律清空，见 stripChildren） */
  dirs: Record<DirPath, FileNode[]>;
  /** 各目录加载状态机：idle | loading | loaded | error */
  loadStates: Record<DirPath, DirLoadState>;
  /** 各目录请求序号：响应回来时序号不匹配即过期，丢弃防乱序覆盖 */
  requests: Record<DirPath, number>;
  activeFilePath: string | null;
  /**
   * 加载（或重载）某个目录的内容。目录数据独立缓存、独立生命周期：
   * - 加载成功写入 dirs[dirPath]，标记 loaded
   * - 失败保留旧内容并标记 error（供 UI 重试），绝不置空
   * - owner / 请求序号任一不匹配即丢弃响应
   * - loading 中重复调用：token 递增，最后一次为准
   */
  loadDir: (
    owner: FileTreeOwner,
    dirPath: DirPath,
    loader: () => Promise<FileNode[]>,
    opts?: LoadDirOptions,
  ) => Promise<void>;
  /**
   * 全树/定向刷新：重载根目录与已加载目录，逐个替换缓存。
   * 解决「移动/删除文件后展开目录缓存不更新」——显式刷新已加载目录缓存。
   * - opts.dirs 提供时为**定向刷新**（S2-2）：只重载命中该目录集合的缓存桶，
   *   其余已加载目录保持不动 —— 刷新成本 O(变更) 而非 O(已展开树)；
   *   dirs 空数组 / undefined = 变更范围未知（watcher overflow 兜底），执行全量
   * - 跳过正在 loading 的目录（让在途请求自己收尾，避免 token 竞争）
   * - 未加载（折叠未展开）的子目录下次展开仍懒加载新数据，无需处理
   * - silent：后台刷新，新数据到达前保留旧内容、不切换 loading 态
   */
  refreshTree: (
    owner: FileTreeOwner,
    loaderFor: (dirPath: DirPath) => () => Promise<FileNode[]>,
    opts?: { silent?: boolean; dirs?: string[] },
  ) => Promise<void>;
  /** 切换项目/root 时清空全部缓存与归属 */
  reset: () => void;
}

/** 目录缓存只存一级条目：清空 children，避免「嵌套树」与「扁平缓存」两套语义并存 */
function stripChildren(nodes: FileNode[]): FileNode[] {
  return nodes.map((n) => (n.is_dir ? { ...n, children: [] } : n));
}

/** 受控并发执行（S2-3）：并发上限固定为 4，防止事件风暴期的无界扇出 */
async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    // 领号取任务：号超出范围即本 runner 退出（无常量条件，lint 友好）
    let index = next++;
    while (index < items.length) {
      await worker(items[index] as T);
      index = next++;
    }
  });
  await Promise.all(runners);
}

/**
 * 把嵌套树中所有「带 children 的目录」摊平进扁平缓存（每级只存一级条目）。
 * 展开这些目录时可直接命中缓存，无需再发起请求；空 children 的目录（真空目录、
 * 被忽略剪枝、达到 max_depth 截断）不 seed —— 展开时仍按需请求，保留穿透语义。
 */
function flattenNestedDirs(nodes: FileNode[]): Record<string, FileNode[]> {
  const out: Record<string, FileNode[]> = {};
  const walk = (list: FileNode[]) => {
    for (const n of list) {
      if (n.is_dir && n.children.length > 0) {
        out[n.path] = stripChildren(n.children);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

export const useFileStore = create<FileStoreState>((set, get) => ({
  owner: null,
  dirs: {},
  loadStates: {},
  requests: {},
  activeFilePath: null,

  async loadDir(owner, dirPath, loader, opts) {
    const state = get();
    const ownerChanged = state.owner !== owner;
    const { force = false, silent = false } = opts ?? {};
    // 幂等：已加载且非「刷新类」调用（force/silent）→ 跳过（展开已加载目录不重复请求）
    // 加载中重复调用不跳过：token 递增，最后一次为准（防乱序见 requests 校验）
    const current = state.loadStates[dirPath];
    if (!ownerChanged && !force && !silent && current === 'loaded') return;
    // 切换 owner：丢弃全部旧缓存与在途请求（旧响应会因 owner/token 校验被忽略）
    const prevDirs = ownerChanged ? {} : state.dirs;
    const prevLoadStates = ownerChanged ? {} : state.loadStates;
    const prevRequests = ownerChanged ? {} : state.requests;
    const token = (prevRequests[dirPath] ?? 0) + 1;
    // silent 且已有内容：后台更新，不切换 loading 态；否则进入 loading（含首次）
    const keepSilent = silent && !ownerChanged && prevLoadStates[dirPath] !== undefined;

    set({
      owner,
      dirs: prevDirs,
      loadStates: keepSilent ? prevLoadStates : { ...prevLoadStates, [dirPath]: 'loading' },
      requests: { ...prevRequests, [dirPath]: token },
    });

    try {
      const tree = await loader();
      const latest = get();
      if (latest.owner !== owner || latest.requests[dirPath] !== token) return;
      // 请求目录写入一级缓存；嵌套树中的子目录 seed 进缓存（仅填补空缺，
      // 不覆盖已加载的子目录 —— 根刷新不触碰已展开目录缓存的语义保持一致）。
      const nested = flattenNestedDirs(tree);
      const dirs: Record<string, FileNode[]> = {
        ...latest.dirs,
        [dirPath]: stripChildren(tree),
      };
      const loadStates: Record<string, DirLoadState> = {
        ...latest.loadStates,
        [dirPath]: 'loaded',
      };
      for (const [p, entries] of Object.entries(nested)) {
        // 仅填补「从未加载且不在途」的目录：已加载目录保留（p in dirs），
        // 正在请求的目录不打断（loading 由该请求自己收尾）——根刷新不得干扰展开中的目录。
        if (!(p in latest.dirs) && latest.loadStates[p] !== 'loading') {
          dirs[p] = entries;
          loadStates[p] = 'loaded';
        }
      }
      set({ dirs, loadStates });
    } catch {
      const latest = get();
      if (latest.owner !== owner || latest.requests[dirPath] !== token) return;
      // 失败保留旧内容，标记 error 供 UI 重试
      set({ loadStates: { ...latest.loadStates, [dirPath]: 'error' } });
    }
  },

  async refreshTree(owner, loaderFor, opts) {
    const { silent = false, dirs } = opts ?? {};
    // 快照当前已加载目录（dirs 的 key），避免刷新过程中新增目录影响遍历
    const loadedPaths = Object.keys(get().dirs);
    let target: string[];
    if (dirs && dirs.length > 0) {
      // 定向刷新（S2-2）：只重载事件命中目录集合的缓存桶，成本 O(变更)
      const hits = new Set(dirs);
      target = loadedPaths.filter((p) => hits.has(p) && get().loadStates[p] !== 'loading');
    } else {
      // 全量兜底：变更范围未知（watcher overflow / 手动刷新）
      // 跳过正在 loading 的目录：让在途请求自己收尾，避免 token 竞争覆盖最新响应
      target = loadedPaths.filter((p) => get().loadStates[p] !== 'loading');
    }
    // 受控并发重载；loadDir 内部 owner/token 校验会丢弃过期写入
    await mapWithConcurrency(target, 4, (dirPath) =>
      get().loadDir(owner, dirPath, loaderFor(dirPath), { force: true, silent }),
    );
  },

  reset: () => set({ owner: null, dirs: {}, loadStates: {}, requests: {}, activeFilePath: null }),
}));
