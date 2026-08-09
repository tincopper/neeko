/**
 * MRU tab activation order per tabKey (IDEA-like Ctrl+Tab switcher).
 */
import { create } from 'zustand';

const MAX_MRU = 40;

interface MruTabsState {
  /** tabKey → tabIds newest first */
  byTabKey: Record<string, string[]>;
  record: (tabKey: string, tabId: string) => void;
  list: (tabKey: string) => string[];
  remove: (tabKey: string, tabId: string) => void;
  clear: (tabKey: string) => void;
}

export const useMruTabsStore = create<MruTabsState>((set, get) => ({
  byTabKey: {},

  record: (tabKey, tabId) => {
    if (!tabKey || !tabId) return;
    set((s) => {
      const prev = s.byTabKey[tabKey] ?? [];
      const next = [tabId, ...prev.filter((id) => id !== tabId)].slice(0, MAX_MRU);
      return { byTabKey: { ...s.byTabKey, [tabKey]: next } };
    });
  },

  list: (tabKey) => get().byTabKey[tabKey] ?? [],

  remove: (tabKey, tabId) =>
    set((s) => {
      const prev = s.byTabKey[tabKey];
      if (!prev) return s;
      return {
        byTabKey: {
          ...s.byTabKey,
          [tabKey]: prev.filter((id) => id !== tabId),
        },
      };
    }),

  clear: (tabKey) =>
    set((s) => {
      const next = { ...s.byTabKey };
      delete next[tabKey];
      return { byTabKey: next };
    }),
}));
