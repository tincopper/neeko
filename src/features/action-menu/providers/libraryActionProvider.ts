import { MessageSquare, Zap } from 'lucide-react';

import { listActions, listPrompts } from '@/features/library/api/libraryApi';
import type { ActionResource, PromptResource } from '@/shared/types/library';

import type { ActionRegistryItem, ActionContext } from '../types/actionMenu';

/** Max number of recent resources shown in the dynamic palette section. */
const MAX_RECENT = 5;

interface RecentItem {
  id: string;
  kind: 'prompt' | 'action';
  name: string;
  lastUsedAt: number;
}

/**
 * Build dynamic Action Palette items for recently-used prompts + actions.
 *
 * Reads the library store's prompts and actions, merges them by `lastUsedAt`,
 * and returns the top `MAX_RECENT` as palette items. Prompts insert into the
 * agent input; actions dispatch via the library store.
 */
export async function getLibraryActionItems(ctx: ActionContext): Promise<ActionRegistryItem[]> {
  try {
    const [prompts, actions] = await Promise.all([listPrompts(), listActions()]);
    return buildRecentItems(prompts, actions, ctx);
  } catch (e) {
    console.error('[libraryActionProvider] failed to load recent items:', e);
    return [];
  }
}

function buildRecentItems(
  prompts: PromptResource[],
  actions: ActionResource[],
  ctx: ActionContext,
): ActionRegistryItem[] {
  const items: RecentItem[] = [
    ...prompts
      .filter((p) => p.lastUsedAt)
      .map((p) => ({
        id: `recent-prompt-${p.id}`,
        kind: 'prompt' as const,
        name: p.name,
        lastUsedAt: p.lastUsedAt ?? 0,
      })),
    ...actions
      .filter((a) => a.lastUsedAt)
      .map((a) => ({
        id: `recent-action-${a.id}`,
        kind: 'action' as const,
        name: a.name,
        lastUsedAt: a.lastUsedAt ?? 0,
      })),
  ];

  items.sort((a, b) => b.lastUsedAt - a.lastUsedAt);

  return items.slice(0, MAX_RECENT).map((item) =>
    item.kind === 'prompt'
      ? {
          id: item.id,
          group: 'library' as const,
          label: `💬 ${item.name}`,
          description: 'Recently used prompt',
          icon: MessageSquare,
          keywords: ['prompt', 'recent', item.name],
          execute: () => {
            const prompt = prompts.find((p) => p.id === item.id.replace('recent-prompt-', ''));
            if (prompt) {
              ctx.insertToAgentInput?.(prompt.content);
            }
            ctx.closeMenu();
          },
        }
      : {
          id: item.id,
          group: 'library' as const,
          label: `⚡ ${item.name}`,
          description: 'Recently used action',
          icon: Zap,
          keywords: ['action', 'recent', item.name],
          execute: () => {
            // Dispatch via the library store's executeAction.
            void import('@/features/library/store/libraryStore')
              .then((m) =>
                m.useLibraryStore.getState().executeAction(item.id.replace('recent-action-', '')),
              )
              .catch((e) => console.error('[libraryActionProvider] action execute failed:', e));
            ctx.closeMenu();
          },
        },
  );
}
