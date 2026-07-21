/**
 * Soft pastel-like chips using theme-aware translucent colors
 * (works on dark Neeko themes; mirrors Skills Manager chip variety).
 */
const TAG_PALETTE = [
  'bg-sky-500/20 text-sky-300',
  'bg-violet-500/20 text-violet-300',
  'bg-emerald-500/20 text-emerald-300',
  'bg-amber-500/20 text-amber-300',
  'bg-rose-500/20 text-rose-300',
  'bg-cyan-500/20 text-cyan-300',
  'bg-fuchsia-500/20 text-fuchsia-300',
  'bg-orange-500/20 text-orange-300',
  'bg-lime-500/20 text-lime-300',
  'bg-indigo-500/20 text-indigo-300',
] as const;

const PRESET_PALETTE = [
  'bg-amber-500/15 text-amber-400',
  'bg-emerald-500/15 text-emerald-400',
  'bg-violet-500/15 text-violet-400',
  'bg-rose-500/15 text-rose-400',
  'bg-cyan-500/15 text-cyan-400',
  'bg-lime-500/15 text-lime-400',
  'bg-fuchsia-500/15 text-fuchsia-400',
  'bg-indigo-500/15 text-indigo-400',
  'bg-pink-500/15 text-pink-400',
  'bg-sky-500/15 text-sky-400',
] as const;

function hashTag(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) % 1000000007;
  }
  return h;
}

export function tagChipClass(tag: string): string {
  return TAG_PALETTE[hashTag(tag) % TAG_PALETTE.length];
}

export function presetBadgeClass(name: string): string {
  return PRESET_PALETTE[hashTag(name) % PRESET_PALETTE.length];
}
