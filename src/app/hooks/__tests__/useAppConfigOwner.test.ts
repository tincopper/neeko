import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getLspImportStrategy, setLspImportStrategy } from '@/features/lsp/api/lspImportStrategy';
import { clearCustomThemeVarsCache } from '@/features/settings/api/customThemeResolver';
import { invoke } from '@/testing/tauriCore';

import { useAppConfigOwner } from '../useAppConfigOwner';

const mockInvoke = vi.mocked(invoke);

describe('useAppConfigOwner', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    // 变量表缓存是进程级的（owner 恰好一个后语义等价）：测试间必须显式清空
    clearCustomThemeVarsCache();
  });

  afterEach(() => {
    setLspImportStrategy('auto');
  });

  it('config 加载完成前 hydrated=false，完成后 true（splash 覆盖加载窗口）', async () => {
    mockInvoke.mockResolvedValue({});
    const { result } = renderHook(() => useAppConfigOwner());
    expect(result.current.hydrated).toBe(false);
    await waitFor(() => expect(result.current.hydrated).toBe(true));
  });

  it('load_config 失败也必须 hydrated=true（不能把窗口永久卡在 splash）', async () => {
    mockInvoke.mockRejectedValue(new Error('load failed'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useAppConfigOwner());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    spy.mockRestore();
  });

  it('初始状态使用默认配置', () => {
    mockInvoke.mockResolvedValue({});
    const { result } = renderHook(() => useAppConfigOwner());

    expect(result.current.config.appearanceFontSize).toBe(12);
    expect(result.current.config.editorFontSize).toBe(14);
    expect(result.current.config.terminalFontSize).toBe(14);
    expect(result.current.config.diffMode).toBe('unified');
    expect(result.current.config.shell).toBe('');
    expect(result.current.config.fontFamily).toBe('');
    expect(result.current.config.editorGitChangeHighlight).toBe(true);
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

    const { result } = renderHook(() => useAppConfigOwner());

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

    const { result } = renderHook(() => useAppConfigOwner());

    await waitFor(() => {
      expect(result.current.config.appearanceFontSize).toBe(12);
      expect(result.current.config.editorFontSize).toBe(14);
      expect(result.current.config.terminalFontSize).toBe(14);
      expect(result.current.config.diffMode).toBe('unified');
      expect(result.current.config.editorGitChangeHighlight).toBe(true);
    });
  });

  it('editorGitChangeHighlight 缺键/null/非法值归一为 true', async () => {
    mockInvoke.mockResolvedValue({
      editorGitChangeHighlight: null,
    });
    const { result, rerender } = renderHook(() => useAppConfigOwner());
    await waitFor(() => {
      expect(result.current.config.editorGitChangeHighlight).toBe(true);
    });

    mockInvoke.mockResolvedValue({ editorGitChangeHighlight: 'yes' });
    rerender();
    await waitFor(() => {
      expect(result.current.config.editorGitChangeHighlight).toBe(true);
    });
  });

  it('editorGitChangeHighlight 显式 false 被保留', async () => {
    mockInvoke.mockResolvedValue({ editorGitChangeHighlight: false });
    const { result } = renderHook(() => useAppConfigOwner());
    await waitFor(() => {
      expect(result.current.config.editorGitChangeHighlight).toBe(false);
    });
  });

  it('load_config 失败时保持默认值', async () => {
    mockInvoke.mockRejectedValue(new Error('load failed'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAppConfigOwner());

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

    const { result } = renderHook(() => useAppConfigOwner());

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

    const { result } = renderHook(() => useAppConfigOwner());

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

    const { result } = renderHook(() => useAppConfigOwner());

    await waitFor(() => {
      // 已有 terminalFontSize，不应被旧 fontSize 覆盖
      expect(result.current.config.terminalFontSize).toBe(16);
    });
  });

  it('未建模的 config 键必须原样保留（不得被整份保存静默删除）', async () => {
    // 回归（2026-10-16 实测复现）：`config.json` 是**多域共享**文件，而 `save_config`
    // 是**整份覆盖**。此前 load effect 只把已建模字段拼进 state，其余键（`notification` /
    // `agentHookSources` / `projectOnboarding` …）一旦落盘就被删除 ——
    // 表现为「设置页改个字号，CLI hook 开关与通知设置全部消失」。
    //
    // 反证：把 load 里的 `...passthrough` 去掉，本用例必红。
    const unknownKeys = {
      notification: { enabled: true, cliHooks: true },
      agentHookSources: { claude: false },
      projectOnboarding: { proj1: { done: true } },
    };
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'load_config') {
        return {
          appearanceFontSize: 13,
          editorFontSize: 14,
          terminalFontSize: 14,
          fontFamily: '',
          customIdes: [],
          ideCommandOverrides: {},
          agentCommandOverrides: {},
          customAgents: [],
          ...unknownKeys,
        } as never;
      }
      if (cmd === 'list_custom_themes') return [] as never;
      return {} as never;
    });

    const { result } = renderHook(() => useAppConfigOwner());
    await waitFor(() => expect(result.current.config.appearanceFontSize).toBe(13));

    // 模拟用户在设置页改一个字号（走同一条保存链）。
    await act(async () => {
      await result.current.saveConfig({ ...result.current.config, appearanceFontSize: 16 });
    });

    const saveCall = mockInvoke.mock.calls.find((c) => c[0] === 'save_config');
    const written = (saveCall?.[1] as { config: Record<string, unknown> }).config;
    expect(written.appearanceFontSize).toBe(16);
    for (const [key, value] of Object.entries(unknownKeys)) {
      // 逐键断言：失败信息里必须点名是哪个键（vitest 的 expect 不接受自定义消息参数）。
      expect({ key, value: written[key] }).toEqual({ key, value });
    }
  });

  it('通过 invoke 保存配置', async () => {
    mockInvoke.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAppConfigOwner());

    const newConfig = {
      ...result.current.config,
      terminalFontSize: 18,
    };

    await act(async () => {
      await result.current.saveConfig(newConfig);
    });

    expect(mockInvoke).toHaveBeenCalledWith('save_config', { config: newConfig });
  });

  it('保存失败时记录错误并向上抛出', async () => {
    mockInvoke.mockRejectedValue(new Error('save failed'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useAppConfigOwner());

    await act(async () => {
      await expect(
        result.current.saveConfig({
          ...result.current.config,
          terminalFontSize: 20,
        }),
      ).rejects.toThrow('save failed');
    });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('saveConfig 始终写入 lsp 全局配置块', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'load_config') return {};
      if (cmd === 'list_custom_themes') return [];
      return undefined;
    });
    const { result } = renderHook(() => useAppConfigOwner());

    // Wait for initial load_config effect to settle
    await waitFor(() => {
      expect(result.current.config.lsp).toBeDefined();
    });

    await act(async () => {
      await result.current.saveConfig({
        ...result.current.config,
        lsp: {
          autoStart: 'onProjectSelect',
          deactivateStopMinutes: 45,
          customServers: [],
          importStrategy: 'auto',
        },
      });
    });

    await waitFor(() => {
      expect(result.current.config.lsp.autoStart).toBe('onProjectSelect');
      expect(result.current.config.lsp.deactivateStopMinutes).toBe(45);
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      'save_config',
      expect.objectContaining({
        config: expect.objectContaining({
          lsp: expect.objectContaining({
            autoStart: 'onProjectSelect',
            deactivateStopMinutes: 45,
          }),
        }),
      }),
    );
  });

  it('配置不变时浅比较避免重渲染', async () => {
    mockInvoke.mockResolvedValue({});

    const { result } = renderHook(() => useAppConfigOwner());

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

    const { result } = renderHook(() => useAppConfigOwner());

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--font-size')).toBe('12px');
    });

    const newConfig = { ...result.current.config, appearanceFontSize: 16 };
    await act(async () => {
      await result.current.saveConfig(newConfig);
    });

    expect(document.documentElement.style.getPropertyValue('--font-size')).toBe('16px');
  });

  it('terminalFontSize 变化时同步 CSS 变量 --terminal-font-size', async () => {
    mockInvoke.mockResolvedValue({});

    const { result } = renderHook(() => useAppConfigOwner());

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--terminal-font-size')).toBe('14px');
    });

    const newConfig = { ...result.current.config, terminalFontSize: 20 };
    await act(async () => {
      await result.current.saveConfig(newConfig);
    });

    expect(document.documentElement.style.getPropertyValue('--terminal-font-size')).toBe('20px');
  });

  it('旧 fontFamily 迁移为 monoFontFamily（读旧写新幂等）', async () => {
    mockInvoke.mockResolvedValue({
      fontFamily: 'Fira Code',
    });

    const { result } = renderHook(() => useAppConfigOwner());

    await waitFor(() => {
      expect(result.current.config.monoFontFamily).toBe('Fira Code');
      expect(result.current.config.fontFamily).toBe('Fira Code');
    });
  });

  it('saveConfig 时 monoFontFamily 同步写回 fontFamily 保持向后兼容', async () => {
    mockInvoke.mockResolvedValue({});

    const { result } = renderHook(() => useAppConfigOwner());

    await waitFor(() => {
      expect(result.current.config.monoFontFamily).toBe('');
    });

    const next = { ...result.current.config, monoFontFamily: 'JetBrains Mono' };
    await act(async () => {
      await result.current.saveConfig(next);
    });

    // save_config 收到的 config 需同时带新旧字段且一致
    expect(mockInvoke).toHaveBeenCalledWith(
      'save_config',
      expect.objectContaining({
        config: expect.objectContaining({
          monoFontFamily: 'JetBrains Mono',
          fontFamily: 'JetBrains Mono',
        }),
      }),
    );
  });

  it('lsp 缺 importStrategy 时回落 auto（老 config.json 向后兼容）', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'load_config') {
        return { lsp: { autoStart: 'manual', deactivateStopMinutes: 10, customServers: [] } };
      }
      if (cmd === 'list_custom_themes') return [];
      return undefined;
    });

    const { result } = renderHook(() => useAppConfigOwner());

    await waitFor(() => {
      expect(result.current.config.lsp.autoStart).toBe('manual');
    });
    expect(result.current.config.lsp.importStrategy).toBe('auto');
    expect(getLspImportStrategy()).toBe('auto');
  });

  it('lsp.importStrategy 随 load_config 落盘值同步补全策略缓存', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'load_config') {
        return {
          lsp: {
            autoStart: 'onFirstFile',
            deactivateStopMinutes: 30,
            customServers: [],
            importStrategy: 'never',
          },
        };
      }
      if (cmd === 'list_custom_themes') return [];
      return undefined;
    });

    const { result } = renderHook(() => useAppConfigOwner());

    await waitFor(() => {
      expect(result.current.config.lsp.importStrategy).toBe('never');
    });
    expect(getLspImportStrategy()).toBe('never');
  });

  it('saveConfig 持久化 importStrategy 并同步补全策略缓存', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'load_config') return {};
      if (cmd === 'list_custom_themes') return [];
      return undefined;
    });
    const { result } = renderHook(() => useAppConfigOwner());

    await waitFor(() => {
      expect(result.current.config.lsp).toBeDefined();
    });

    await act(async () => {
      await result.current.saveConfig({
        ...result.current.config,
        lsp: {
          autoStart: 'onFirstFile',
          deactivateStopMinutes: 30,
          customServers: [],
          importStrategy: 'ask',
        },
      });
    });

    expect(result.current.config.lsp.importStrategy).toBe('ask');
    expect(getLspImportStrategy()).toBe('ask');
    expect(mockInvoke).toHaveBeenCalledWith(
      'save_config',
      expect.objectContaining({
        config: expect.objectContaining({
          lsp: expect.objectContaining({ importStrategy: 'ask' }),
        }),
      }),
    );
  });

  it('watcherExclude 缺字段时默认为空数组', async () => {
    mockInvoke.mockResolvedValue({});
    const { result } = renderHook(() => useAppConfigOwner());
    await waitFor(() => {
      expect(result.current.config.watcherExclude).toEqual([]);
    });
  });

  it('watcherExclude 合法数组被保留', async () => {
    mockInvoke.mockResolvedValue({ watcherExclude: ['target/', '**/node_modules/**'] });
    const { result } = renderHook(() => useAppConfigOwner());
    await waitFor(() => {
      expect(result.current.config.watcherExclude).toEqual(['target/', '**/node_modules/**']);
    });
  });

  it('watcherExclude 非数组时归一为空数组', async () => {
    mockInvoke.mockResolvedValue({ watcherExclude: 'target/' });
    const { result } = renderHook(() => useAppConfigOwner());
    await waitFor(() => {
      expect(result.current.config.watcherExclude).toEqual([]);
    });
  });

  it('watcherExclude 非字符串项被过滤，合法项保序', async () => {
    mockInvoke.mockResolvedValue({ watcherExclude: [1, null, 'dist/', '**/target/**'] });
    const { result } = renderHook(() => useAppConfigOwner());
    await waitFor(() => {
      expect(result.current.config.watcherExclude).toEqual(['dist/', '**/target/**']);
    });
  });

  /**
   * 回归（2026-11 审查）：自定义主题的变量表是主题的另一半。若先提交主题名再等变量，
   * 中间那一帧就是 `data-theme` 已换、CSS 变量还没写 —— 自定义主题的配色只存在于变量里，
   * 那一帧等于无配色。
   */
  it('自定义主题：变量未到达前不得先换主题名（投影原子性）', async () => {
    let releaseVars: (data: unknown) => void = () => {};
    const varsGate = new Promise((resolve) => {
      releaseVars = resolve;
    });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'load_config') return { theme: 'dark' } as never;
      if (cmd === 'list_custom_themes') return [] as never;
      if (cmd === 'get_custom_theme') return varsGate as never;
      return undefined as never;
    });

    const { result } = renderHook(() => useAppConfigOwner());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = result.current.saveConfig({ ...result.current.config, theme: 'my-theme' });
    });
    // 变量还没回来：主题名必须原封不动（保留上一帧，而不是写半套主题）
    await Promise.resolve();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    releaseVars({ variables: { 'bg-primary': '#123456' } });
    await act(async () => {
      await saving;
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('my-theme');
    expect(document.documentElement.style.getPropertyValue('--bg-primary')).toBe('#123456');
  });

  it('自定义主题变量拿不到时不写半套主题（DOM 保留上一帧 + 告警）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'load_config') return { theme: 'dark' } as never;
      if (cmd === 'list_custom_themes') return [] as never;
      if (cmd === 'get_custom_theme') return null as never;
      return undefined as never;
    });

    const { result } = renderHook(() => useAppConfigOwner());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    await act(async () => {
      await result.current.saveConfig({ ...result.current.config, theme: 'missing-theme' });
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  /**
   * 兜底：`load_config` 悬挂（后端卡死 / IPC 不返回）时窗口不能被永久卡在 splash。
   * 这是 `initializing = sessionInitializing || !hydrated` 这条门控的必要配对条件。
   */
  it('load_config 悬挂时 3s 兜底退出加载态', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockInvoke.mockImplementation(() => new Promise(() => {}) as never);

    const { result } = renderHook(() => useAppConfigOwner());
    expect(result.current.hydrated).toBe(false);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.hydrated).toBe(true);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
    vi.useRealTimers();
  });
});
