/**
 * Tag / preset chip colors using Neeko theme tokens only
 * (accent + surface vars from theme.css — no hard-coded Tailwind palette).
 */
const TAG_PALETTE = [
  'bg-accent-blue/15 text-accent-blue',
  'bg-bg-selected text-text-secondary',
  'bg-accent-green/15 text-accent-green',
  'bg-accent-yellow/15 text-accent-yellow',
  'bg-bg-hover text-text-secondary',
  'bg-accent-blue/10 text-text-secondary',
  'bg-accent-red/12 text-accent-red',
  'bg-bg-tertiary text-text-muted',
  'bg-accent-green/10 text-text-secondary',
  'bg-accent-yellow/10 text-text-secondary',
] as const;

const PRESET_PALETTE = [
  'bg-accent-blue/15 text-accent-blue',
  'bg-accent-green/15 text-accent-green',
  'bg-bg-selected text-text-secondary',
  'bg-accent-yellow/15 text-accent-yellow',
  'bg-bg-hover text-text-secondary',
  'bg-accent-red/12 text-accent-red',
  'bg-bg-tertiary text-text-muted',
  'bg-accent-blue/10 text-text-secondary',
  'bg-accent-green/10 text-text-secondary',
  'bg-bg-selected text-text-muted',
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
