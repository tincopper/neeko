import type { ConversationMeta } from '../types';

export interface ConversationGroup {
  /** Stable key for React lists (e.g. "today", "2026-07"). */
  key: string;
  /** Display label shown in the sticky group header. */
  label: string;
  items: ConversationMeta[];
}

const DAY = 86_400_000;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Midnight (local) for the given timestamp. */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Bucket conversations into relative date groups following the Cloudscape
 * GenAI-history convention: Today / Yesterday / Previous 7 Days /
 * Previous 30 Days, then absolute "Month Year" for older entries.
 *
 * Input order is preserved within each group, so callers should sort by
 * `updatedAt` desc beforehand for a most-recent-first list.
 */
export function groupConversationsByDate(
  conversations: ConversationMeta[],
  now: number = Date.now(),
): ConversationGroup[] {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - DAY;
  const last7Start = todayStart - 7 * DAY;
  const last30Start = todayStart - 30 * DAY;

  const groups: ConversationGroup[] = [];
  const byKey = new Map<string, ConversationGroup>();

  const push = (key: string, label: string, item: ConversationMeta) => {
    let g = byKey.get(key);
    if (!g) {
      g = { key, label, items: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.items.push(item);
  };

  for (const c of conversations) {
    const ts = c.updatedAt;
    if (ts >= todayStart) {
      push('today', 'Today', c);
    } else if (ts >= yesterdayStart) {
      push('yesterday', 'Yesterday', c);
    } else if (ts >= last7Start) {
      push('last7', 'Previous 7 Days', c);
    } else if (ts >= last30Start) {
      push('last30', 'Previous 30 Days', c);
    } else {
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      push(key, label, c);
    }
  }

  return groups;
}
