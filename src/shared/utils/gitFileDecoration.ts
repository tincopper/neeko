import type { FileChange, FileTreeGitStatus } from '@/shared/types';

/**
 * git 状态装饰的唯一公开面（单一事实源）。
 *
 * 消费方横跨三层：主 Explorer（features/file）、PR 变更树（shared/components/ChangeFileTree，
 * 被 features/git 的 PRFileTree 间接消费）、未来 tab-bar。因此落位 `shared/utils`，
 * 避免 shared/components 反向依赖 feature 内部实现（违反分层红线）。
 *
 * ## XY 语义标注（G6 转真）
 * 后端已按 porcelain 契约输出 X/Y（`index_status` / `worktree_status`）：
 * X → `staged` 桶、Y → `unstaged` 桶、X=Y='?' → `untracked`、未合并 → `conflict`。
 * 缺 XY 的旧 payload 回退单一 status 映射（确定性落入 unstaged 桶）。
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
 *
 * S3 起文件树（FilesPanel/FileTreeRow）已改为组装期盖章 + 节点字段直读，
 * 不再使用该回调契约；类型保留供过渡期消费方引用，新增消费方禁止使用。
 */
export type ResolveNodeDecoration = (
  path: string,
  isDir: boolean,
  isActive: boolean,
) => Decoration | null;

/** 主导状态（优先级序）：conflict > deleted > modified > renamed > untracked > added。
 * 与 shared/types 的 FileTreeGitStatus 同一词表（视图节点 git_status 字段的类型）。 */
type DominantStatus = FileTreeGitStatus;

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

/** 未合并组合（G6 XY 词表）：任一侧 U，或 AA / DD */
function isUnmergedXy(x: string, y: string): boolean {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
}

/**
 * FileChange → summary（G6 XY 契约版）：
 * - 携带 porcelain XY 时按词表分桶：X → staged 桶（A/M/D/T；R 独立 renamed 计数）、
 *   Y → unstaged 桶（M/D/T；R 计入 renamed）、X=Y='?' → untracked、未合并 → conflict
 *   —— 文件头「staged 恒 0」的临时语义自此转真；
 * - 缺 XY 的旧 payload 回退单一 status 映射（确定性落入 unstaged 桶）。
 */
