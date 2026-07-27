import type { ActionContext, ActionRegistryItem } from '../types/actionMenu';

export function filterActions(
  items: ActionRegistryItem[],
  query: string,
  ctx: ActionContext,
): ActionRegistryItem[] {
  const visible = items.filter((item) => !item.visible || item.visible(ctx));
  if (!query.trim()) return visible;

  const lower = query.toLowerCase();
  return visible.filter((item) => {
    if (item.label.toLowerCase().includes(lower)) return true;
    if (item.description?.toLowerCase().includes(lower)) return true;
    if (item.keywords.some((k) => k.toLowerCase().includes(lower))) return true;
    return false;
  });
}
