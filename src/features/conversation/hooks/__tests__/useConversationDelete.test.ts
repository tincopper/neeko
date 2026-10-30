import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useConversationDelete } from '@/features/conversation/hooks/useConversationDelete';
import type { ConversationMeta } from '@/features/conversation/types';

const meta = {
  id: 'pi:abc',
  nativeSessionId: 'abc',
  agentId: 'pi',
  title: 't',
  startedAt: 0,
  updatedAt: 0,
  messageCount: 1,
  preview: '',
  filePath: '/tmp/s.jsonl',
  projectPath: '/tmp/p',
  userTitle: null,
  tags: [],
  deleteSupport: 'storage',
} as ConversationMeta;

describe('useConversationDelete', () => {
  it('removes the row only when the orchestration reports a real delete', async () => {
    const onDeleted = vi.fn();
    const requestDelete = vi.fn(async () => true);
    const { result } = renderHook(() => useConversationDelete({ requestDelete, onDeleted }));

    await act(async () => {
      await result.current(meta);
    });

    expect(requestDelete).toHaveBeenCalledWith(meta);
    expect(onDeleted).toHaveBeenCalledWith('pi:abc');
  });

  it('leaves the row alone when the user cancels', async () => {
    const onDeleted = vi.fn();
    const requestDelete = vi.fn(async () => false);
    const { result } = renderHook(() => useConversationDelete({ requestDelete, onDeleted }));

    await act(async () => {
      await result.current(meta);
    });

    expect(onDeleted).not.toHaveBeenCalled();
  });

  /**
   * **不允许静默**：编排自身炸了（判定 / 确认 / 关 tab 抛错）时，旧实现把异常吞掉 ——
   * 屏幕上就是「点了没反应」，控制台之外无任何痕迹。
   *
   * 变异验证：去掉 try/catch → 本用例红（异常冒出，onError 不被调用）。
   */
  it('surfaces orchestration errors instead of swallowing them', async () => {
    const onDeleted = vi.fn();
    const onError = vi.fn();
    const requestDelete = vi.fn(async () => {
      throw new Error('confirm host exploded');
    });
    const { result } = renderHook(() =>
      useConversationDelete({ requestDelete, onDeleted, onError }),
    );

    await act(async () => {
      await result.current(meta);
    });

    expect(onError).toHaveBeenCalledWith(new Error('confirm host exploded'));
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
