import type { FileChange } from '@/shared/types';

/**
 * git 状态装饰的唯一公开面（单一事实源）。
 *
 * 消费方横跨三层：主 Explorer（features/file）、PR 变更树（shared/components/ChangeFileTree，
 * 被 features/git 的 PRFileTree 间接消费）、未来 tab-bar。因此落位 `shared/utils`，
 * 避免 shared/components 反向依赖 feature 内部实现（违反分层红线）。
 *
 * ## 临时语义标注
 * Rust 当前对每个文件输出单一 status，映射时确定性落入 `unstaged` 桶：
 * `Added → added`、`Modified → modified`、`Renamed → renamed 计数`、
 * `Deleted → deleted`、`Untracked → untracked`。
 * `staged` 恒为 0、`conflict` 为常驻语义（当前无输入源）——禁止把桶位解释成真实暂存状态；
 * 后端升级输出 staged/unstaged 分离后，字段即自然生效，无需前端重新建模。
 * （renamed 独立计数：徽标字母必须保真显示 R，不可折叠进 modified。）
 *
 * ## 词表封闭约定
 * 消费方（文件树 / 变更树 / 未来 tab-bar 等）只允许调用本模块导出的函数与类型，
 * 禁止任何组件私持 STATUS 颜色或徽标对照表——这是防止词汇再分裂为两处定义的结构性保证。
 *
 * ## 扩展点（本期 Non-Goal，不接入）
 * - tab 徽标：`summaryToBadge` 的 `{ badge, variant }` 可直接作为 tab 行尾徽标（R4）。
 * - LSP error badge / dirty 标记：只需给 `resolveDecoration` 增加一路输入信号，
 *   在 `Decoration` 上追加字段，不改架构。
 */

// ─── 类型 ─────────────────────────────────────────────────────────────────────

export interface TrackedCounts {
  added: number;
  modified: number;
  deleted: number;
}

/** 重命名计数独立于 modified：徽标字母必须保真显示 R，折叠进桶后信息论上无法还原 */
export interface GitStatusSummary {
  staged: TrackedCounts;
  unstaged: TrackedCounts;
  /** 重命名条目数（暂时与 untracked 同级平铺：当前后端输出单一 status，无 staged/unstaged 来源） */
  renamed: number;
  untracked: number;
  conflict: number;
}

/** 行尾徽标字母（与 Badge 组件解耦，仅表达「哪个状态」） */
export type BadgeLetter = 'M' | 'A' | 'D' | 'R' | 'U' | '!';

/** Badge 组件的 variant 子集（与 ui/Badge 对齐，勿在组件内私建映射） */
export type StatusVariant = 'added' | 'modified' | 'deleted' | 'default';

export interface Decoration {
  /** 文件名文字颜色 class（text-accent-* / text-text-*） */
  color?: string;
  /** 行尾徽标字母 */
  badge?: BadgeLetter;
  /** 徽标色系（ui/Badge 的 variant；供 PR 变更树等 chip 形态消费方取用） */
  variant?: StatusVariant;
  /** 圆点色 class（bg-accent-*；供 status dot 消费方取用） */
  dot?: string;
  /** tooltip 说明（预留，当前未使用） */
  tooltip?: string;
  /** 是否灰化（被忽略且无 git 状态） */
  dimmed?: boolean;
}

/**
 * 单节点装饰解析回调的形状：路径 + 目录性 + 是否激活 → Decoration。
 * 递归树组件的公开 prop 契约 —— 由父级为每个直接子节点调用后逐一传入子行组件，
 * 不再下传整张 map 或祖先谓词（P3 下传策略）。
 */
export type ResolveNodeDecoration = (
  path: string,
  isDir: boolean,
  isActive: boolean,
) => Decoration | null;

/** 主导状态（优先级序）：conflict > deleted > modified > renamed > untracked > added */
type DominantStatus = 'conflict' | 'deleted' | 'modified' | 'renamed' | 'untracked' | 'added';

