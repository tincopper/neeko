// Regression test: closing the active tab must move the layout
// group activeTabId onto a live tab. Runs against the real production
// code path (`closeEditorTab` → store) WITHOUT React rendering, so the
// store/layout invariants are checked directly.
import { beforeEach, describe, expect, it } from 'vitest';

import { closeEditorTab } from '@/features/terminal/components/terminalTabCleanup';
import { useEditorStore } from '@/shared/store';
import type { Tab } from '@/shared/types';

function makeTab(id: string): Tab {
  return {
    id,
    projectId: 'p1',
    title: id,
    order: 0,
    data: { kind: 'file', filePath: id, fileName: id, content: '', isDirty: false },
  };
}

describe('closeTab prod parity (no React rendering needed — pure store)', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  });

  it('single group: closing active tab keeps left group active on a live tab', () => {
    const { addTab, activateTab } = useEditorStore.getState();
    addTab('p1', makeTab('A'));
    addTab('p1', makeTab('B'));
    addTab('p1', makeTab('C'));
    activateTab('p1', 'B');

    closeEditorTab('p1', 'B');

    const s = useEditorStore.getState();
    const layout = s.editorLayout['p1'];
    expect(layout.groups.left.tabIds).toEqual(['A', 'C']);
    expect(layout.groups.left.activeTabId).toBe('A');
    expect(layout.groups.left.tabIds).toContain(layout.groups.left.activeTabId);
    expect(s.activeTabId).toBe('A');
  });

  it('single group: closing active tab that is the FIRST tab switches forward', () => {
    const { addTab, activateTab } = useEditorStore.getState();
    addTab('p1', makeTab('A'));
    addTab('p1', makeTab('B'));
    activateTab('p1', 'A');

    closeEditorTab('p1', 'A');

    const s = useEditorStore.getState();
    expect(s.editorLayout['p1'].groups.left.activeTabId).toBe('B');
    expect(s.activeTabId).toBe('B');
  });

  it('single group: closing the LAST tab leaves a valid active tab', () => {
    const { addTab, activateTab } = useEditorStore.getState();
    addTab('p1', makeTab('A'));
    addTab('p1', makeTab('B'));
    activateTab('p1', 'B');

    closeEditorTab('p1', 'B');

    const s = useEditorStore.getState();
    expect(s.editorLayout['p1'].groups.left.activeTabId).toBe('A');
    expect(s.activeTabId).toBe('A');
  });

  it('layout missing (undefined editorLayout): closeTab still yields a consistent layout', () => {
    // Simulate session-restored tabs WITHOUT editorLayout (real-app state).
    useEditorStore.setState({
      tabs: {
        p1: { tabs: [makeTab('A'), makeTab('B'), makeTab('C')], activeTabId: 'B' },
      },
      editorLayout: {},
      activeTabId: 'B',
    });

    closeEditorTab('p1', 'B');

    const s = useEditorStore.getState();
    expect(s.tabs['p1'].activeTabId).toBe('A');
    expect(s.tabs['p1'].tabs.map((t) => t.id)).toEqual(['A', 'C']);
  });
});
