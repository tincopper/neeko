import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAgentsInstalled } from '@/features/agent/api/agentApi';
import type { AgentConfig } from '@/shared/types';

import { useProjectAgents } from '../useProjectAgents';

vi.mock('@/features/agent/api/agentApi', () => ({
  checkAgentsInstalled: vi.fn(),
}));

const mockedCheckAgentsInstalled = vi.mocked(checkAgentsInstalled);

function makeAgent(id: string, enabled = true): AgentConfig {
  return { id, name: id, command: `cmd-${id}`, enabled } as unknown as AgentConfig;
}

function makeParams(overrides: Partial<Parameters<typeof useProjectAgents>[0]> = {}) {
  return {
    agents: [makeAgent('a1')],
    projectId: 't-fresh',
    showToast: vi.fn(),
    onAgentClick: vi.fn(),
    ...overrides,
  };
}

describe('useProjectAgents', () => {
  beforeEach(() => {
    // Default to a resolving promise so the check effect never crashes on `.then`.
    mockedCheckAgentsInstalled.mockResolvedValue({});
  });

  it('blocks clicking a disabled agent without calling onAgentClick', () => {
    const showToast = vi.fn();
    const onAgentClick = vi.fn();
    const { result } = renderHook(() =>
      useProjectAgents(makeParams({ projectId: 't-disabled', showToast, onAgentClick })),
    );
    const ok = result.current.handleAgentClick(makeAgent('a1', false));
    expect(ok).toBe(false);
    expect(onAgentClick).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('passes through when no installed map is loaded yet', () => {
    const onAgentClick = vi.fn();
    const { result } = renderHook(() =>
      useProjectAgents(makeParams({ projectId: 't-fresh', onAgentClick })),
    );
    const ok = result.current.handleAgentClick(makeAgent('a1'));
    expect(ok).toBe(true);
    expect(onAgentClick).toHaveBeenCalledWith(makeAgent('a1'));
  });

  it('refreshes installed status from the api when agents change', async () => {
    mockedCheckAgentsInstalled.mockResolvedValue({ a1: true });
    const { result } = renderHook(() => useProjectAgents(makeParams({ projectId: 't-true' })));

    await vi.waitFor(() => {
      expect(mockedCheckAgentsInstalled).toHaveBeenCalledWith(['a1'], 't-true');
      expect(result.current.installedMap.get('a1')).toBe(true);
    });
  });

  it('toasts and blocks when the agent is not installed', async () => {
    mockedCheckAgentsInstalled.mockResolvedValue({ a1: false });
    const showToast = vi.fn();
    const onAgentClick = vi.fn();
    const { result } = renderHook(() =>
      useProjectAgents(makeParams({ projectId: 't-false', showToast, onAgentClick })),
    );

    await vi.waitFor(() => {
      expect(result.current.installedMap.get('a1')).toBe(false);
    });
    const ok = result.current.handleAgentClick(makeAgent('a1'));
    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith('a1 (cmd-a1) is not installed', 'error');
    expect(onAgentClick).not.toHaveBeenCalled();
  });
});