/**
 * 状态 → 展示词表的单一事实源（badge 字母 / Badge variant / 文字色 / 圆点色）。
 *
 * 颜色惯例（需求演进记录）：对齐 JetBrains 官方文件状态色 —— added=绿、
 * modified/renamed=蓝、untracked(Unversioned)=砖红（accent-brick）、deleted=橙、
 * conflict=亮红（accent-red）、ignored=灰。badge/variant 为 PR 变更树的 diff
 * 徽标体系（M/A/D 黄绿红），不随工作树文字色变动。
 */
const STATUS_PRESENTATION: Record<
  DominantStatus,
  { badge: BadgeLetter; variant: StatusVariant; textClass: string; dotClass: string }
> = {
  conflict: {
    badge: '!',
    variant: 'deleted',
    textClass: 'text-accent-red',
    dotClass: 'bg-accent-red',
  },
  deleted: {
    badge: 'D',
    variant: 'deleted',
    textClass: 'text-accent-orange',
    dotClass: 'bg-accent-orange',
  },
  modified: {
    badge: 'M',
    variant: 'modified',
    textClass: 'text-accent-blue',
    dotClass: 'bg-accent-blue',
  },
  renamed: {
    badge: 'R',
    variant: 'default',
    textClass: 'text-accent-blue',
    dotClass: 'bg-accent-blue',
  },
  untracked: {
    badge: 'U',
    variant: 'default',
    textClass: 'text-accent-brick',
    dotClass: 'bg-accent-brick',
  },
  added: {
    badge: 'A',
    variant: 'added',
    textClass: 'text-accent-green',
    dotClass: 'bg-accent-green',
  },
};

// ─── Monoid ───────────────────────────────────────────────────────────────────

export function zeroSummary(): GitStatusSummary {
  return {
    staged: { added: 0, modified: 0, deleted: 0 },
    unstaged: { added: 0, modified: 0, deleted: 0 },
    renamed: 0,
    untracked: 0,
    conflict: 0,
  };
}