function fileChangeToSummary(f: FileChange): GitStatusSummary {
  const s = zeroSummary();
  const x = f.index_status;
  const y = f.worktree_status;
  if (x !== undefined && y !== undefined) {
    if (isUnmergedXy(x, y)) {
      s.conflict = 1;
      return s;
    }
    if (x === '?' && y === '?') {
      s.untracked = 1;
      return s;
    }
    switch (x) {
      case 'A':
        s.staged.added = 1;
        break;
      case 'M':
      case 'T':
        s.staged.modified = 1;
        break;
      case 'D':
        s.staged.deleted = 1;
        break;
      case 'R':
        s.renamed = 1;
        break;
      default:
        break;
    }
    switch (y) {
      case 'M':
      case 'T':
        s.unstaged.modified = 1;
        break;
      case 'D':
        s.unstaged.deleted = 1;
        break;
      case 'R':
        s.renamed = s.renamed + 1;
        break;
      default:
        break;
    }
    return s;
  }
  switch (f.status) {
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
 * 收集「折叠 untracked 目录条目」（Rust 不递归 untracked，目录以单条目输出；
 * G1 起显式 `is_dir` 字段，path 无尾斜杠）。输出统一为无尾斜杠目录路径
 * （旧 payload 斜杠条目在此归一化），按字典序排序，供 resolveDecoration
 * 二分前缀匹配：把目录态色下传给已展开可见的后代节点 —— 否则折叠目录内部的
 * 深层文件无任何状态提示。
 */
export function collectCollapsedDirs(files: FileChange[]): string[] {
  const dirs = files
    .filter((f) => f.is_dir ?? f.path.endsWith('/'))
    .map((f) => normalizePath(f.path).replace(/\/+$/, ''))
    .filter((p) => p !== '');
  dirs.sort();
  return dirs;
}

/**
 * 二分查找包含 path 的最近折叠目录前缀（无尾斜杠目录路径，命中判定带目录边界
 * `path === prefix || startsWith(prefix + '/')`，排除兄弟目录前缀误匹配）。
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
  return prefix !== null && (path === prefix || path.startsWith(`${prefix}/`)) ? prefix : null;
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
    const s = fileChangeToSummary(f);
    const prev = out.get(key);
    out.set(key, prev ? addSummary(prev, s) : s);
  }
  return out;
}

/**
 * 目录聚合：对每个变更文件按 `/` 分段向上累加全部祖先目录（含根段）。
 * deleted 不向目录传播（对齐 Orca shouldPropagateStatus）——删除文件正在消失，
 * 无需在父目录上提示。基于 changed 全集而非展开态：未展开深层祖先也携带摘要。
 *
 * G1 说明：折叠 untracked 目录条目为「无尾斜杠 path + is_dir」后，split 不再
 * 产生其自身目录 key（旧版靠尾斜杠路径的空尾段巧合产出），因此调用方需把
 * `collectCollapsedDirs` 的产物传入 `collapsedDirs`，目录自身才会携带状态色，
 * 后代节点才能经 findInheritedCollapsedDir 继承。
 */
export function buildFolderSummaryMap(
  fileSummaries: Map<string, GitStatusSummary>,
  collapsedDirs?: ReadonlyArray<string>,
): Map<string, GitStatusSummary> {
  const out = new Map<string, GitStatusSummary>();

  // 折叠目录条目自身：以目录身份携带状态（自身作为 folder key）
  if (collapsedDirs) {
    for (const dir of collapsedDirs) {
      const s = fileSummaries.get(dir);
      if (!s) continue;
      const propagated = stripDeletedPropagation(s);
      if (dominantStatus(propagated) === null) continue;
      out.set(dir, propagated);
    }
  }

  for (const [path, s] of fileSummaries) {
    // 剥离 deleted 桶后若为空则跳过（纯 deleted 文件不传播）
    const propagated = stripDeletedPropagation(s);
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

/** 拷贝 summary 并剥离 deleted 桶（供目录传播，删除不向父目录扩散） */
function stripDeletedPropagation(s: GitStatusSummary): GitStatusSummary {
  return {
    staged: { ...s.staged, deleted: 0 },
    unstaged: { ...s.unstaged, deleted: 0 },
    renamed: s.renamed,
    untracked: s.untracked,
    conflict: s.conflict,
  };
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

// ─── 语义状态判定（S3 组装期 join 核心）─────────────────────────────────────

/** 单节点语义状态判定结果：`status` 为主导状态（null = 无 git 状态）；
 * `ignored` 是「被忽略」的**原始事实**（与状态共存时呈现层让状态优先） */
export interface NodeGitStatus {
  status: FileTreeGitStatus | null;
  ignored: boolean;
}

/** `resolveNodeStatus` 的输入投影（FilesPanel 由派生 map 构建后注入组装回调） */
export interface NodeStatusInputs {
  fileSummaries: ReadonlyMap<string, GitStatusSummary>;
  folderSummaries: ReadonlyMap<string, GitStatusSummary>;
  ignoredSet?: ReadonlySet<string>;
  collapsedDirs?: ReadonlyArray<string>;
}

/**
 * 单节点语义状态判定（纯函数，呈现之前的全部逻辑）：
 * 1. 文件取自身摘要、目录取 folderSummaries 聚合（含折叠目录自身 key；
 *    deleted 已在构建期剥离、未展开深层祖先基于 changed 全集携带摘要）；
 * 2. 折叠 untracked 目录的可见后代经 findInheritedCollapsedDir 二分前缀继承目录态；
 * 3. ignored 判定沿祖先链逐级上行（isPathIgnored）。
 *
 * `resolveDecoration`（PR 树消费）与本函数共享同一语义核心——语义改这里，
 * 呈现改 statusToNameColorClass / Decoration 投影，二者不得各持一份判定。
 */
export function resolveNodeStatus(
  path: string,
  isDir: boolean,
  inputs: NodeStatusInputs,
): NodeGitStatus {
  const norm = normalizePath(path);
  const ignored = isPathIgnored(norm, inputs.ignoredSet);

  const s = isDir ? inputs.folderSummaries.get(norm) : inputs.fileSummaries.get(norm);
  // 有状态则非空（buildFileSummaryMap 不产空 summary）；防御空 summary 回落
  if (s && summaryToBadge(s)) {
    return { status: dominantStatus(s), ignored };
  }

  // 折叠 untracked 目录的后代继承：深层可见节点无自身/祖先摘要时，
  // 从包裹它的折叠目录条目继承目录态（与 git 状态优先于 ignored 的次序一致）
  const inheritedDir = findInheritedCollapsedDir(norm, inputs.collapsedDirs);
  if (inheritedDir) {
    const inheritedSummary = inputs.folderSummaries.get(inheritedDir);
    if (inheritedSummary && summaryToBadge(inheritedSummary)) {
      return { status: dominantStatus(inheritedSummary), ignored };
    }
  }

  return { status: null, ignored };
}

/**
 * 文件树叶子级名字色（呈现派生）。优先级链单处收敛（词表封闭约定不变）：
 * `active(accent) > conflict > deleted > modified > renamed > untracked > added >
 * ignored(dimmed) > 默认`
 */
export function statusToNameColorClass(
  status: FileTreeGitStatus | null | undefined,
  ignored: boolean,
  isActive: boolean,
): string {
  if (isActive) return 'text-accent';
  if (status) return STATUS_PRESENTATION[status].textClass;
  if (ignored) return 'text-text-muted';
  return 'text-text-primary';
}

/**
 * 纯函数投影：path → Decoration（PR 变更树消费）。
 * 语义判定委托 resolveNodeStatus，本函数只做 Decoration 形状投影。
 * - 文件取自身摘要、目录取文件夹摘要；
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
  const { status, ignored } = resolveNodeStatus(path, isDir, {
    fileSummaries,
    folderSummaries,
    ignoredSet,
    collapsedDirs,
  });

  if (status) {
    const p = STATUS_PRESENTATION[status];
    return {
      color: statusToNameColorClass(status, ignored, isActive),
      badge: p.badge,
      variant: p.variant,
      dot: p.dotClass,
      dimmed: false,
    };
  }

  if (ignored) {
    // 被忽略的激活文件仍保持 accent 高亮（对齐激活优先的既有行为）
    return { color: isActive ? 'text-accent' : 'text-text-muted', dimmed: true };
  }
  if (isActive) {
    return { color: 'text-accent', dimmed: false };
  }
  return null;
}
