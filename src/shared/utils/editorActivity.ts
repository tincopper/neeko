/**
 * Soft bus for tab activation events — keeps editorStore free of feature imports.
 */
import type { Tab } from '@/shared/types';

export type TabActivatedListener = (
  tabKey: string,
  tabId: string,
  tab: Tab | undefined,
) => void;

const listeners = new Set<TabActivatedListener>();

export function onTabActivated(listener: TabActivatedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitTabActivated(
  tabKey: string,
  tabId: string,
  tab: Tab | undefined,
): void {
  for (const l of listeners) {
    try {
      l(tabKey, tabId, tab);
    } catch (e) {
      console.warn('[editorActivity] listener error', e);
    }
  }
}
