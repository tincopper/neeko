import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '@/shared/store/notificationStore';

import { __resetDefinitionCachesForTests } from '../lspCache';
import { __resetNoDefinitionHintForTests, useLspDefinition } from '../useLspDefinition';

const mockGoToDefinition = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ lspResult: null, fileContent: null }),
);

vi.mock('@/features/lsp/api/lspApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/lsp/api/lspApi')>();
  return {
    ...actual,
    lspGoToDefinition: (...args: unknown[]) => mockGoToDefinition(...args),
  };
});

const VALID_RESULT = {
  lspResult: {
    uri: 'file:///target.rs',
    range: {
      start: { line: 3, character: 1 },
      end: { line: 3, character: 5 },
    },
  },
  fileContent: 'pub fn target() {}',
};

describe('useLspDefinition — goToDefinitionWithContent feedback', () => {
  beforeEach(() => {
    __resetDefinitionCachesForTests();
    __resetNoDefinitionHintForTests();
    useNotificationStore.getState().clearAll();
    mockGoToDefinition.mockResolvedValue({ lspResult: null, fileContent: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should_return_null_without_hint_when_project_path_missing', async () => {
    const { result } = renderHook(() => useLspDefinition(null));

    await act(async () => {
      const res = await result.current.goToDefinitionWithContent('rust', 'file:///a.rs', 0, 0);
      expect(res).toBeNull();
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('should_show_info_hint_when_no_definition_found', async () => {
    mockGoToDefinition.mockResolvedValue({ lspResult: null, fileContent: null });
    const { result } = renderHook(() => useLspDefinition('/proj'));

    await act(async () => {
      const res = await result.current.goToDefinitionWithContent('rust', 'file:///a.rs', 1, 2);
      expect(res).toBeNull();
    });

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe('info');
    expect(notifications[0]?.title).toMatch(/未找到定义|No definition/i);
  });

  it('should_return_location_without_hint_when_definition_found', async () => {
    mockGoToDefinition.mockResolvedValue(VALID_RESULT);
    const { result } = renderHook(() => useLspDefinition('/proj'));

    let res: Awaited<ReturnType<typeof result.current.goToDefinitionWithContent>> | null = null;
    await act(async () => {
      res = await result.current.goToDefinitionWithContent('rust', 'file:///a.rs', 1, 2);
    });

    expect(res).not.toBeNull();
    expect(res?.location.uri).toBe('file:///target.rs');
    expect(res?.fileContent).toBe('pub fn target() {}');
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('should_throttle_repeated_no_definition_hints', async () => {
    vi.useFakeTimers();
    mockGoToDefinition.mockResolvedValue({ lspResult: null, fileContent: null });
    const { result } = renderHook(() => useLspDefinition('/proj'));

    await act(async () => {
      await result.current.goToDefinitionWithContent('rust', 'file:///a.rs', 1, 2);
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(1);

    // Second failure within the cooldown window — no extra toast.
    await act(async () => {
      await result.current.goToDefinitionWithContent('rust', 'file:///a.rs', 1, 2);
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(1);

    // After the cooldown elapses, feedback is allowed again.
    await act(async () => {
      vi.advanceTimersByTime(2001);
    });
    await act(async () => {
      await result.current.goToDefinitionWithContent('rust', 'file:///a.rs', 1, 2);
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(2);
  });
});
