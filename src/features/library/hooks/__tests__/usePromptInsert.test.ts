import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromptResource } from '@/shared/types/library';

import { resetLibraryState, useLibraryStore } from '../../store/libraryStore';
import { usePromptInsert } from '../usePromptInsert';

const prompt: PromptResource = {
  id: 'p1',
  name: 'demo',
  content: 'plain content',
  description: null,
  tags: [],
  scope: 'global',
  favorite: false,
  usageCount: 0,
  createdAt: 0,
  updatedAt: 0,
};
beforeEach(() => {
  resetLibraryState();
});

/**
 * 每用例注入全新的 recordUsage mock（经 setState，而非 spyOn）。
 * resetLibraryState 只合并数据字段，不恢复被 spyOn 替换的 action——
 * spyOn 同一对象同方法会复用同一 mock（calls 跨用例累积），故此处直接替换。
 */
function stubRecordUsage() {
  const recordUsage = vi.fn(async (): Promise<void> => {});
  useLibraryStore.setState({ recordUsage });
  return recordUsage;
}

describe('usePromptInsert', () => {
  it('records usage and forwards variable-free prompts directly', () => {
    const recordUsage = stubRecordUsage();
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    result.current(prompt, 'agent');

    expect(recordUsage).toHaveBeenCalledWith('p1');
    expect(onInsert).toHaveBeenCalledWith(prompt, 'agent');
    expect(useLibraryStore.getState().variableDialogOpen).toBe(false);
  });

  it('opens the variable dialog for agent inserts with placeholders', () => {
    const recordUsage = stubRecordUsage();
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    act(() => {
      result.current({ ...prompt, content: 'hi {{name}}' }, 'agent');
    });

    expect(useLibraryStore.getState().variableDialogOpen).toBe(true);
    expect(onInsert).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('counts usage only after the variable dialog is confirmed', async () => {
    const recordUsage = stubRecordUsage();
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    act(() => {
      result.current({ ...prompt, content: 'hi {{name}}' }, 'agent');
    });
    expect(recordUsage).not.toHaveBeenCalled();

    await act(async () => {
      useLibraryStore.getState().variableDialogResolve?.('hi tom');
    });

    expect(recordUsage).toHaveBeenCalledWith('p1');
    expect(onInsert).toHaveBeenCalledWith({ ...prompt, content: 'hi tom' }, 'agent');
  });

  it('does not count usage when the variable dialog is cancelled', () => {
    const recordUsage = stubRecordUsage();
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    act(() => {
      result.current({ ...prompt, content: 'hi {{name}}' }, 'terminal');
    });
    expect(useLibraryStore.getState().variableDialogOpen).toBe(true);

    act(() => {
      useLibraryStore.getState().closeVariableDialog();
    });

    expect(recordUsage).not.toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('opens the variable dialog for terminal inserts with placeholders', () => {
    const recordUsage = stubRecordUsage();
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    act(() => {
      result.current({ ...prompt, content: 'hi {{name}}' }, 'terminal');
    });

    expect(useLibraryStore.getState().variableDialogOpen).toBe(true);
    expect(onInsert).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('forwards variable-free terminal prompts directly', () => {
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    result.current(prompt, 'terminal');

    expect(useLibraryStore.getState().variableDialogOpen).toBe(false);
    expect(onInsert).toHaveBeenCalledWith(prompt, 'terminal');
  });
});
