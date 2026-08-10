import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProvider } from '@/shared/contexts';
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
            agentPluginConfigs: {},
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
        tabKey: 'test-project-id:test-project-id',
        tabId: tab.id,
        projectPath: '/tmp/test-project',
        currentContent: '<html></html>',
        setIsSaving: vi.fn(),
        onSave: vi.fn(),
        onContentChange: vi.fn(),
      }),
    { wrapper: makeWrapper(showToast) },
  );
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
