import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromptResource } from '@/shared/types/library';

import {
  resetLibraryState,
  setPromptDialogHostMounted,
  useLibraryStore,
} from '../../store/libraryStore';
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
  // 变量请求只有在宿主挂载时才会挂起等待结算；默认模拟宿主已就绪（AppModals 常驻挂载）。
  setPromptDialogHostMounted(true);
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
    expect(useLibraryStore.getState().variableRequest).toBeNull();
  });

  it('opens the variable dialog for agent inserts with placeholders', () => {
    const recordUsage = stubRecordUsage();
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    act(() => {
      result.current({ ...prompt, content: 'hi {{name}}' }, 'agent');
    });

    expect(useLibraryStore.getState().variableRequest).toBe('hi {{name}}');
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
      useLibraryStore.getState().settleVariableDialog('hi tom');
    });

    expect(recordUsage).toHaveBeenCalledWith('p1');
    expect(onInsert).toHaveBeenCalledWith({ ...prompt, content: 'hi tom' }, 'agent');
  });

  it('does not count usage when the variable dialog is cancelled', async () => {
    const recordUsage = stubRecordUsage();
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    act(() => {
      result.current({ ...prompt, content: 'hi {{name}}' }, 'terminal');
    });
    expect(useLibraryStore.getState().variableRequest).toBe('hi {{name}}');

    await act(async () => {
      useLibraryStore.getState().settleVariableDialog(null);
    });

    expect(recordUsage).not.toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
  });

  /**
   * 无宿主 = 请求立即按「未获得内容」结算（fail-closed）。此前这里是一条永久悬挂的
   * Promise：弹窗没渲染 ⇒ `.then` 永不执行 ⇒ 用户点了没反应、也没有任何报错。
   */
  it('inserts nothing when no dialog host is mounted', async () => {
    const recordUsage = stubRecordUsage();
    const onInsert = vi.fn();
    setPromptDialogHostMounted(false);
    const { result } = renderHook(() => usePromptInsert(onInsert));

    await act(async () => {
      result.current({ ...prompt, content: 'hi {{name}}' }, 'terminal');
    });

    expect(onInsert).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().variableRequest).toBeNull();
  });

  it('opens the variable dialog for terminal inserts with placeholders', () => {
    const recordUsage = stubRecordUsage();
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    act(() => {
      result.current({ ...prompt, content: 'hi {{name}}' }, 'terminal');
    });

    expect(useLibraryStore.getState().variableRequest).toBe('hi {{name}}');
    expect(onInsert).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('forwards variable-free terminal prompts directly', () => {
    const onInsert = vi.fn();
    const { result } = renderHook(() => usePromptInsert(onInsert));

    result.current(prompt, 'terminal');

    expect(useLibraryStore.getState().variableRequest).toBeNull();
    expect(onInsert).toHaveBeenCalledWith(prompt, 'terminal');
  });
});
