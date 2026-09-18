import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProvider } from '@/shared/contexts';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileTab } from '@/shared/types';
import { createProject } from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { useEditorSave } from '../useEditorSave';

const mockInvoke = vi.mocked(invoke);

function makeFileTab(overrides?: Partial<FileTab>): FileTab {
  return {
    id: 'tab-1',
    projectId: 'test-project-id',
    filePath: 'index.html',
    fileName: 'index.html',
    content: { path: 'index.html', content: '<html></html>', size: 15, is_binary: false },
    isDirty: false,
    order: 0,
    ...overrides,
  };
}

function makeWrapper(showToast: (message: string, type?: 'info' | 'error') => void) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AppProvider
        value={{
          config: {
            theme: 'dark',
            appearanceFontSize: 12,
            editorFontSize: 14,
            terminalFontSize: 14,
            diffMode: 'unified',
            shell: '',
            fontFamily: '',
            customIdes: [],
            customAgents: [],
            ideCommandOverrides: {},
            agentCommandOverrides: {},
            agentSelectorShowPresetBar: true,
            agentSelectorCompactMode: false,
            hiddenAgentIds: [],
            shortcuts: {},
            terminalGpuAcceleration: false,
            enablePiThemeSync: false,
            enableOpenCodeThemeSync: false,
            lsp: { autoStart: 'onFirstFile', deactivateStopMinutes: 30, customServers: [] },
            favoriteBranches: {},
          },
          customThemes: [],
          agents: [],
          agentInstalledMap: {},
          loading: false,
          ideCommandOverrides: {},
          showToast,
          saveConfig: vi.fn(),
        }}
      >
        {children}
      </AppProvider>
    );
  };
}

function renderSaveHook(showToast: (message: string, type?: 'info' | 'error') => void = vi.fn()) {
  const tab = makeFileTab();
  return renderHook(
    () =>
      useEditorSave({
        tab,
        tabKey: TAB_KEY,
        tabId: tab.id,
        projectPath: '/tmp/test-project',
        setIsSaving: vi.fn(),
        onSave: vi.fn(),
        onContentChange: vi.fn(),
      }),
    { wrapper: makeWrapper(showToast) },
  );
}

const TAB_KEY = 'test-project-id:test-project-id';
const TAB_ID = 'tab-1';

/** 保存路径在按键时从 store 读内容/脏标记（不进渲染依赖）→ 用例需先播种 store。 */
function seedStoreFileTab(options: { content: string; isDirty: boolean }): void {
  useEditorStore.setState({
    tabs: {
      [TAB_KEY]: {
        activeTabId: TAB_ID,
        tabs: [
          {
            id: TAB_ID,
            projectId: 'test-project-id',
            title: 'index.html',
            order: 0,
            data: {
              kind: 'file',
              filePath: 'index.html',
              fileName: 'index.html',
              content: {
                path: 'index.html',
                content: options.content,
                size: options.content.length,
                is_binary: false,
              },
              isDirty: options.isDirty,
            },
          },
        ],
      },
    },
  });
}

describe('useEditorSave handleOpenInSystemBrowser', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    // Local 项目 → capabilities.canEditFiles = true，走系统浏览器分支
    useProjectStore.setState({ activeProject: createProject() });
  });

  it('opens file URL with project id so backend can allowlist the root', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const { result } = renderSaveHook();

    await act(async () => {
      result.current.handleOpenInSystemBrowser();
    });

    expect(mockInvoke).toHaveBeenCalledWith('open_in_default_browser', {
      url: 'file:///tmp/test-project/index.html',
      projectId: 'test-project-id',
    });
  });

  it('surfaces failures via error toast instead of failing silently', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('file:// URL not allowed'));
    const showToast = vi.fn();
    const { result } = renderSaveHook(showToast);

    await act(async () => {
      result.current.handleOpenInSystemBrowser();
    });

    expect(showToast).toHaveBeenCalledWith('Failed to open in system browser', 'error');
  });
});

describe('useEditorSave saveKeymap 身份稳定（配置纯净不变量）', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useProjectStore.setState({ activeProject: createProject() });
  });

  /**
   * 回归：`saveKeymap` 进入 CodeMirror extensions 数组，身份一旦随内容/脏标记变化，
   * 宿主（@uiw/react-codemirror）就会 reconfigure —— 每次按键重建整个扩展世界，
   * 把经 appendConfig 惰性安装的 lint 渲染扩展丢掉（波浪线闪烁/消失的根因之一）。
   */
  it('内容变化与 isDirty 翻转后引用都不变', () => {
    seedStoreFileTab({ content: '<html></html>', isDirty: false });

    const setIsSaving = vi.fn();
    const onSave = vi.fn();
    const onContentChange = vi.fn();
    // 生产环境这两个引用恒定（useState setter / useCallback），测试必须同构
    let tab = makeFileTab();

    const { result, rerender } = renderHook(
      () =>
        useEditorSave({
          tab,
          tabKey: TAB_KEY,
          tabId: TAB_ID,
          projectPath: '/tmp/test-project',
          setIsSaving,
          onSave,
          onContentChange,
        }),
      { wrapper: makeWrapper(vi.fn()) },
    );

    const mounted = result.current.saveKeymap;

    // 每次按键：内容变化 + 第一次编辑让脏标记翻转
    seedStoreFileTab({ content: '<html><body></body></html>', isDirty: true });
    tab = makeFileTab({ isDirty: true });
    rerender();
    expect(result.current.saveKeymap).toBe(mounted);

    // 保存：脏标记翻转回 false
    seedStoreFileTab({ content: '<html><body></body></html>', isDirty: false });
    tab = makeFileTab({ isDirty: false });
    rerender();
    expect(result.current.saveKeymap).toBe(mounted);
  });

  it('handleSave 取 store 最新内容（不是挂载时的快照）', async () => {
    seedStoreFileTab({ content: 'v1', isDirty: true });

    const setIsSaving = vi.fn();
    const onSave = vi.fn(async () => true);
    const tab = makeFileTab();

    const { result } = renderHook(
      () =>
        useEditorSave({
          tab,
          tabKey: TAB_KEY,
          tabId: TAB_ID,
          projectPath: '/tmp/test-project',
          setIsSaving,
          onSave,
          onContentChange: vi.fn(),
        }),
      { wrapper: makeWrapper(vi.fn()) },
    );

    seedStoreFileTab({ content: 'v2', isDirty: true });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(onSave).toHaveBeenCalledWith('v2');
    expect(setIsSaving).toHaveBeenNthCalledWith(1, true);
    expect(setIsSaving).toHaveBeenLastCalledWith(false);
  });
});
