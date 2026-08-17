import { beforeEach, describe, expect, it } from 'vitest';

import { useBrowserTabsStore } from '../browserTabsStore';

function resetStores() {
  useBrowserTabsStore.setState({ states: {} });
}

const LABEL_T1 = 'neeko-browser-tab-t1';
const LABEL_T2 = 'neeko-browser-tab-t2';

describe('useBrowserTabsStore — per-tab isolation', () => {
  beforeEach(() => {
    resetStores();
  });

  it('getTabState creates a default state on first access', () => {
    const state = useBrowserTabsStore.getState().getTabState('t1', LABEL_T1);

    expect(state).toEqual({
      label: LABEL_T1,
      url: '',
      isCreated: false,
      isLoading: false,
      history: { entries: [], index: -1 },
      title: '',
      favicon: '',
      lastActiveAt: 0,
      isActive: false,
    });
  });

  it('getTabState is idempotent: repeated access returns the same object', () => {
    const first = useBrowserTabsStore.getState().getTabState('t1', LABEL_T1);
    const second = useBrowserTabsStore.getState().getTabState('t1', LABEL_T1);

    expect(second).toBe(first);
  });

  it('setTabState patches only the target tab', () => {
    useBrowserTabsStore.getState().getTabState('t1', LABEL_T1);
    useBrowserTabsStore
      .getState()
      .setTabState('t1', { url: 'https://a.com', isLoading: true, isActive: true });

    const state = useBrowserTabsStore.getState().getTabState('t1', LABEL_T1);
    expect(state.url).toBe('https://a.com');
    expect(state.isLoading).toBe(true);
    expect(state.isCreated).toBe(false);
    expect(state.isActive).toBe(true);
    expect(state.label).toBe(LABEL_T1);
  });

  it('tabs are physically isolated: patching one leaves the other untouched', () => {
    useBrowserTabsStore.getState().getTabState('t1', LABEL_T1);
    useBrowserTabsStore.getState().getTabState('t2', LABEL_T2);

    useBrowserTabsStore.getState().setTabState('t1', { isCreated: true, url: 'https://a.com' });

    const t1 = useBrowserTabsStore.getState().getTabState('t1', LABEL_T1);
    const t2 = useBrowserTabsStore.getState().getTabState('t2', LABEL_T2);
    expect(t1.isCreated).toBe(true);
    expect(t1.url).toBe('https://a.com');
    expect(t2.isCreated).toBe(false);
    expect(t2.url).toBe('');
  });

  it('removeTabState deletes the entry; the next getTabState recreates a fresh default', () => {
    useBrowserTabsStore.getState().getTabState('t1', LABEL_T1);
    useBrowserTabsStore.getState().setTabState('t1', { url: 'https://a.com', isCreated: true });

    useBrowserTabsStore.getState().removeTabState('t1');

    expect(useBrowserTabsStore.getState().states).toEqual({});
    const recreated = useBrowserTabsStore.getState().getTabState('t1', LABEL_T1);
    expect(recreated.url).toBe('');
    expect(recreated.isCreated).toBe(false);
  });

  it('removeTabState on a missing tab is a no-op', () => {
    useBrowserTabsStore.getState().removeTabState('missing');

    expect(useBrowserTabsStore.getState().states).toEqual({});
  });

  it('reset clears all tab states', () => {
    useBrowserTabsStore.getState().getTabState('t1', LABEL_T1);
    useBrowserTabsStore.getState().getTabState('t2', LABEL_T2);

    useBrowserTabsStore.getState().reset();

    expect(useBrowserTabsStore.getState().states).toEqual({});
  });
});
