/**
 * Subscribe editor tab activations → MRU tabs + recent files.
 * Call once at app boot (e.g. from AppProviders).
 */
import { onTabActivated } from '@/shared/utils/editorActivity';

import { useMruTabsStore } from './store/mruTabsStore';
import { useRecentFilesStore } from './store/recentFilesStore';

let started = false;

export function startQuickOpenActivityTracking(): () => void {
  if (started) return () => {};
  started = true;
  return onTabActivated((tabKey, tabId, tab) => {
    useMruTabsStore.getState().record(tabKey, tabId);
    if (tab?.data.kind === 'file' && tab.scope.kind === 'workspace') {
      useRecentFilesStore.getState().record(tab.scope.session.projectId, tab.data.filePath);
    }
  });
}
