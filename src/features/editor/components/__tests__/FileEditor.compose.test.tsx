/**
 * `FileEditor` **组合冒烟测试** + `useFileEditorLsp` 的样式契约：只验证「装配接线」是否正确，
 * 不重复覆盖各 hook 的行为。
 *
 * 为什么需要它：文件编辑器的组合层（`FileViewer` / `FileEditor` / 各装配 hook）此前**零覆盖**，
 * 而这类文件最容易在「抽取 hook / 调换 hook 顺序 / 改返回值解构」时静默出错（F8 抽取即属此类，
 * 当时只能靠人工读 diff + tsc 兜住）。本用例把被抽取的 LSP 装配簇钉住：client 入参、两段式晚绑定
 * （`onOpenJdtLink` → `bind(navigateToLocation)`）、卸载解绑、交互态光标样式、以及兜底分支。
 *
 * Mock 边界：只替换「被装配的 hook 与外部功能」，被测单位（`FileEditor` + `useFileEditorLsp`）
 * 保持真实 —— 否则测试就退化成对 mock 的断言。
 */
import { render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLspStore } from '@/features/lsp/store/lspStore';
import { useDebugStore } from '@/features/runner/store/debugStore';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileTab } from '@/shared/types';
import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';
import { createProject } from '@/testing/factories';

const mocks = vi.hoisted(() => ({
  useLspClient: vi.fn(),
  useLspNavigation: vi.fn(),
  bind: vi.fn(),
  unbind: vi.fn(),
  onOpenJdtLink: vi.fn(),
  navigateToLocation: vi.fn(),
  cmdHeld: false,
  runMenu: null as { x: number; y: number } | null,
}));

vi.mock('@/features/lsp', () => ({
  useCmdHeld: () => mocks.cmdHeld,
  // 诊断投影是模块级单例扩展；本用例只验证装配接线，stub 成空数组。
  lspDiagnosticsProjection: () => [],
}));

vi.mock('../../hooks/useLspClient', () => ({ useLspClient: mocks.useLspClient }));

vi.mock('../../hooks/useLspNavigation', () => ({ useLspNavigation: mocks.useLspNavigation }));

vi.mock('../../hooks/useJdtLinkNavigation', () => ({
  useJdtLinkNavigation: () => ({ onOpenJdtLink: mocks.onOpenJdtLink, bind: mocks.bind }),
}));

// 运行入口（含 runnable 发现）与统一 gutter 与 LSP 装配无关，替换掉以免牵入任务/LSP 链路。
vi.mock('@/features/runner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/runner')>()),
  useRunActions: () => ({
    handleRun: vi.fn(),
    menu: mocks.runMenu,
    menuItems: [],
    openMenu: vi.fn(),
    closeMenu: vi.fn(),
  }),
}));

vi.mock('@/features/terminal', () => ({
  useTerminalTabs: () => ({ addTab: vi.fn(() => false) }),
}));

vi.mock('../../hooks/useUnifiedGutter', () => ({
  useUnifiedGutterExtension: () => [],
}));

vi.mock('../../hooks/useFileEditorCallbacks', () => ({
  useFileEditorCallbacks: () => ({
    handleInternalLinkClick: vi.fn(),
    handleOpenSearch: vi.fn(),
    handleOpenAI: vi.fn(),
  }),
}));

// ContextMenu 只作为「菜单已被条件渲染」的探针，行为归它自己的测试。
vi.mock('@/shared/components/ContextMenu', () => ({
  default: () => <div data-testid="ctx-menu" />,
}));

import { useFileEditorLsp } from '../../hooks/useFileEditorLsp';
import FileEditor from '../FileEditor';

const PROJECT_PATH = '/repo';
const FILE_PATH = `${PROJECT_PATH}/src/a.ts`;
const TAB_ID = `p1:${FILE_PATH}`;

function makeTab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: TAB_ID,
    projectId: 'p1',
    filePath: FILE_PATH,
    fileName: 'a.ts',
    content: { path: FILE_PATH, content: 'const a = 1;\n', size: 13, is_binary: false },
    isDirty: false,
    order: 0,
    initialPreviewMode: 'source',
    ...overrides,
  };
}

function editorElement(tab: FileTab = makeTab()) {
  return (
    <FileEditor
      tab={tab}
      tabKey="p1"
      tabId={TAB_ID}
      externallyModified={false}
      theme={'dark' as never}
      fontFamily="mono"
      fontSize={13}
      projectPath={PROJECT_PATH}
      onSave={vi.fn(async () => true)}
      onContentChange={vi.fn()}
    />
  );
}

