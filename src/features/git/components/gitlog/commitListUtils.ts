/** Pure helpers for Git Log commit list presentation. */

export function parseCommitMessage(message: string): {
  type: string;
  scope: string;
  subject: string;
  /** First-line header, useful for tooltips. */
  header: string;
} {
  const header = message.split('\n')[0].trim();
  // type(scope)!: subject  |  type: subject
  const m = header.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)/);
  if (m) {
    return {
      type: m[1],
      scope: (m[2] ?? '').trim(),
      subject: m[4],
      header,
    };
  }
  return { type: '', scope: '', subject: header, header };
}

/** Optional body preview: lines after header, skip leading blanks, max 2 lines. */
export function commitBodyPreview(message: string, maxLines = 2): string {
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  let rest = lines.slice(1);
  while (rest.length > 0 && rest[0].trim() === '') rest = rest.slice(1);
  if (rest.length === 0) return '';
  return rest.slice(0, maxLines).join('\n').trimEnd();
}

export function typeStyle(type: string): string {
  switch (type) {
    case 'feat':
      return 'bg-accent-blue/15 text-accent-blue';
    case 'fix':
    case 'revert':
      return 'bg-accent-red/15 text-accent-red';
    case 'perf':
      return 'bg-accent-green/15 text-accent-green';
    case 'refactor':
      return 'bg-accent-blue/10 text-accent-blue';
    case 'docs':
      return 'bg-accent-yellow/15 text-accent-yellow';
    case 'test':
      return 'bg-accent-green/10 text-accent-green';
    case 'ci':
    case 'build':
      return 'bg-bg-tertiary text-text-secondary';
    case 'chore':
    case 'style':
      return 'bg-bg-tertiary text-text-muted';
    default:
      return 'bg-bg-tertiary text-text-muted';
  }
}

export interface RefPills {
  primary: string;
  extraCount: number;
  title: string;
}

/** Prefer HEAD target, then local branch, then tag, then remote. */
export function formatRefs(refs: string): RefPills | null {
  const parts = refs
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const labels: string[] = [];
  for (const p of parts) {
    const arrow = p.match(/HEAD\s*->\s*(.+)/);
    if (arrow) {
      labels.push(arrow[1].trim());
      continue;
    }
    if (p === 'HEAD') {
      labels.push('HEAD');
      continue;
    }
    if (p.startsWith('tag:')) {
      labels.push(p.replace(/^tag:\s*/, '').trim());
      continue;
    }
    labels.push(p);
  }

  const unique = Array.from(new Set(labels.filter(Boolean)));
  if (unique.length === 0) return null;
  return {
    primary: unique[0],
    extraCount: Math.max(0, unique.length - 1),
    title: unique.join(', '),
  };
}

/** Absolute timestamp for title tooltip. */
export function formatAbsoluteTime(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${Y}/${M}/${D} ${h}:${m}`;
  } catch {
    return ts;
  }
}

/**
 * Relative time for narrow rows. Uses `now` for testability.
 * Examples: just now · 5m ago · 3h ago · yesterday · 3d ago · 2w ago · 2026/03/01
 */
export function formatRelativeTime(ts: string, now: Date = new Date()): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 0) return formatAbsoluteTime(ts);

    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;

    const day = Math.floor(hr / 24);
    if (day === 1) return 'yesterday';
    if (day < 7) return `${day}d ago`;
    if (day < 30) return `${Math.floor(day / 7)}w ago`;
    if (day < 365) return `${Math.floor(day / 30)}mo ago`;
    return formatAbsoluteTime(ts);
  } catch {
    return ts;
  }
}

/** Split a file path into basename + directory (posix or windows separators). */
export function splitFilePath(filePath: string): { name: string; dir: string } {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return { name: filePath, dir: '' };
  return {
    name: normalized.slice(idx + 1) || filePath,
    dir: normalized.slice(0, idx),
  };
}

/** Graph lane cap so multi-branch history does not starve commit text. */
export const MAX_GRAPH_LANES = 5;

/** Default gap between commit dot right edge and text. */
export const TEXT_AFTER_DOT_GAP = 4;

/**
 * Horizontal inset so commit text sits just after its own graph dot
 * (not after the full multi-lane graph width).
 * dot center X = col * branchSpacing + nodeRadius * 2
 */
export function textLeftForCol(
  col: number,
  branchSpacing: number,
  nodeRadius: number,
  gap = TEXT_AFTER_DOT_GAP,
): number {
  const dotX = col * branchSpacing + nodeRadius * 2;
  return dotX + nodeRadius + gap;
}

export function graphWidthForCols(
  maxColUsed: number,
  branchSpacing: number,
  nodeRadius: number,
  maxLanes = MAX_GRAPH_LANES,
): { fullWidth: number; visibleWidth: number } {
  const cols = Math.max(maxColUsed + 1, 1);
  const fullWidth = cols * branchSpacing + nodeRadius * 4 + 2;
  const visibleCols = Math.min(cols, maxLanes);
  const visibleWidth = visibleCols * branchSpacing + nodeRadius * 4 + 2;
  return { fullWidth, visibleWidth };
}
