import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '@/shared/store/notificationStore';

import { __resetDefinitionCachesForTests } from '../lspCache';
import { __resetNoDefinitionHintForTests, useLspDefinition } from '../useLspDefinition';

const mockGoToDefinition = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ lspResult: null, fileContent: null }),
);
const mockLspRequest = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock('@/features/lsp/api/lspApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/lsp/api/lspApi')>();
  return {
    ...actual,
    lspGoToDefinition: (...args: unknown[]) => mockGoToDefinition(...args),
    lspRequest: (...args: unknown[]) => mockLspRequest(...args),
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
    mockLspRequest.mockResolvedValue(null);
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

describe('useLspDefinition — 无定义时的 hover 兜底提示（语言无关）', () => {
  beforeEach(() => {
    __resetDefinitionCachesForTests();
    __resetNoDefinitionHintForTests();
    useNotificationStore.getState().clearAll();
    mockGoToDefinition.mockResolvedValue({ lspResult: null, fileContent: null });
    mockLspRequest.mockReset();
  });

  /// 用**虚构语言**而非 java 断言：任何"照 languageId 抄一个分支"的实现都会挂。
  it('定义空 + hover 有内容 → 提示符号可解析但无源码位置', async () => {
    mockLspRequest.mockResolvedValue({
      contents: [{ language: 'mylang', value: 'void mylib.println(String x)' }, 'Prints a String…'],
    });
    const { result } = renderHook(() => useLspDefinition('/proj'));

    await act(async () => {
      const res = await result.current.goToDefinitionWithContent('mylang', 'file:///a.ml', 4, 19);
      expect(res).toBeNull();
    });
    const msgs = useNotificationStore.getState().notifications.map((n) => n.message);
    const hint = msgs.find((m) => m.includes('no source location'));
    expect(hint).toBeDefined();
    // 服务器名不得出现在提示里（语言无关：同一条路径服务所有 LS）
    expect(hint?.includes('jdtls')).toBe(false);
    // hover 探测确实发出
    expect(mockLspRequest).toHaveBeenCalledWith(
      '/proj',
      'mylang',
      'textDocument/hover',
      expect.any(Object),
    );
  });

  it('定义空 + hover 也空 → 通用"无定义"提示', async () => {
    mockLspRequest.mockResolvedValue(null);
    const { result } = renderHook(() => useLspDefinition('/proj'));

    await act(async () => {
      const res = await result.current.goToDefinitionWithContent('java', 'file:///a.java', 4, 5);
      expect(res).toBeNull();
    });
    const msgs = useNotificationStore.getState().notifications.map((n) => n.message);
    expect(msgs.some((m) => m === 'No navigable definition at this position.')).toBe(true);
    expect(msgs.some((m) => m.includes('no source location'))).toBe(false);
  });

  /// 反向前两轮的“非 java 不发探测”：兜底是通用能力，不是某服务器的特权。
  it('任一语言（rust）空定义都触发 hover 探测', async () => {
    mockLspRequest.mockResolvedValue(null);
    const { result } = renderHook(() => useLspDefinition('/proj'));

    await act(async () => {
      const res = await result.current.goToDefinitionWithContent('rust', 'file:///a.rs', 0, 0);
      expect(res).toBeNull();
    });
    expect(mockLspRequest).toHaveBeenCalledWith(
      '/proj',
      'rust',
      'textDocument/hover',
      expect.any(Object),
    );
    const msgs = useNotificationStore.getState().notifications.map((n) => n.message);
    expect(msgs.some((m) => m === 'No navigable definition at this position.')).toBe(true);
  });
});