export function addSummary(a: GitStatusSummary, b: GitStatusSummary): GitStatusSummary {
  return {
    staged: {
      added: a.staged.added + b.staged.added,
      modified: a.staged.modified + b.staged.modified,
      deleted: a.staged.deleted + b.staged.deleted,
    },
    unstaged: {
      added: a.unstaged.added + b.unstaged.added,
      modified: a.unstaged.modified + b.unstaged.modified,
      deleted: a.unstaged.deleted + b.unstaged.deleted,
    },
    renamed: a.renamed + b.renamed,
    untracked: a.untracked + b.untracked,
    conflict: a.conflict + b.conflict,
  };
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

/** 路径归一化：反斜杠 → 正斜杠（Windows 下 git 可能输出反斜杠） */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function hasDeleted(s: GitStatusSummary): boolean {
  return s.staged.deleted + s.unstaged.deleted > 0;
}

function hasModified(s: GitStatusSummary): boolean {
  return s.staged.modified + s.unstaged.modified > 0;
}

function hasAdded(s: GitStatusSummary): boolean {
  return s.staged.added + s.unstaged.added > 0;
}

/** 主导状态判定（优先级：conflict > deleted > modified > renamed > untracked > added） */
function dominantStatus(s: GitStatusSummary): DominantStatus | null {
  if (s.conflict > 0) return 'conflict';
  if (hasDeleted(s)) return 'deleted';
  if (hasModified(s)) return 'modified';
  if (s.renamed > 0) return 'renamed';
  if (s.untracked > 0) return 'untracked';
  if (hasAdded(s)) return 'added';
  return null;
}

/** 单一 FileChange.status → summary（确定性落入 unstaged 桶，见文件头临时语义标注） */
function fileChangeToSummary(status: FileChange['status']): GitStatusSummary {
  const s = zeroSummary();
  switch (status) {
    case 'Added':
      s.unstaged.added = 1;
      break;
    case 'Modified':
      s.unstaged.modified = 1;
      break;
    case 'Renamed':
      s.renamed = 1;
      break;
    case 'Deleted':
      s.unstaged.deleted = 1;
      break;
    case 'Untracked':
      s.untracked = 1;
      break;
  }
  return s;
}

/**
 * ignoredSet 判定：沿祖先链逐级上行匹配。
 * `9dbd7255` 对忽略目录做剪枝后，深层后代不在集合内，仅自查命中必漏；
 * 语义等价于已删除的 FileTreeNode.parentIgnored 继承谓词。
 */
/**
 * 收集「折叠 untracked 目录条目」（Rust 不递归 untracked，目录以尾斜杠单条输出）。
 * 归一化后按字典序排序，供 resolveDecoration 二分前缀匹配：把目录态色下传
 * 给已展开可见的后代节点 —— 否则折叠目录内部的深层文件无任何状态提示。
 */
export function collectCollapsedDirs(files: FileChange[]): string[] {
  const dirs = files.map((f) => normalizePath(f.path)).filter((p) => p.endsWith('/'));
  dirs.sort();
  return dirs;
}

/**
 * 二分查找包含 path 的最近折叠目录前缀（条目均带尾斜杠，天然排除兄弟误匹配）。
 * 返回命中的目录条目路径，未命中返回 null。
 */
function findInheritedCollapsedDir(
  path: string,
  collapsedDirs: ReadonlyArray<string> | undefined,
): string | null {
  if (!collapsedDirs || collapsedDirs.length === 0) return null;
  let lo = 0;
  let hi = collapsedDirs.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((collapsedDirs[mid] as string) <= path) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const prefix = idx >= 0 ? (collapsedDirs[idx] as string) : null;
  return prefix !== null && path.startsWith(prefix) ? prefix : null;
}

function isPathIgnored(path: string, ignoredSet: ReadonlySet<string> | undefined): boolean {
  if (!ignoredSet || ignoredSet.size === 0) return false;
  const parts = normalizePath(path).split('/');
  // 从完整路径逐级上溯到首个祖先段
  for (let i = parts.length; i >= 1; i--) {
    if (ignoredSet.has(parts.slice(0, i).join('/'))) return true;
  }
  return false;
}

// ─── 公开派生函数 ─────────────────────────────────────────────────────────────

/**
 * 文件级聚合：changed → Map<path, GitStatusSummary>（同 path 多条目 monoid 合并）。
 */
export function buildFileSummaryMap(changed: FileChange[]): Map<string, GitStatusSummary> {
  const out = new Map<string, GitStatusSummary>();
  for (const f of changed) {
    const key = normalizePath(f.path);
    const s = fileChangeToSummary(f.status);
    const prev = out.get(key);
    out.set(key, prev ? addSummary(prev, s) : s);
  }
  return out;
}

/**
 * 目录聚合：对每个变更文件按 `/` 分段向上累加全部祖先目录（含根段）。
 * deleted 不向目录传播（对齐 Orca shouldPropagateStatus）——删除文件正在消失，
 * 无需在父目录上提示。基于 changed 全集而非展开态：未展开深层祖先也携带摘要。
 */
export function buildFolderSummaryMap(
  fileSummaries: Map<string, GitStatusSummary>,
): Map<string, GitStatusSummary> {
  const out = new Map<string, GitStatusSummary>();
  for (const [path, s] of fileSummaries) {
    // 剥离 deleted 桶后若为空则跳过（纯 deleted 文件不传播）
    const propagated: GitStatusSummary = {
      staged: { ...s.staged, deleted: 0 },
      unstaged: { ...s.unstaged, deleted: 0 },
      renamed: s.renamed,
      untracked: s.untracked,
      conflict: s.conflict,
    };
    if (dominantStatus(propagated) === null) continue;

    const parts = path.split('/');
    // 逐级上溯祖先（不含文件自身），含根段（首段）
    for (let i = parts.length - 1; i >= 1; i--) {
      const dirPath = parts.slice(0, i).join('/');
      const prev = out.get(dirPath);
      out.set(dirPath, prev ? addSummary(prev, propagated) : { ...propagated });
    }
  }
  return out;
}

/** summary → 行尾徽标（badge 字母 + Badge variant）；无状态返回 null */
export function summaryToBadge(
  s: GitStatusSummary,
): { badge: BadgeLetter; variant: StatusVariant } | null {
  const d = dominantStatus(s);
  if (d === null) return null;
  const p = STATUS_PRESENTATION[d];
  return { badge: p.badge, variant: p.variant };
}

/**
 * 文件名着色 class。优先级：
 * `active(accent) > conflict > deleted > modified > untracked > added > ignored(dimmed) > 默认`
 */
export function summaryToLabelClass(
  s: GitStatusSummary,
  ignored: boolean,
  active: boolean,
): string {
  if (active) return 'text-accent';
  const d = dominantStatus(s);
  if (d !== null) return STATUS_PRESENTATION[d].textClass;
  if (ignored) return 'text-text-muted';
  return 'text-text-primary';
}

/** 圆点色 class（PR 变更树 status dot 用）；无状态返回空串 */
export function summaryToDotClass(s: GitStatusSummary): string {
  const d = dominantStatus(s);
  if (d === null) return '';
  return STATUS_PRESENTATION[d].dotClass;
}

/**
 * 纯函数投影：path → Decoration。
 * - 文件取自身摘要、目录取文件夹摘要；
 * - ignoredSet 判定沿祖先链逐级上行匹配；
 * - ignored 与变更共存时 git 状态优先（不灰化）。
 */
export function resolveDecoration(
  path: string,
  isDir: boolean,
  fileSummaries: ReadonlyMap<string, GitStatusSummary>,
  folderSummaries: ReadonlyMap<string, GitStatusSummary>,
  ignoredSet: ReadonlySet<string> | undefined,
  isActive: boolean,
  /** 折叠 untracked 目录条目（collectCollapsedDirs 产物）；后代节点继承目录态色 */
  collapsedDirs?: ReadonlyArray<string>,
): Decoration | null {
  const norm = normalizePath(path);
  const s = isDir ? folderSummaries.get(norm) : fileSummaries.get(norm);

  if (s) {
    const badge = summaryToBadge(s);
    // 有状态则非空（buildFileSummaryMap 不产空 summary）；防御空 summary 回落
    if (badge) {
      return {
        color: summaryToLabelClass(s, isPathIgnored(norm, ignoredSet), isActive),
        badge: badge.badge,
        variant: badge.variant,
        dot: summaryToDotClass(s),
        dimmed: false,
      };
    }
  }

  // 折叠 untracked 目录的后代继承：深层可见节点无自身/祖先摘要时，
  // 从包裹它的折叠目录条目继承目录态色（与 git 状态优先于 ignored 的次序一致）
  const inheritedDir = findInheritedCollapsedDir(norm, collapsedDirs);
  if (inheritedDir) {
    // 匹配键保留尾斜杠（防兄弟误匹配）；folder 聚合的键不含尾斜杠，取值前剥离
    const inheritedSummary = folderSummaries.get(inheritedDir.replace(/\/+$/, ''));
    const badge = inheritedSummary ? summaryToBadge(inheritedSummary) : null;
    if (inheritedSummary && badge) {
      return {
        color: summaryToLabelClass(inheritedSummary, isPathIgnored(norm, ignoredSet), isActive),
        badge: badge.badge,
        variant: badge.variant,
        dot: summaryToDotClass(inheritedSummary),
        dimmed: false,
      };
    }
  }

  if (isPathIgnored(norm, ignoredSet)) {
    // 被忽略的激活文件仍保持 accent 高亮（对齐激活优先的既有行为）
    return { color: isActive ? 'text-accent' : 'text-text-muted', dimmed: true };
  }
  if (isActive) {
    return { color: 'text-accent', dimmed: false };
  }
  return null;
}

// ─── 实例复用缓存（P3：memo 稳定性） ─────────────────────────────────────────

function decorationsEqual(a: Decoration | null, b: Decoration | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.color === b.color &&
    a.badge === b.badge &&
    a.variant === b.variant &&
    a.dot === b.dot &&
    a.tooltip === b.tooltip &&
    a.dimmed === b.dimmed
  );
}

