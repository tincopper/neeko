/**
 * Subscribe editor tab activations → MRU tabs + recent files.
 * Call once at app boot (e.g. from AppProviders).
 */
import { onTabActivated } from '@/shared/utils/editorActivity';

import { useMruTabsStore } from './mruTabsStore';
import { useRecentFilesStore } from './recentFilesStore';

let started = false;

export function startQuickOpenActivityTracking(): () => void {
  if (started) return () => {};
  started = true;
  return onTabActivated((tabKey, tabId, tab) => {
    useMruTabsStore.getState().record(tabKey, tabId);
    if (tab?.data.kind === 'file') {
      useRecentFilesStore.getState().record(tab.projectId, tab.data.filePath);
    }
  });
}
