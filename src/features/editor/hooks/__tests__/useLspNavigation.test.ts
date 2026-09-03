import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadDefinitionTargetContent, showNavigationFailure } from '@/features/lsp';
import type { LspLocation } from '@/features/lsp/types';

import { useLspNavigation } from '../useLspNavigation';

// 捕获接缝：navigateToLocation 是 hook 内部函数，经 useCmdClickGoToDefinition
// 的参数暴露。mock 该模块抓住引用，即可直接驱动验证预读内容契约。
const h = vi.hoisted(() => ({
  capturedNavigate: null as null | ((...args: unknown[]) => Promise<void>),
  addTab: vi.fn(),
  setPendingNavigateTarget: vi.fn(),
}));

vi.mock('../useCmdClickGoToDefinition', () => ({
  useCmdClickGoToDefinition: (params: { navigateToLocation: typeof h.capturedNavigate }) => {
    h.capturedNavigate = params.navigateToLocation;
    return [];
  },
}));

vi.mock('@/features/lsp', () => ({
  fromFileUri: (uri: string) => uri.replace('file://', ''),
  toFileUri: (_base: string, p: string) => `file://${p}`,
  loadDefinitionTargetContent: vi.fn(),
  showNavigationFailure: vi.fn(),
  useLspDefinition: () => ({
    goToDefinitionWithContent: vi.fn(),
    findReferences: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/useResolvedShortcuts', () => ({
  useCodeMirrorBinding: () => null,
}));

vi.mock('@/shared/store/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      tabs: {},
      setPendingNavigateTarget: h.setPendingNavigateTarget,
      addTab: h.addTab,
      activateTab: vi.fn(),
    }),
  },
}));

vi.mock('@/shared/store/navigationHistoryStore', () => ({
  captureCurrentNavLocation: () => null,
  recordNavigationJump: vi.fn(),
}));

vi.mock('@/shared/utils/codemirror', () => ({
  getLanguageExtension: () => Promise.resolve(null),
  preloadLanguageExtension: vi.fn(),
}));

const LOCATION: LspLocation = {
  uri: 'file:///repo/src/lib.rs',
  range: { start: { line: 3, character: 1 }, end: { line: 3, character: 5 } },
};

const TAB = { filePath: '/repo/src/main.rs', projectId: 'proj-1' };

/** 渲染 hook 并取出被捕获的内部 navigateToLocation。 */
function getNavigateToLocation(): (...args: unknown[]) => Promise<void> {
  const { result } = renderHook(() =>
    useLspNavigation({
      projectPath: '/repo',
      tabKey: 'k1',
      tab: TAB as never,
      lspLanguageIdRef: { current: 'rust' },
      editorViewRef: { current: null },
    }),
  );
  expect(result.current.cmdClickExt).toEqual([]);
  expect(h.capturedNavigate).toBeTypeOf('function');
  return h.capturedNavigate as (...args: unknown[]) => Promise<void>;
}

describe('useLspNavigation — 预读内容契约防御', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.capturedNavigate = null;
  });

  it('should_preload_tab_content_when_preloaded_is_plain_string', async () => {
    const navigate = getNavigateToLocation();

    await navigate(LOCATION, '/repo', 'k1', 'proj-1', '/repo/src/main.rs', 'file body');

    expect(loadDefinitionTargetContent).not.toHaveBeenCalled();
    expect(h.addTab).toHaveBeenCalledWith(
      'k1',
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'file',
          filePath: '/repo/src/lib.rs',
          content: {
            path: '/repo/src/lib.rs',
            content: 'file body',
            size: 'file body'.length,
            is_binary: false,
          },
          isDirty: false,
        }),
      }),
    );
  });

  it('should_report_byte_size_for_multibyte_preload', async () => {
    // size 契约为字节（对齐后端 FileContent.size 与兜底加载路径）：
    // '中文注释' 4 个 CJK 字符 = 12 字节，而 string.length 仅为 4（UTF-16 单元数）
    const navigate = getNavigateToLocation();

    await navigate(LOCATION, '/repo', 'k1', 'proj-1', '/repo/src/main.rs', '中文注释');

    expect(h.addTab).toHaveBeenCalledWith(
      'k1',
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({ size: 12 }),
        }),
      }),
    );
  });

  it('should_discard_object_preload_and_fall_back_to_loader', async () => {
    // 回归模拟：后端曾把 FileContent 整对象塞进 fileContent（31a7d1d2）。
    // 防御要求：对象不进 doc，丢弃预读走兜底加载，tab 内容仍为合法文本。
    const navigate = getNavigateToLocation();
    vi.mocked(loadDefinitionTargetContent).mockResolvedValue({
      kind: 'project-file',
      content: { path: '/repo/src/lib.rs', content: 'fallback body', size: 13, is_binary: false },
    });

    await navigate(LOCATION, '/repo', 'k1', 'proj-1', '/repo/src/main.rs', {
      path: '/repo/src/lib.rs',
      content: 'MUST NOT BE USED',
      size: 99,
      is_binary: false,
    } as never);

    expect(loadDefinitionTargetContent).toHaveBeenCalledWith('proj-1', 'rust', LOCATION.uri);
    expect(h.addTab).toHaveBeenCalledWith(
      'k1',
      expect.objectContaining({
        data: expect.objectContaining({
          content: {
            path: '/repo/src/lib.rs',
            content: 'fallback body',
            size: 13,
            is_binary: false,
          },
        }),
      }),
    );
  });

  it('should_fall_back_to_loader_when_preload_is_null', async () => {
    const navigate = getNavigateToLocation();
    vi.mocked(loadDefinitionTargetContent).mockResolvedValue({
      kind: 'unavailable',
      reason: 'read-failed',
    });

    await navigate(LOCATION, '/repo', 'k1', 'proj-1', '/repo/src/main.rs', null);

    expect(loadDefinitionTargetContent).toHaveBeenCalledOnce();
    expect(showNavigationFailure).toHaveBeenCalledWith('read-failed');
    expect(h.addTab).not.toHaveBeenCalled();
    expect(h.setPendingNavigateTarget).toHaveBeenLastCalledWith(null);
  });

  it('should_mark_fallback_tab_readonly_for_external_target', async () => {
    const navigate = getNavigateToLocation();
    vi.mocked(loadDefinitionTargetContent).mockResolvedValue({
      kind: 'external-readonly',
      content: { path: '/opt/lib.rs', content: 'ext body', size: 8, is_binary: false },
    });

    await navigate(LOCATION, '/repo', 'k1', 'proj-1', '/repo/src/main.rs', null);

    expect(h.addTab).toHaveBeenCalledWith(
      'k1',
      expect.objectContaining({
        data: expect.objectContaining({
          content: { path: '/opt/lib.rs', content: 'ext body', size: 8, is_binary: false },
          readOnly: true,
        }),
      }),
    );
  });
});