/** 一次组合渲染（组合层需要 AppContext：`useEditorSave` 会读它）。 */
function renderEditor(tab: FileTab = makeTab()) {
  return render(editorElement(tab), { wrapper: createAppProviderWrapper() });
}

beforeEach(() => {
  mocks.cmdHeld = false;
  mocks.runMenu = null;
  mocks.bind.mockReset();
  mocks.unbind.mockReset();
  mocks.bind.mockReturnValue(mocks.unbind);
  mocks.useLspClient.mockReset();
  mocks.useLspClient.mockReturnValue({
    lspLanguageIdRef: { current: 'typescript' },
    lspClientExt: [],
    linkHighlightExt: [],
  });
  mocks.useLspNavigation.mockReset();
  mocks.useLspNavigation.mockReturnValue({
    lspKeymap: [],
    cmdClickExt: [],
    navigateToLocation: mocks.navigateToLocation,
  });

  // 必须用工厂：组合层里 useEditorSave → useActiveProject 会读 `environment.type`，
  // 手搭的最小 project 对象会在那里抛错（本冒烟测试第一次运行就抓到了这条隐式依赖）。
  useProjectStore.setState({
    activeProjectId: 'p1',
    activeProject: createProject({ id: 'p1', path: PROJECT_PATH }),
  });
  useDebugStore.setState({ session: null, breakpoints: {} });
  useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  useLspStore.setState({ isDefinitionJumping: false } as never);
});

describe('FileEditor 组合冒烟（装配接线）', () => {
  it('挂载编辑器并完成 LSP 装配：client 入参 + 两段式晚绑定 + 卸载解绑', () => {
    const { unmount } = renderEditor();

    // ① 真实挂载：CodeMirror 起来了（走通 useEditorExtensions / viewStateExt / gutter 装配链）
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    // ② client 拿到本 tab 的路径（virtualUri 派生自 tab）
    expect(mocks.useLspClient).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: PROJECT_PATH,
        filePath: FILE_PATH,
        onOpenJdtLink: mocks.onOpenJdtLink,
      }),
    );

    // ③ 两段式晚绑定：navigateToLocation 就绪后 bind，并把 tab 上下文交出去
    expect(mocks.bind).toHaveBeenCalledWith(
      mocks.navigateToLocation,
      expect.objectContaining({
        projectPath: PROJECT_PATH,
        tabKey: 'p1',
        projectId: 'p1',
        filePath: FILE_PATH,
      }),
    );

    // ④ 卸载时执行 bind 返回的解绑（effect 返回值接线）
    expect(mocks.unbind).not.toHaveBeenCalled();
    unmount();
    expect(mocks.unbind).toHaveBeenCalledTimes(1);
  });

  it('兜底分支（二进制文件）不实例化编辑器装配', () => {
    const binary = makeTab({
      content: { path: FILE_PATH, content: '', size: 8, is_binary: true },
    });

    renderEditor(binary);

    // 二进制走 FileEditorFallback：不应出现编辑器输入区
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('运行/调试菜单打开时条件渲染 ContextMenu', () => {
    mocks.runMenu = { x: 10, y: 20 };

    renderEditor();

    expect(screen.getByTestId('ctx-menu')).toBeInTheDocument();
  });
});

describe('useFileEditorLsp — 交互态光标样式契约（cmd-held / lsp-jumping）', () => {
  const editorViewRef = { current: null };

  function renderLsp() {
    return renderHook(() =>
      useFileEditorLsp({
        tab: makeTab(),
        tabKey: 'p1',
        projectPath: PROJECT_PATH,
        editorViewRef: editorViewRef as never,
      }),
    );
  }

  it('默认只有基础类名', () => {
    expect(renderLsp().result.current.cmClassName).toBe('h-full overflow-hidden');
  });

  it('Cmd 按住 → cmd-held；跳转进行中 → lsp-jumping', () => {
    mocks.cmdHeld = true;
    useLspStore.setState({ isDefinitionJumping: true } as never);

    const { cmClassName } = renderLsp().result.current;

    expect(cmClassName).toContain('cmd-held');
    expect(cmClassName).toContain('lsp-jumping');
    expect(cmClassName).toContain('h-full overflow-hidden');
  });
});
