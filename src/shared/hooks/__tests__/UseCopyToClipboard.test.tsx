import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProvider } from '@/shared/contexts';

import { useCopyToClipboard } from '../useCopyToClipboard';

const mockWriteText = vi.fn();

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: (...args: unknown[]) => mockWriteText(...args),
  readText: vi.fn(),
}));

const mockShowToast = vi.fn();

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppProvider
      value={{
        config: {} as never,
        customThemes: [],
        agents: [],
        agentInstalledMap: {},
        loading: false,
        ideCommandOverrides: {},
        showToast: mockShowToast,
        saveConfig: vi.fn(),
      }}
    >
      {children}
    </AppProvider>
  );
}

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom 默认无 navigator.clipboard；测试回退路径时手动注入
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn() },
    });
  });

  it('should_use_plugin_writeText_and_return_true_on_success', async () => {
    mockWriteText.mockResolvedValue(undefined);
    const { result } = renderHook(() => useCopyToClipboard(), { wrapper });

    let ok = false;
    await act(async () => {
      ok = await result.current('hello');
    });

    expect(ok).toBe(true);
    expect(mockWriteText).toHaveBeenCalledWith('hello');
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('should_fall_back_to_navigator_clipboard_when_plugin_fails', async () => {
    mockWriteText.mockRejectedValue(new Error('plugin denied'));
    const navWrite = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    navWrite.mockResolvedValue(undefined);

    const { result } = renderHook(() => useCopyToClipboard(), { wrapper });

    let ok = false;
    await act(async () => {
      ok = await result.current('fallback');
    });

    expect(ok).toBe(true);
    expect(navWrite).toHaveBeenCalledWith('fallback');
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('should_toast_and_return_false_when_both_paths_fail', async () => {
    mockWriteText.mockRejectedValue(new Error('plugin denied'));
    const navWrite = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    navWrite.mockRejectedValue(new Error('browser denied'));

    const { result } = renderHook(() => useCopyToClipboard(), { wrapper });

    let ok: boolean | null = null;
    await act(async () => {
      ok = await result.current('payload', 'prompt');
    });

    expect(ok).toBe(false);
    expect(mockShowToast).toHaveBeenCalledWith('Failed to copy prompt to clipboard', 'error');
  });
});
