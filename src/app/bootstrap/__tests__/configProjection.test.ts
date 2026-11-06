import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearCustomCssVars: vi.fn(),
  applyCustomCssVars: vi.fn(),
  syncAgentTheme: vi.fn(() => Promise.resolve()),
  updateAllTerminalThemes: vi.fn(),
  syncTypographyTokens: vi.fn(),
  /** 投影的两个扇出下游读的是这两个 store：可变，才能断言「有项目 / 没项目」两种形态。 */
  storeState: {
    projects: [] as Array<{ path: string }>,
    wslEntries: [] as Array<{ distro: string; projects: Array<{ path: string }> }>,
  },
}));

vi.mock('@/features/settings/api/appConfigNormalize', () => ({
  isBuiltinTheme: (theme: string) =>
    ['dark', 'light', 'classic-dark', 'one-dark-pro', 'claude'].includes(theme),
}));
vi.mock('../customThemeVars', () => ({
  clearCustomCssVars: mocks.clearCustomCssVars,
  applyCustomCssVars: mocks.applyCustomCssVars,
}));
vi.mock('@/features/settings/api/settingsApi', () => ({ syncAgentTheme: mocks.syncAgentTheme }));
vi.mock('@/features/terminal', () => ({ updateAllTerminalThemes: mocks.updateAllTerminalThemes }));
vi.mock('@/shared/utils/typography', () => ({ syncTypographyTokens: mocks.syncTypographyTokens }));
vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: { getState: () => ({ projects: mocks.storeState.projects }) },
}));
vi.mock('@/shared/store/connectionStore', () => ({
  useConnectionStore: { getState: () => ({ wslEntries: mocks.storeState.wslEntries }) },
}));

import { applyThemeHintBeforeRender, projectTheme, projectTypography } from '../configProjection';
import { readThemeHint } from '../themeHint';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  mocks.storeState.projects = [];
  mocks.storeState.wslEntries = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * 让 `requestAnimationFrame` 同步执行：终端主题刷新是 rAF 合并的，测试不需要真等一帧。
 * 返回 0 = 回调内已把 `pendingTerminalRefresh` 清零，断言之间不会遗留 pending 状态。
 */
function runAnimationFramesImmediately(): void {
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0);
    return 0;
  });
}

describe('configProjection — 唯一投影点', () => {
  it('无 hint 时首帧不写 data-theme（沿用 CSS 兜底）', () => {
    const spy = vi.spyOn(document.documentElement, 'setAttribute');
    applyThemeHintBeforeRender();
    expect(spy).not.toHaveBeenCalledWith('data-theme', expect.anything());
    spy.mockRestore();
  });

  it('有内置主题 hint 时首帧即写入正确主题', () => {
    localStorage.setItem(
      'neeko.theme-hint',
      JSON.stringify({ theme: 'light', customThemeVariables: null }),
    );
    applyThemeHintBeforeRender();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('自定义主题 hint 同时恢复 CSS 变量', () => {
    const vars = { 'bg-primary': '#123456' };
    localStorage.setItem(
      'neeko.theme-hint',
      JSON.stringify({ theme: 'my-theme', customThemeVariables: vars }),
    );
    applyThemeHintBeforeRender();
    expect(document.documentElement.getAttribute('data-theme')).toBe('my-theme');
    expect(mocks.applyCustomCssVars).toHaveBeenCalledWith(vars);
  });

  it('自定义主题 hint 缺变量时不写 data-theme（绝不写半套主题）', () => {
    localStorage.setItem(
      'neeko.theme-hint',
      JSON.stringify({ theme: 'my-theme', customThemeVariables: null }),
    );
    applyThemeHintBeforeRender();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(mocks.applyCustomCssVars).not.toHaveBeenCalled();
  });

  it('projectTheme 写主题 + 清理旧自定义变量 + 回写 hint', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(projectTheme({ theme: 'light', customThemeVariables: null })).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(mocks.clearCustomCssVars).toHaveBeenCalled();
    expect(readThemeHint()).toEqual({ theme: 'light', customThemeVariables: null });
  });

  it('projectTheme 对自定义主题应用变量并缓存变量表', () => {
    const vars = { 'bg-primary': '#abcdef' };
    expect(projectTheme({ theme: 'my-theme', customThemeVariables: vars })).toBe(true);
    expect(mocks.applyCustomCssVars).toHaveBeenCalledWith(vars);
    expect(readThemeHint()).toEqual({ theme: 'my-theme', customThemeVariables: vars });
  });

  it('自定义主题缺变量时整体跳过：不写 DOM、不写 hint、返回 false', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem(
      'neeko.theme-hint',
      JSON.stringify({ theme: 'light', customThemeVariables: null }),
    );

    expect(projectTheme({ theme: 'my-theme', customThemeVariables: null })).toBe(false);

    // DOM 与缓存都保留上一帧（light）：写半套主题会让下次冷启动首帧错色
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(mocks.applyCustomCssVars).not.toHaveBeenCalled();
    expect(readThemeHint()).toEqual({ theme: 'light', customThemeVariables: null });
    // 未投影 ⇒ 下游也不该被惊动（终端不重算、不发 agent 扇出）
    expect(mocks.updateAllTerminalThemes).not.toHaveBeenCalled();
    expect(mocks.syncAgentTheme).not.toHaveBeenCalled();
  });

  it('projectTypography 只把字体字段交给唯一 token 写入口', () => {
    projectTypography({ monoFamily: 'Fira Code', uiFontSize: 13, monoFontSize: 15 });
    expect(mocks.syncTypographyTokens).toHaveBeenCalledWith({
      monoFamily: 'Fira Code',
      uiFontSize: 13,
      monoFontSize: 15,
    });
  });

  // ── 下游扇出：终端主题 + agent 主题（AC6）。两个下游只被 mock 不算覆盖 ——
  //    mock 是「不说话」，断言才是判据。

  it('projectTheme 触发一次终端主题刷新（rAF 合并后落到 updateAllTerminalThemes）', () => {
    runAnimationFramesImmediately();
    expect(projectTheme({ theme: 'light', customThemeVariables: null })).toBe(true);
    expect(mocks.updateAllTerminalThemes).toHaveBeenCalledTimes(1);
  });

  it('有本地项目时主题扇出到 agent 侧（带 local_paths）', () => {
    mocks.storeState.projects = [{ path: '/p/one' }, { path: '/p/two' }];
    projectTheme({ theme: 'light', customThemeVariables: null });
    expect(mocks.syncAgentTheme).toHaveBeenCalledWith('light', {
      local_paths: ['/p/one', '/p/two'],
      wsl: [],
    });
  });

  it('WSL 项目按 distro 一起扇出', () => {
    mocks.storeState.wslEntries = [{ distro: 'Ubuntu', projects: [{ path: '/w/one' }] }];
    projectTheme({ theme: 'dark', customThemeVariables: null });
    expect(mocks.syncAgentTheme).toHaveBeenCalledWith('dark', {
      local_paths: [],
      wsl: [{ distro: 'Ubuntu', path: '/w/one' }],
    });
  });

  it('没有任何项目时不发 agent 主题扇出（空扇出等于噪声）', () => {
    projectTheme({ theme: 'light', customThemeVariables: null });
    expect(mocks.syncAgentTheme).not.toHaveBeenCalled();
  });
});
