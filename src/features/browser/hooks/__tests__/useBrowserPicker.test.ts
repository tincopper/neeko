import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Tauri event API:listen（捕获 handler，模拟 picker-cancelled 事件）
const mockListen = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// Mock browser api：start/stop picker 走 invoke 桩（标准模式：import 被 mock 模块断言）
vi.mock('../../api/browserApi', () => ({
  browserStartPicker: vi.fn(() => Promise.resolve()),
  browserStopPicker: vi.fn(() => Promise.resolve()),
}));

import { useProjectStore } from '@/shared/store/projectStore';

import { browserStartPicker, browserStopPicker } from '../../api/browserApi';
import { useBrowserPicker } from '../useBrowserPicker';

const THEME = {
  bgSecondary: '#181A1C',
  bgTertiary: '#333337',
  textPrimary: '#fff',
  textMuted: '#999',
  borderColor: '#3b3b40',
  accentBlue: '#2997ff',
};

function setup() {
  useProjectStore.setState({ activeProjectId: 'p1' });
  const isCreatedRef = { current: true };
  const { result } = renderHook(() =>
    useBrowserPicker({ isCreatedRef, getThemeColors: () => THEME }),
  );
  return result;
}

/** flush 微任务,让异步 stopPicker/startPicker 的 setState 落地。 */
async function flush() {
  await act(async () => {});
}

describe('useBrowserPicker — Esc 退出选择模式', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListen.mockReset();
    mockListen.mockResolvedValue(vi.fn());
  });

  it('主 webview Esc：选择器激活时按 Esc 直接退出（浏览器无键盘焦点兜底）', async () => {
    const result = setup();
    await act(async () => {
      await result.current.startPicker();
    });
    expect(result.current.isPicking).toBe(true);
    expect(browserStartPicker).toHaveBeenCalledTimes(1);

    // 键盘焦点在主 webview（仅悬停浏览器页面、未点击进入）→ Esc 到主 webview
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await flush();

    expect(browserStopPicker).toHaveBeenCalledTimes(1);
    expect(result.current.isPicking).toBe(false);
  });

  it('主 webview Esc：未激活选择器时不触发 stop', async () => {
    setup();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await flush();
    expect(browserStopPicker).not.toHaveBeenCalled();
  });

  it('picker-cancelled 事件：退出选择模式而非 re-inject（Esc 在浏览器 webview 内的路径）', async () => {
    const result = setup();
    await act(async () => {
      await result.current.startPicker();
    });
    expect(result.current.isPicking).toBe(true);

    // 捕获 useTauriEvent 注册的 picker-cancelled handler 并触发（内部是 e => handler(e.payload)）
    const call = mockListen.mock.calls.find((c) => c[0] === 'browser://picker-cancelled');
    expect(call).toBeDefined();
    const listener = call![1] as (e: { payload: unknown }) => void;
    act(() => {
      listener({ payload: undefined });
    });
    await flush();

    expect(browserStopPicker).toHaveBeenCalledTimes(1);
    expect(result.current.isPicking).toBe(false);
  });
});
