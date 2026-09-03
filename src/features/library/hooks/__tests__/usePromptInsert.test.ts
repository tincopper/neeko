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

describe('usePromptInsert', () => {
  it('records usage and forwards variable-free prompts directly', () => {
    const recordUsage = vi.spyOn(useLibraryStore.getState(), 'recordUsage');
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    result.current(prompt, 'agent');

    expect(recordUsage).toHaveBeenCalledWith('p1');
    expect(onInsert).toHaveBeenCalledWith(prompt, 'agent');
    expect(useLibraryStore.getState().variableDialogOpen).toBe(false);
  });

  it('opens the variable dialog for agent inserts with placeholders', () => {
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    act(() => {
      result.current({ ...prompt, content: 'hi {{name}}' }, 'agent');
    });

    expect(useLibraryStore.getState().variableDialogOpen).toBe(true);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('skips variable resolution for terminal inserts', () => {
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    result.current({ ...prompt, content: 'hi {{name}}' }, 'terminal');

    expect(useLibraryStore.getState().variableDialogOpen).toBe(false);
    expect(onInsert).toHaveBeenCalledWith({ ...prompt, content: 'hi {{name}}' }, 'terminal');
  });
});
