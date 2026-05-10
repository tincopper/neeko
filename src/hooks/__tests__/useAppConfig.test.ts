import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useAppConfig } from '../../hooks/useAppConfig';

const mockInvoke = vi.mocked(invoke);

describe('useAppConfig', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('初始状态使用默认配置', () => {
    mockInvoke.mockResolvedValue({});
    const { result } = renderHook(() => useAppConfig());

    expect(result.current.config.appearanceFontSize).toBe(12);
    expect(result.current.config.editorFontSize).toBe(14);
    expect(result.current.config.terminalFontSize).toBe(14);
    expect(result.current.config.diffMode).toBe('unified');
    expect(result.current.config.shell).toBe('');
    expect(result.current.config.fontFamily).toBe('');
  });

  it('挂载时加载配置', async () => {
    mockInvoke.mockResolvedValue({
      appearanceFontSize: 13,
      editorFontSize: 16,
      terminalFontSize: 15,
      diffMode: 'split',
      shell: '/bin/zsh',
      fontFamily: 'JetBrains Mono',
      customIdes: [],
      ideCommandOverrides: {},
      agentCommandOverrides: {},
      customAgents: [],
    });

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => {
      expect(result.current.config.appearanceFontSize).toBe(13);
      expect(result.current.config.editorFontSize).toBe(16);
      expect(result.current.config.terminalFontSize).toBe(15);
      expect(result.current.config.diffMode).toBe('split');
      expect(result.current.config.shell).toBe('/bin/zsh');
      expect(result.current.config.fontFamily).toBe('JetBrains Mono');
    });

    expect(mockInvoke).toHaveBeenCalledWith('load_config');
  });

  it('load_config 返回空对象时使用默认值', async () => {
    mockInvoke.mockResolvedValue({});

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => {
      expect(result.current.config.appearanceFontSize).toBe(12);
      expect(result.current.config.editorFontSize).toBe(14);
      expect(result.current.config.terminalFontSize).toBe(14);
      expect(result.current.config.diffMode).toBe('unified');
    });
  });

  it('load_config 失败时保持默认值', async () => {
    mockInvoke.mockRejectedValue(new Error('load failed'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
    });

    expect(result.current.config.terminalFontSize).toBe(14);
    spy.mockRestore();
  });

  it('无效配置字段类型回退到默认值', async () => {
    mockInvoke.mockResolvedValue({
      appearanceFontSize: 'not-a-number',
      editorFontSize: null,
      terminalFontSize: 'invalid',
      diffMode: 'invalid-mode',
      shell: 123,
    });

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => {
      expect(result.current.config.appearanceFontSize).toBe(12); // 回退
      expect(result.current.config.editorFontSize).toBe(14); // 回退
      expect(result.current.config.terminalFontSize).toBe(14); // 回退
      expect(result.current.config.diffMode).toBe('unified'); // 回退
      expect(result.current.config.shell).toBe(''); // 回退
    });
  });

  it('旧 fontSize 字段迁移为 terminalFontSize', async () => {
    mockInvoke.mockResolvedValue({
      fontSize: 18, // 旧字段
      diffMode: 'unified',
    });

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => {
      expect(result.current.config.terminalFontSize).toBe(18); // 迁移
      expect(result.current.config.appearanceFontSize).toBe(12); // 默认
      expect(result.current.config.editorFontSize).toBe(14); // 默认
    });
  });

  it('旧 fontSize 字段迁移时不覆盖已存在的 terminalFontSize', async () => {
    mockInvoke.mockResolvedValue({
      fontSize: 18, // 旧字段
      terminalFontSize: 16, // 已有新字段
    });

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => {
      // 已有 terminalFontSize，不应被旧 fontSize 覆盖
      expect(result.current.config.terminalFontSize).toBe(16);
    });
  });

  it('通过 invoke 保存配置', async () => {
    mockInvoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAppConfig());

    const newConfig = {
      ...result.current.config,
      terminalFontSize: 18,
    };

    await act(async () => {
      await result.current.saveConfig(newConfig);
    });

    expect(mockInvoke).toHaveBeenCalledWith('save_config', { config: newConfig });
  });

  it('保存失败时记录错误但不崩溃', async () => {
    mockInvoke.mockRejectedValue(new Error('save failed'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAppConfig());

    await act(async () => {
      await result.current.saveConfig({
        ...result.current.config,
        terminalFontSize: 20,
      });
    });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('配置不变时浅比较避免重渲染', async () => {
    mockInvoke.mockResolvedValue({});

    const { result } = renderHook(() => useAppConfig());

    const before = result.current.config;

    await act(async () => {
      await result.current.saveConfig(before);
    });

    // 浅比较：saveConfig 传入相同对象时 setConfig 返回 prev，值不变
    expect(result.current.config.terminalFontSize).toBe(before.terminalFontSize);
    expect(result.current.config.diffMode).toBe(before.diffMode);
  });

  it('appearanceFontSize 变化时同步 CSS 变量 --font-size', async () => {
    mockInvoke.mockResolvedValue({});

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue('--font-size'),
      ).toBe('12px');
    });

    const newConfig = { ...result.current.config, appearanceFontSize: 16 };
    await act(async () => {
      await result.current.saveConfig(newConfig);
    });

    expect(
      document.documentElement.style.getPropertyValue('--font-size'),
    ).toBe('16px');
  });

  it('terminalFontSize 变化时同步 CSS 变量 --terminal-font-size', async () => {
    mockInvoke.mockResolvedValue({});

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => {
      expect(
        document.documentElement.style.getPropertyValue('--terminal-font-size'),
      ).toBe('14px');
    });

    const newConfig = { ...result.current.config, terminalFontSize: 20 };
    await act(async () => {
      await result.current.saveConfig(newConfig);
    });

    expect(
      document.documentElement.style.getPropertyValue('--terminal-font-size'),
    ).toBe('20px');
  });
});
