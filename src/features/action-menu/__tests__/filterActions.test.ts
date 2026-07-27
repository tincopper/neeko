import { describe, expect, it } from 'vitest';

import type { ActionRegistryItem, ActionContext } from '../types/actionMenu';
import { filterActions } from '../utils/filterActions';

const mockItems: ActionRegistryItem[] = [
  {
    id: 'new-terminal',
    group: 'terminal',
    label: 'New Terminal',
    description: 'Open a new terminal tab',
    icon: {} as any,
    keywords: ['terminal', 'shell', 'tab'],
    execute: () => {},
  },
  {
    id: 'open-file',
    group: 'file',
    label: 'Open File…',
    description: 'Search and open a file',
    icon: {} as any,
    keywords: ['open', 'file', 'goto'],
    execute: () => {},
  },
  {
    id: 'recent-files',
    group: 'file',
    label: 'Recent Files',
    description: 'Browse recently opened files',
    icon: {} as any,
    keywords: ['recent', 'history'],
    visible: (ctx) => ctx.recentFiles.length > 0,
    execute: () => {},
  },
];

const baseCtx: ActionContext = {
  projectId: 'proj-1',
  tabKey: 'proj-1',
  agents: [],
  recentFiles: [],
  closeMenu: () => {},
};

describe('filterActions', () => {
  it('should_return_all_visible_items_when_query_empty', () => {
    const result = filterActions(mockItems, '', baseCtx);
    expect(result).toHaveLength(2); // recent-files is hidden
  });

  it('should_filter_by_label_match', () => {
    const result = filterActions(mockItems, 'terminal', baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('new-terminal');
  });

  it('should_filter_by_description', () => {
    const ctxWithRecent: ActionContext = {
      ...baseCtx,
      recentFiles: ['src/main.ts'],
    };
    const result = filterActions(mockItems, 'browse', ctxWithRecent);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('recent-files');
  });

  it('should_filter_by_label', () => {
    const ctxWithRecent: ActionContext = {
      ...baseCtx,
      recentFiles: ['src/main.ts'],
    };
    const result = filterActions(mockItems, 'Recent', ctxWithRecent);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('recent-files');
  });

  it('should_return_show_recent_files_when_context_has_recent_files', () => {
    const ctxWithRecent: ActionContext = {
      ...baseCtx,
      recentFiles: ['src/main.ts'],
    };
    const result = filterActions(mockItems, '', ctxWithRecent);
    expect(result).toHaveLength(3);
    expect(result.some((i) => i.id === 'recent-files')).toBe(true);
  });

  it('should_be_case_insensitive', () => {
    const result = filterActions(mockItems, 'TERMINAL', baseCtx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('new-terminal');
  });

  it('should_return_empty_when_no_match', () => {
    const result = filterActions(mockItems, 'zzzznonexistent', baseCtx);
    expect(result).toHaveLength(0);
  });
});
