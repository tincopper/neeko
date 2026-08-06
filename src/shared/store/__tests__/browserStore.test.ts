import { beforeEach, describe, expect, it } from 'vitest';

import { useBrowserStore, useProjectBrowserStore } from '../browserStore';
import { useProjectStore } from '../projectStore';

/** Reset both stores to a clean baseline for each test. */
function resetStores() {
  useProjectBrowserStore.setState({ states: {} });
  useProjectStore.setState({ activeProjectId: null });
}

describe('useProjectBrowserStore — per-project isolation', () => {
  beforeEach(() => {
    resetStores();
  });

  it('getPanelState creates a default panel state on first access', () => {
    const state = useProjectBrowserStore.getState().getPanelState('p1');

    expect(state).toEqual({
      label: 'neeko-browser-p1',
      url: '',
      isCreated: false,
      isLoading: false,
      history: { entries: [], index: -1 },
      title: '',
      favicon: '',
      lastActiveAt: 0,
    });
  });

  it('getPanelState is idempotent: repeated access returns the same object', () => {
    const first = useProjectBrowserStore.getState().getPanelState('p1');
    const second = useProjectBrowserStore.getState().getPanelState('p1');

    expect(second).toBe(first);
  });

  it('setPanelState patches only the target project', () => {
    useProjectBrowserStore.getState().getPanelState('p1');
    useProjectBrowserStore.getState().setPanelState('p1', { url: 'https://a.com' });

    const state = useProjectBrowserStore.getState().getPanelState('p1');
    expect(state.url).toBe('https://a.com');
    expect(state.isCreated).toBe(false);
    expect(state.label).toBe('neeko-browser-p1');
  });

  it('projects are physically isolated: patching one leaves the other untouched', () => {
    useProjectBrowserStore.getState().getPanelState('p1');
    useProjectBrowserStore.getState().getPanelState('p2');

    useProjectBrowserStore
      .getState()
      .setPanelState('p1', { isCreated: true, url: 'https://a.com' });

    const p1 = useProjectBrowserStore.getState().getPanelState('p1');
    const p2 = useProjectBrowserStore.getState().getPanelState('p2');
    expect(p1.isCreated).toBe(true);
    expect(p1.url).toBe('https://a.com');
    expect(p2.isCreated).toBe(false);
    expect(p2.url).toBe('');
  });

  it('removeState deletes the entry; the next getPanelState recreates a fresh default', () => {
    useProjectBrowserStore.getState().getPanelState('p1');
    useProjectBrowserStore.getState().setPanelState('p1', { url: 'https://a.com' });

    useProjectBrowserStore.getState().removeState('p1');

    expect(useProjectBrowserStore.getState().states).toEqual({});
    const recreated = useProjectBrowserStore.getState().getPanelState('p1');
    expect(recreated.url).toBe('');
    expect(recreated.isCreated).toBe(false);
  });

  it('navigateTo(projectId, url) sets url + isLoading, preserving isCreated', () => {
    useProjectBrowserStore.getState().getPanelState('p1');
    useProjectBrowserStore.getState().setPanelState('p1', { isCreated: true });

    useProjectBrowserStore.getState().navigateTo('p1', 'https://a.com');

    const state = useProjectBrowserStore.getState().getPanelState('p1');
    expect(state.url).toBe('https://a.com');
    expect(state.isLoading).toBe(true);
    expect(state.isCreated).toBe(true);
  });

  it('navigateTo(url) single-arg overload targets the active project', () => {
    useProjectStore.setState({ activeProjectId: 'p2' });
    useProjectBrowserStore.getState().getPanelState('p2');

    useProjectBrowserStore.getState().navigateTo('https://b.com');

    const state = useProjectBrowserStore.getState().getPanelState('p2');
    expect(state.url).toBe('https://b.com');
    expect(state.isLoading).toBe(true);
  });

  it('navigateTo(url) single-arg overload is a no-op without an active project', () => {
    useProjectBrowserStore.getState().navigateTo('https://b.com');

    expect(useProjectBrowserStore.getState().states).toEqual({});
  });

  it('reset clears all project states', () => {
    useProjectBrowserStore.getState().getPanelState('p1');
    useProjectBrowserStore.getState().getPanelState('p2');

    useProjectBrowserStore.getState().reset();

    expect(useProjectBrowserStore.getState().states).toEqual({});
  });

  it('useBrowserStore remains a backward-compatible alias', () => {
    expect(useBrowserStore).toBe(useProjectBrowserStore);
  });
});
