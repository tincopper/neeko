import { Library, MessageSquare, PlusCircle } from 'lucide-react';

import {
  Bot,
  ExternalLink,
  FileIcon,
  FolderOpen,
  Globe,
  History,
  SplitSquareVertical,
  TerminalIcon,
} from '@/shared/components/icons';

import type { ActionContext, ActionRegistryItem } from './types/actionMenu';

const ACTION_ITEMS: ActionRegistryItem[] = [
  {
    id: 'new-terminal',
    group: 'terminal',
    label: 'New Terminal',
    description: 'Open a new terminal tab with default shell',
    icon: TerminalIcon,
    keywords: ['terminal', 'shell', 'new', 'tab'],
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'new-agent-chat',
    group: 'agent',
    label: 'New Agent Chat',
    description: 'Open a new Agent Chat tab to chat with an AI agent',
    icon: Bot,
    keywords: ['web', 'agent', 'chat', 'ai', 'assistant', '图形'],
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'new-browser',
    group: 'browser',
    label: 'New Browser',
    description: 'Open a new browser tab in the editor',
    icon: Globe,
    keywords: ['browser', 'web', 'internet', 'url'],
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'open-file',
    group: 'file',
    label: 'Open File…',
    description: 'Search and open a file in the current project',
    icon: FolderOpen,
    shortcut: 'Ctrl+P',
    keywords: ['open', 'file', 'goto', 'search'],
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'new-file',
    group: 'file',
    label: 'New File…',
    description: 'Create a new file in the current project',
    icon: FileIcon,
    keywords: ['new', 'file', 'create'],
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'recent-files',
    group: 'file',
    label: 'Recent Files',
    description: 'Browse recently opened files',
    icon: History,
    shortcut: 'Ctrl+E',
    keywords: ['recent', 'files', 'history'],
    visible: (ctx) => ctx.recentFiles.length > 0,
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'open-side-terminal',
    group: 'quick',
    label: 'Open Side Terminal',
    description: 'Toggle the side terminal panel',
    icon: SplitSquareVertical,
    shortcut: 'Ctrl+Alt+T',
    keywords: ['side', 'terminal', 'toggle'],
    execute: (ctx) => ctx.closeMenu(),
  },
  {
    id: 'open-in-ide',
    group: 'quick',
    label: 'Open in IDE',
    description: 'Open the current project in the configured IDE',
    icon: ExternalLink,
    shortcut: 'Ctrl+O',
    keywords: ['ide', 'open', 'external'],
    execute: (ctx) => ctx.closeMenu(),
  },

  // ── Resource Library ──────────────────────────────────────────────────
  {
    id: 'open-resource-library',
    group: 'library',
    label: 'Open Resource Library',
    description: 'Browse skills, prompts, and reusable actions',
    icon: Library,
    shortcut: 'Ctrl+Shift+L',
    keywords: ['library', 'skills', 'prompts', 'resources', 'actions'],
    execute: (ctx) => {
      ctx.openLibrary?.({});
      ctx.closeMenu();
    },
  },
  {
    id: 'new-prompt',
    group: 'library',
    label: 'New Prompt…',
    description: 'Create a reusable prompt',
    icon: PlusCircle,
    keywords: ['prompt', 'new', 'create', 'library'],
    execute: (ctx) => {
      ctx.openLibrary?.({ kind: 'prompt' });
      ctx.closeMenu();
    },
  },
  {
    id: 'insert-prompt',
    group: 'library',
    label: 'Insert Prompt…',
    description: 'Search and insert a prompt into the agent input',
    icon: MessageSquare,
    keywords: ['prompt', 'insert', 'library', 'slash'],
    execute: (ctx) => {
      ctx.openLibrary?.({ kind: 'prompt' });
      ctx.closeMenu();
    },
  },
];

export function getActionMenuItems(ctx: ActionContext): ActionRegistryItem[] {
  return ACTION_ITEMS.filter((item) => !item.visible || item.visible(ctx));
}

export function getAllActions(): ActionRegistryItem[] {
  return ACTION_ITEMS;
}

/**
 * Build the full action list including dynamic "recently used" library items.
 *
 * The static ACTION_ITEMS are always included; dynamic items are appended
 * after the static library group. Returns a promise because the library
 * store is queried asynchronously.
 */
export async function getAllActionsAsync(ctx: ActionContext): Promise<ActionRegistryItem[]> {
  const staticItems = ACTION_ITEMS.filter((item) => !item.visible || item.visible(ctx));
  try {
    const { getLibraryActionItems } = await import('./providers/libraryActionProvider');
    const dynamic = await getLibraryActionItems(ctx);
    return [...staticItems, ...dynamic];
  } catch (e) {
    console.error('[actionRegistry] failed to load dynamic items:', e);
    return staticItems;
  }
}
