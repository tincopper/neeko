import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { EditorContextValue } from '@/shared/contexts';

import { usePaneEditorContext } from '../usePaneEditorContext';

function makeGlobalCtx(overrides: Partial<EditorContextValue> = {}): EditorContextValue {
  return {
    tabs: [],
    activeTabId: null,
    onActivateTab: vi.fn(),
    onCloseTab: vi.fn(),
    onAddTab: vi.fn(),
    agents: [],
    compactMode: false,
    showAgentBar: false,
    hiddenAgentIds: [],
    onToggleHiddenAgent: vi.fn(),
    onAgentClick: vi.fn(),
    ...overrides,
  };
}

describe('usePaneEditorContext', () => {
  it('合并全局上下文并覆盖面板级 tab 操作', () => {
    const globalCtx = makeGlobalCtx({ agents: [{ id: 'a' }] as EditorContextValue['agents'] });
    const activate = vi.fn();
    const close = vi.fn();
    const { result } = renderHook(() => usePaneEditorContext(globalCtx, 'tab1', activate, close));

    expect(result.current.agents).toBe(globalCtx.agents);
    expect(result.current.activeTabId).toBe('tab1');
    expect(result.current.onActivateTab).toBe(activate);
    expect(result.current.onCloseTab).toBe(close);
  });

  it('onAddTab 缺省时提供空操作，避免下游调用崩坏', () => {
    const globalCtx = makeGlobalCtx();
    const { result } = renderHook(() =>
      usePaneEditorContext(globalCtx, null, vi.fn(), vi.fn(), undefined),
    );
    act(() => {
      expect(() => result.current.onAddTab()).not.toThrow();
    });
  });
});
