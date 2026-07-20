/** Soft tag chips using theme-friendly accent tokens (no fixed light-mode pastels). */
const TAG_PALETTE = [
  'bg-accent/15 text-accent border-accent/25',
  'bg-sky-500/15 text-sky-400 border-sky-500/25',
  'bg-violet-500/15 text-violet-400 border-violet-500/25',
  'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  'bg-amber-500/15 text-amber-400 border-amber-500/25',
  'bg-rose-500/15 text-rose-400 border-rose-500/25',
  'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/25',
] as const;

function hashTag(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function tagChipClass(tag: string): string {
  return TAG_PALETTE[hashTag(tag) % TAG_PALETTE.length];
}
