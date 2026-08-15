import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import type { AgentConfig } from '@/shared/types';

import { useTerminalTabs } from '../useTerminalTabs';

function resetStore() {
  useEditorStore.setState({ tabs: {}, activeTabId: null });
}

describe('useTerminalTabs', () => {
  it('adds a plain terminal tab and activates it', () => {
    resetStore();
    const { result } = renderHook(() => useTerminalTabs('t1', 'p1'));
    act(() => result.current.handleAddTerminalTab());

    const entry = useEditorStore.getState().tabs['t1'];
    expect(entry.tabs).toHaveLength(1);
    expect(entry.tabs[0].title).toBe('Terminal 1');
    expect(entry.tabs[0].data.kind).toBe('terminal');
    expect(useEditorStore.getState().activeTabId).toBe(entry.tabs[0].id);
  });

  it('caps terminal tabs at 10', () => {
    resetStore();
    const { result } = renderHook(() => useTerminalTabs('t1', 'p1'));
    for (let i = 0; i < 12; i += 1) act(() => result.current.handleAddTerminalTab());

    const entry = useEditorStore.getState().tabs['t1'];
    expect(entry.tabs.filter((t) => t.data.kind === 'terminal')).toHaveLength(10);
  });

  it('adds an agent terminal tab with the agent name', () => {
    resetStore();
    const { result } = renderHook(() => useTerminalTabs('t1', 'p1'));
    const agent = { id: 'opencode', name: 'OpenCode' } as AgentConfig;
    act(() => result.current.handleAddAgentTab(agent));

    const entry = useEditorStore.getState().tabs['t1'];
    expect(entry.tabs).toHaveLength(1);
    expect(entry.tabs[0].title).toBe('OpenCode');
    expect(entry.tabs[0].data.agentId).toBe('opencode');
  });

  it('no-ops without a tabKey or projectId', () => {
    resetStore();
    const { result } = renderHook(() => useTerminalTabs(null, null));
    act(() => result.current.handleAddTerminalTab());
    act(() => result.current.handleAddAgentTab({ id: 'x', name: 'X' } as AgentConfig));
    expect(useEditorStore.getState().tabs).toEqual({});
  });
});
