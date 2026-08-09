import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store';
import type { Tab } from '@/shared/types/tab';

import { useTabManagement } from '../useTabManagement';

// 只 mock useTabManagement 实际依赖的底层模块，而非整个门面：
// 门面保持真实，未来新增门面导出不会因 mock 缺失而静默变 undefined。
vi.mock('@/features/terminal/components/terminalTabCleanup', () => ({
  closeEditorTab: vi.fn(),
  closeAllEditorTabs: vi.fn(),
}));
vi.mock('@/features/terminal/hooks/useTerminalTabs', () => ({
  useTerminalTabs: () => ({
    getTabs: () => [],
    addTab: vi.fn(),
    activateTab: vi.fn(),
    updateTabStatus: vi.fn(),
    handleAgentClick: vi.fn(),
  }),
}));

const mockCloseEditorTab = vi.mocked(closeEditorTab);

function makeTerminalTab(id: string, projectId: string, title = id): Tab {
  return {
    id,
    projectId,
    title,
    order: 0,
    data: { kind: 'terminal', agentId: null, status: 'Idle' },
  };
}

describe('useTabManagement handleCloseTab', () => {
  beforeEach(() => {
    mockCloseEditorTab.mockClear();
    // Seed two tabKeys so a regression to full-scan would have other keys to
    // mistakenly match against.
    useEditorStore.setState({
      tabs: {
        p1: { tabs: [makeTerminalTab('tab-1', 'p1')], activeTabId: 'tab-1' },
        p2: { tabs: [makeTerminalTab('tab-2', 'p2')], activeTabId: 'tab-2' },
      },
      activeTabId: 'tab-1',
      editorLayout: {},
    });
  });

  it('should_close_tab_via_tabKey_context_without_scanning_other_keys', () => {
    const { result } = renderHook(() =>
      useTabManagement({
        activeProject: { id: 'p1' },
        activeWorktreePath: null,
      }),
    );

    act(() => {
      result.current.handleCloseTab('tab-1');
    });

    // Must target the active tabKey only, not scan state.tabs for the tabId.
    expect(mockCloseEditorTab).toHaveBeenCalledTimes(1);
    expect(mockCloseEditorTab).toHaveBeenCalledWith('p1', 'tab-1');
  });
});
