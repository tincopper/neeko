import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentConfig } from '@/shared/types';

import { useAgentMenu } from '../useAgentMenu';

const agent: AgentConfig = {
  id: 'claude',
  name: 'Claude Code',
  command: 'claude',
  args: [],
  env: {},
  icon: null,
  enabled: true,
};

describe('useAgentMenu', () => {
  it('should_start_closed', () => {
    const { result } = renderHook(() => useAgentMenu({}));
    expect(result.current.open).toBe(false);
  });

  it('should_open', () => {
    const { result } = renderHook(() => useAgentMenu({}));
    act(() => {
      result.current.handleOpen();
    });
    expect(result.current.open).toBe(true);
  });

  it('should_close', () => {
    const { result } = renderHook(() => useAgentMenu({}));
    act(() => {
      result.current.handleOpen();
    });
    act(() => {
      result.current.handleClose();
    });
    expect(result.current.open).toBe(false);
  });

  it('should_provide_a_usable_anchor_ref', () => {
    const { result } = renderHook(() => useAgentMenu({}));
    expect(result.current.anchorRef).toHaveProperty('current');
  });

  it('should_invoke_onSelectAgent_when_selecting', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useAgentMenu({ onSelectAgent: onSelect }));
    act(() => {
      result.current.handleSelect(agent);
    });
    expect(onSelect).toHaveBeenCalledWith(agent);
  });

  it('should_not_throw_when_onSelectAgent_is_undefined', () => {
    const { result } = renderHook(() => useAgentMenu({}));
    expect(() => {
      act(() => {
        result.current.handleSelect(agent);
      });
    }).not.toThrow();
  });
});