export interface DecorationResolver {
  resolve: typeof resolveDecoration;
}

/**
 * 跨快照的实例复用缓存工厂。
 *
 * 重新解析时，结构等值（color/badge/dimmed/tooltip 全等）的 Decoration 沿用上一个实例，
 * 保证未受影响节点的 props 浅比较持续命中 React.memo——无此机制则每次刷新所有节点拿到新对象、
 * memo 全军覆没。status 真变的路径才产出新实例；active 只影响激活节点自身（其颜色折叠进
 * color 参与等值比较，非激活节点不受 active 变化扰动）。
 *
 * 缓存按 path 键控 + 结构等值比较：不同文件树/多项目并存不会串数据——装饰值是纯不可变值，
 * 等值复用无身份语义；值不同则必然产出新实例。
 */
export function createDecorationResolver(): DecorationResolver {
  const cache = new Map<string, Decoration | null>();
  return {
    resolve(path, isDir, fileSummaries, folderSummaries, ignoredSet, isActive, collapsedDirs) {
      const fresh = resolveDecoration(
        path,
        isDir,
        fileSummaries,
        folderSummaries,
        ignoredSet,
        isActive,
        collapsedDirs,
      );
      if (cache.has(path) && decorationsEqual(cache.get(path)!, fresh)) {
        return cache.get(path)!;
      }
      cache.set(path, fresh);
      return fresh;
    },
  };
}

