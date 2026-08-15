/**
 * 编辑器标题栏面包屑（VS Code / IDEA 风格）纯函数。
 *
 * 两个职责（SRP）：
 * 1. `splitBreadcrumb` —— 把文件路径拆成「项目根 + 相对目录 + 文件名」；
 * 2. `collapseBreadcrumb` —— 在给定像素预算下决定可见段（折叠中间目录）。
 *
 * 纯函数、无 DOM 依赖；宽度测量通过 `measure` 注入，
 * 浏览器端传 canvas 测量，测试端传 stub —— 便于单测（TDD）。
 */

export interface BreadcrumbSegments {
  /** 项目根名称（根段显示）。文件在项目根外 / 无项目上下文时为 null。 */
  root: string | null;
  /** 相对路径目录（不含文件名）。 */
  dirs: string[];
  /** 文件名（始终完整展示）。 */
  fileName: string;
}

export type CrumbItem =
  | { kind: 'root'; text: string }
  | { kind: 'dir'; text: string }
  | { kind: 'more'; text: '…' }
  | { kind: 'file'; text: string };

export interface CollapseOptions {
  /** 文本宽度测量函数（像素）。 */
  measure: (text: string) => number;
  /** 根/文件段图标宽度（含间距），默认 18。 */
  iconWidth?: number;
  /** 目录段左右 padding，默认 8。 */
  dirPadding?: number;
  /** 分隔符（›）宽度含间距，默认 8。 */
  separatorWidth?: number;
}

const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');

/**
 * 把文件路径拆成面包屑三段。
 *
 * - 归一化 `\` → `/`、去掉末尾斜杠（兼容 Windows / WSL / SSH 路径）。
 * - 优先剥离 `projectPath` 前缀：根段显示项目名，剩余为相对目录 + 文件名。
 * - 剥离失败（文件在项目根外 / 无 projectPath）时按整条路径拆分，根段为 null。
 */
export function splitBreadcrumb(filePath: string, projectPath: string | null): BreadcrumbSegments {
  const fp = normalize(filePath || '');
  const root = projectPath ? normalize(projectPath) : null;
  // 绝对路径判定：Unix `/` 开头或 Windows 盘符
  const isAbsolute = /^\/|[A-Za-z]:[\\/]/.test(fp);

  let relative: string;
  let rootName: string | null = null;
  if (root && !isAbsolute) {
    // 相对路径：默认即相对项目根
    rootName = root.split('/').pop() || root;
    relative = fp;
  } else if (root && (fp === root || fp.startsWith(root + '/'))) {
    // 绝对路径且在项目根内：剥离根前缀
    rootName = root.split('/').pop() || root;
    relative = fp === root ? '' : fp.slice(root.length + 1);
  } else {
    // 项目根外绝对路径 / 无项目上下文：按整条路径拆分
    relative = fp;
  }

  const parts = relative.split('/').filter(Boolean);
  const fileName = parts.pop() ?? (fp || '');
  return { root: rootName, dirs: parts, fileName };
}

/**
 * 在像素预算内计算可见面包屑段。
 *
 * 折叠策略（VS Code / IDEA）：
 * 1. 全量放得下 → 全部展开；
 * 2. 放不下 → 保留 根 + `…` + 末级目录(尽量) + 文件名；
 *    预算更窄时退化为 根 + `…` + 文件名。
 * 文件名恒为末位且始终完整。
 */
export function collapseBreadcrumb(
  segs: BreadcrumbSegments,
  budgetPx: number,
  opts: CollapseOptions,
): CrumbItem[] {
  const { measure } = opts;
  const iconW = opts.iconWidth ?? 18;
  const dirPad = opts.dirPadding ?? 8;
  const sep = opts.separatorWidth ?? 8;

  const segW = (kind: CrumbItem['kind'], text: string): number => {
    const base = measure(text);
    return kind === 'root' || kind === 'file' ? base + iconW : base + dirPad;
  };

  const { root, dirs, fileName } = segs;
  const items: CrumbItem[] = [];
  let used = 0;
  const push = (item: CrumbItem) => {
    items.push(item);
    used += segW(item.kind, item.text) + sep;
  };

  // 全量宽度
  let full = 0;
  if (root) full += segW('root', root) + sep;
  for (const d of dirs) full += segW('dir', d) + sep;
  full += segW('file', fileName);

  // 1) 全部放得下
  if (full <= budgetPx) {
    if (root) push({ kind: 'root', text: root });
    for (const d of dirs) push({ kind: 'dir', text: d });
    push({ kind: 'file', text: fileName });
    return items;
  }

  // 2) 折叠：根 + … + 目录(尽量) + 文件名
  if (root) push({ kind: 'root', text: root });
  const budgetMid = budgetPx - used;
  const moreW = segW('more', '…') + sep;
  const fileW = segW('file', fileName);

  const head = dirs.slice(0, -1); // 除末级外的目录
  const tail = dirs.length ? [dirs[dirs.length - 1]] : []; // 末级目录

  if (budgetMid > moreW + fileW) {
    // 末级目录优先保留，其次从头回填，放不下的中间折叠成 …
    const tailKept: string[] = [];
    let acc = moreW + fileW;
    for (let i = tail.length - 1; i >= 0; i--) {
      const w = segW('dir', tail[i]) + sep;
      if (acc + w <= budgetMid) {
        tailKept.unshift(tail[i]);
        acc += w;
      } else {
        break;
      }
    }
    const headKept: string[] = [];
    for (const d of head) {
      const w = segW('dir', d) + sep;
      if (acc + w <= budgetMid) {
        headKept.push(d);
        acc += w;
      } else {
        break;
      }
    }
    push({ kind: 'more', text: '…' });
    for (const d of [...headKept, ...tailKept]) push({ kind: 'dir', text: d });
  } else {
    push({ kind: 'more', text: '…' });
  }
  push({ kind: 'file', text: fileName });
  return items;
}
