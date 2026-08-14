import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TerminalInsertProvider, useTerminalInsert } from '../TerminalInsertContext';

function wrapper({ children }: { children: ReactNode }) {
  return <TerminalInsertProvider>{children}</TerminalInsertProvider>;
}

describe('TerminalInsertContext', () => {
  it('should_start_with_empty_api', () => {
    const { result } = renderHook(() => useTerminalInsert(), { wrapper });
    expect(result.current.api).toEqual({});
  });

  it('should_expose_registered_api_and_clear_on_unregister', () => {
    const { result } = renderHook(() => useTerminalInsert(), { wrapper });

    const insertToTerminal = vi.fn().mockReturnValue(true);
    const insertToAgentInput = vi.fn();

    let unregister: (() => void) | undefined;
    act(() => {
      unregister = result.current.register({ insertToTerminal, insertToAgentInput });
    });
    expect(result.current.api.insertToTerminal).toBe(insertToTerminal);
    expect(result.current.api.insertToAgentInput).toBe(insertToAgentInput);

    act(() => {
      unregister?.();
    });
    expect(result.current.api).toEqual({});
  });

  it('should_replace_api_when_registering_again', () => {
    const { result } = renderHook(() => useTerminalInsert(), { wrapper });

    const first = vi.fn();
    const second = vi.fn();
    act(() => {
      result.current.register({ insertToAgentInput: first });
    });
    act(() => {
      result.current.register({ insertToAgentInput: second });
    });
    expect(result.current.api.insertToAgentInput).toBe(second);
  });

  it('should_throw_when_used_outside_provider', () => {
    // renderHook 默认无 wrapper：useContext 返回 null 时应抛错
    expect(() => renderHook(() => useTerminalInsert())).toThrow(
      'useTerminalInsert must be used within TerminalInsertProvider',
    );
  });
});