/**
 * 进程级共享 resolver 单例（惰性创建）。
 *
 * 全局共享是安全的：缓存按 path 键控 + 结构等值复用，Decoration 是纯不可变值 ——
 * 多文件树/多项目并存互不串数据（等值判断发生在每次调用处），最坏情形只是
 * 复用率被交替解析稀释，语义永不失真。FilesPanel 作为唯一消费入口使用本单例。
 */
export interface SharedDecorationResolver {
  /**
   * 渲染期发布本轮提交的最新派生输入；resolve 在同一提交内读取 —— 保证根节点与
   * 递归子节点解析看到同一份数据。模块级可变寄存器非渲染作用域闭包变量，
   * 不受 react-hooks/immutability 约束；幂等后写覆盖前写，并发渲染语义单调向前。
   */
  publish(
    fileSummaries: ReadonlyMap<string, GitStatusSummary>,
    folderSummaries: ReadonlyMap<string, GitStatusSummary>,
    ignoredSet?: ReadonlySet<string>,
    collapsedDirs?: ReadonlyArray<string>,
  ): void;
  resolve(path: string, isDir: boolean, isActive: boolean): Decoration | null;
}

let sharedResolverInstance: SharedDecorationResolver | null = null;

export function getSharedDecorationResolver(): SharedDecorationResolver {
  if (!sharedResolverInstance) {
    const base = createDecorationResolver();
    let snapshot: {
      fileSummaries: ReadonlyMap<string, GitStatusSummary>;
      folderSummaries: ReadonlyMap<string, GitStatusSummary>;
      ignoredSet?: ReadonlySet<string>;
      collapsedDirs?: ReadonlyArray<string>;
    } = {
      fileSummaries: new Map<string, GitStatusSummary>(),
      folderSummaries: new Map<string, GitStatusSummary>(),
      ignoredSet: undefined as ReadonlySet<string> | undefined,
      collapsedDirs: undefined as ReadonlyArray<string> | undefined,
    };
    sharedResolverInstance = {
      publish(fileSummaries, folderSummaries, ignoredSet, collapsedDirs) {
        if (
          snapshot.fileSummaries === fileSummaries &&
          snapshot.folderSummaries === folderSummaries &&
          snapshot.ignoredSet === ignoredSet &&
          snapshot.collapsedDirs === collapsedDirs
        ) {
          // 引用等值：本轮输入与已发布快照完全相同，跳过重写（渲染期副作用最小化）。
          // 快照不变 → 同 pass resolve 结果与上次一致（RenderCount 不变式不破坏）。
          return;
        }
        snapshot = { fileSummaries, folderSummaries, ignoredSet, collapsedDirs };
      },
      resolve(path, isDir, isActive) {
        return base.resolve(
          path,
          isDir,
          snapshot.fileSummaries,
          snapshot.folderSummaries,
          snapshot.ignoredSet,
          isActive,
          snapshot.collapsedDirs,
        );
      },
    };
  }
  return sharedResolverInstance;
}
