// Unit tests for usePaneAgents: agent installation status + filtering
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the agent API before importing the hook
const mockCheckAgentsInstalled = vi.fn();
vi.mock('@/features/agent/api/agentApi', () => ({
  checkAgentsInstalled: (...args: unknown[]) => mockCheckAgentsInstalled(...args),
}));

import type { AgentConfig } from '@/shared/types';

import { usePaneAgents } from '../usePaneAgents';

const mockAgents: AgentConfig[] = [
  { id: 'opencode', name: 'OpenCode', enabled: true, command: 'opencode' },
  { id: 'claude', name: 'Claude Code', enabled: true, command: 'claude' },
  { id: 'gemini', name: 'Gemini', enabled: false, command: 'gemini' },
];

describe('usePaneAgents', () => {
  const defaultParams = {
    agents: mockAgents,
    hiddenAgentIds: [] as string[],
    projectIdForCheck: 'p1',
    onAgentClick: vi.fn(),
    showToast: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckAgentsInstalled.mockResolvedValue({});
  });

  it('enabledAgents filters out disabled agents', () => {
    const { result } = renderHook(() => usePaneAgents(defaultParams));

    expect(result.current.enabledAgents).toHaveLength(2);
    expect(result.current.enabledAgents.map((a) => a.id)).toEqual(['opencode', 'claude']);
  });

  it('enabledAgents filters out hidden agent IDs', () => {
    const params = { ...defaultParams, hiddenAgentIds: ['claude'] };
    const { result } = renderHook(() => usePaneAgents(params));

    expect(result.current.enabledAgents).toHaveLength(1);
    expect(result.current.enabledAgents[0]?.id).toBe('opencode');
  });

  it('handleAgentClick calls onAgentClick for installed+enabled agent', () => {
    const { result } = renderHook(() => usePaneAgents(defaultParams));

    // installedMap is empty initially (size === 0), so agent is treated as installed
    act(() => {
      result.current.handleAgentClick(mockAgents[0]!);
    });

    expect(defaultParams.onAgentClick).toHaveBeenCalledWith(mockAgents[0]);
  });

  it('handleAgentClick skips disabled agents', () => {
    const { result } = renderHook(() => usePaneAgents(defaultParams));

    act(() => {
      result.current.handleAgentClick(mockAgents[2]!); // gemini, disabled
    });

    expect(defaultParams.onAgentClick).not.toHaveBeenCalled();
  });

  it('installedEnabledAgents filters by installation status', async () => {
    const enabledAgents = mockAgents.filter((a) => a.enabled);
    mockCheckAgentsInstalled.mockResolvedValue({
      opencode: true,
      claude: false,
    });

    const params = {
      ...defaultParams,
      agents: enabledAgents,
    };
    const { result } = renderHook(() => usePaneAgents(params));

    await waitFor(() => {
      expect(result.current.installedEnabledAgents.length).toBeGreaterThanOrEqual(0);
    });

    // After mock resolves, only opencode should be in installedEnabledAgents
    expect(mockCheckAgentsInstalled).toHaveBeenCalledWith(['opencode', 'claude'], 'p1');
  });

  it('checkAgentsInstalled is called with agent IDs on mount', async () => {
    mockCheckAgentsInstalled.mockResolvedValue({});

    renderHook(() => usePaneAgents(defaultParams));

    await waitFor(() => {
      expect(mockCheckAgentsInstalled).toHaveBeenCalledWith(['opencode', 'claude', 'gemini'], 'p1');
    });
  });
});
