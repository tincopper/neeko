import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorProvider } from '@/shared/contexts';
import { useEditorStore } from '@/shared/store';
import type { Tab } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';

import TabBar from '../../components/TabBar';

// ── mocks: heavy leaf components are not needed for this seam ──
vi.mock('@/features/terminal/components/terminalTabCleanup', () => ({
  closeEditorTab: (tabKey: string, tabId: string) => {
    useEditorStore.getState().closeTab(tabKey, tabId);
  },
  cleanupTerminalsForTab: () => {},
}));

const makeTab = (id: string, title: string): Tab => ({
  id,
  projectId: 'p1',
  title,
  order: 0,
  data: {
    kind: 'file',
    filePath: title,
    fileName: title,
    content: '',
    isDirty: false,
  },
});

const ctx = {
  tabs: [] as Tab[],
  activeTabId: null as string | null,
  onActivateTab: vi.fn(),
  onCloseTab: vi.fn(),
  onAddTab: () => {},
  agents: [],
  compactMode: false,
  showAgentBar: false,
  hiddenAgentIds: [],
  onToggleHiddenAgent: () => {},
  onAgentClick: () => {},
};

function seed(tabs: Tab[], active: string) {
  const layout = createDefaultEditorLayout();
  layout.groups.left.tabIds = tabs.map((t) => t.id);
  layout.groups.left.activeTabId = active;
  useEditorStore.setState({
    tabs: { p1: { tabs, activeTabId: active } },
    editorLayout: { p1: layout },
    activeTabId: active,
  });
  ctx.tabs = tabs;
  ctx.activeTabId = active;
}

describe('close active tab → next tab becomes active (dev/build parity)', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
    ctx.onCloseTab.mockClear();
  });

  it('after closing the active tab, layout group activeTabId points at a live tab', () => {
    seed([makeTab('A', 'a.ts'), makeTab('B', 'b.ts')], 'A');

    const onClose = (tabId: string) => {
      useEditorStore.getState().closeTab('p1', tabId);
      ctx.activeTabId = useEditorStore.getState().tabs['p1'].activeTabId;
    };
    render(
      <EditorProvider value={{ ...ctx, onCloseTab: onClose }}>
        <TabBar
          tabs={ctx.tabs}
          activeTabId={ctx.activeTabId}
          onActivateTab={vi.fn()}
          onCloseTab={onClose}
        />
      </EditorProvider>,
    );

    const closeBtns = screen.getAllByTitle('Close tab');
    expect(closeBtns.length).toBeGreaterThan(0);
    // Close the ACTIVE tab (A) — first tab in the seeded order.
    fireEvent.click(closeBtns[0]);

    const state = useEditorStore.getState();
    expect(state.tabs['p1'].tabs.map((t) => t.id)).toEqual(['B']);
    expect(state.tabs['p1'].activeTabId).toBe('B');
    expect(state.editorLayout['p1'].groups.left.activeTabId).toBe('B');
    const leftTab = state.editorLayout['p1'].groups.left.tabIds;
    expect(leftTab).toContain('B');
  });
});
