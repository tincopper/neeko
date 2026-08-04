import { MessageSquare } from 'lucide-react';

import { listPrompts } from '@/features/library/api/libraryApi';
import type { PromptResource } from '@/shared/types/library';

import type { ActionRegistryItem, ActionContext } from '../types/actionMenu';

/** Max number of recent resources shown in the dynamic palette section. */
const MAX_RECENT = 5;

interface RecentItem {
  id: string;
  name: string;
  lastUsedAt: number;
}

/**
 * Build dynamic Action Palette items for recently-used prompts.
 *
 * Reads prompts from the library API, sorts by `lastUsedAt`, and returns the
 * top `MAX_RECENT` as palette items that insert into the agent input.
 */
export async function getLibraryActionItems(ctx: ActionContext): Promise<ActionRegistryItem[]> {
  try {
    const prompts = await listPrompts();
    return buildRecentItems(prompts, ctx);
  } catch (e) {
    console.error('[libraryActionProvider] failed to load recent items:', e);
    return [];
  }
}

function buildRecentItems(prompts: PromptResource[], ctx: ActionContext): ActionRegistryItem[] {
  const items: RecentItem[] = prompts
    .filter((p) => p.lastUsedAt)
    .map((p) => ({
      id: `recent-prompt-${p.id}`,
      name: p.name,
      lastUsedAt: p.lastUsedAt ?? 0,
    }));

  items.sort((a, b) => b.lastUsedAt - a.lastUsedAt);

  return items.slice(0, MAX_RECENT).map((item) => {
    const prompt = prompts.find((p) => p.id === item.id.replace('recent-prompt-', ''));
    return {
      id: item.id,
      group: 'library' as const,
      label: `💬 ${item.name}`,
      description: 'Recently used prompt',
      icon: MessageSquare,
      keywords: ['prompt', 'recent', item.name],
      execute: () => {
        if (prompt) {
          ctx.insertToAgentInput?.(prompt.content);
        }
        ctx.closeMenu();
      },
    };
  });
}
