import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { activeTabIdOf, useEditorStore } from '@/shared/store/editorStore';
import type { AgentConfig } from '@/shared/types';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { useTerminalTabs } from '../useTerminalTabs';

const SPACE = WorkspaceSession.of('p1', null).key;

function resetStore() {
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
}

describe('useTerminalTabs', () => {
  it('adds a plain terminal tab and activates it', () => {
    resetStore();
    const { result } = renderHook(() => useTerminalTabs('t1', 'p1'));
    act(() => result.current.handleAddTerminalTab());

    const entry = useEditorStore.getState().tabs[SPACE];
    expect(entry.tabs).toHaveLength(1);
    expect(entry.tabs[0].title).toBe('Terminal 1');
    expect(entry.tabs[0].data.kind).toBe('terminal');
    expect(activeTabIdOf(SPACE)).toBe(entry.tabs[0].id);
  });

  it('caps terminal tabs at 10', () => {
    resetStore();
    const { result } = renderHook(() => useTerminalTabs('t1', 'p1'));
    for (let i = 0; i < 12; i += 1) act(() => result.current.handleAddTerminalTab());

    const entry = useEditorStore.getState().tabs[SPACE];
    expect(entry.tabs.filter((t) => t.data.kind === 'terminal')).toHaveLength(10);
  });

  it('adds an agent terminal tab: 身份是 agentId，标题是中性的 Terminal N', () => {
    resetStore();
    const { result } = renderHook(() => useTerminalTabs('t1', 'p1'));
    const agent = { id: 'opencode', name: 'OpenCode' } as AgentConfig;
    act(() => result.current.handleAddAgentTab(agent));

    const entry = useEditorStore.getState().tabs[SPACE];
    expect(entry.tabs).toHaveLength(1);
    // agent 身份只走 data.agentId（tab 前导图标据此渲染）；标题不含 agent 名
    expect(entry.tabs[0].data.agentId).toBe('opencode');
    expect(entry.tabs[0].title).toBe('Terminal 1');
  });

  it('no-ops without a tabKey or projectId', () => {
    resetStore();
    const { result } = renderHook(() => useTerminalTabs(null, null));
    act(() => result.current.handleAddTerminalTab());
    act(() => result.current.handleAddAgentTab({ id: 'x', name: 'X' } as AgentConfig));
    expect(useEditorStore.getState().tabs).toEqual({});
  });
});
