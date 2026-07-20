/**
 * Lightweight fuzzy score for path/file name search (Goto File / Recent).
 * Higher score = better match. -1 = no match.
 */

export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();

  // Substring boost
  const idx = t.indexOf(q);
  if (idx >= 0) {
    let score = 1000 - idx;
    // Prefer matches on file name (after last /)
    const base = t.split('/').pop() ?? t;
    if (base.includes(q)) score += 200;
    if (base.startsWith(q)) score += 100;
    return score;
  }

  // Sequential character match
  let ti = 0;
  let score = 0;
  let consecutive = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    if (found === ti) {
      consecutive += 1;
      score += 10 + consecutive * 5;
    } else {
      consecutive = 0;
      score += 2;
    }
    // Path segment start
    if (found === 0 || t[found - 1] === '/' || t[found - 1] === '_' || t[found - 1] === '-') {
      score += 15;
    }
    ti = found + 1;
  }
  return score;
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  limit = 80,
): T[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit);

  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = fuzzyScore(q, getText(item));
    if (score >= 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}
