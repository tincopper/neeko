import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadDefinitionTargetContent,
  showNavigationFailure,
} from '@/features/lsp/api/definitionTarget';
import type { LspLocation } from '@/features/lsp/types';

import { resolveLspDocumentUri, useLspNavigation } from '../useLspNavigation';

// 捕获接缝：navigateToLocation 是 hook 内部函数，经 useCmdClickGoToDefinition
// 的参数暴露。mock 该模块抓住引用，即可直接驱动验证预读内容契约。
const h = vi.hoisted(() => ({
  capturedNavigate: null as null | ((...args: unknown[]) => Promise<void>),
  addTab: vi.fn(),
  // 生产方失败路径凭 setNavigateGoal 返回的 seq 做货币性清除 —— mock 同形返回。
  setNavigateGoal: vi.fn(() => 1),
  clearNavigateGoal: vi.fn(),
  // 身份稳定（生产 useLspDefinition 返回 memo 化对象 / ref 由 useRef 恒定）：
  // 身份稳定用例必须同构，否则测的是 mock 抖动而非 hook 契约。
  definition: { goToDefinitionWithContent: vi.fn(), findReferences: vi.fn() },
  lspLanguageIdRef: { current: 'rust' as string | null },
  editorViewRef: { current: null },
}));

vi.mock('../useCmdClickGoToDefinition', () => ({
  useCmdClickGoToDefinition: (params: { navigateToLocation: typeof h.capturedNavigate }) => {
    h.capturedNavigate = params.navigateToLocation;
    return [];
  },
}));

// 门面已按 Firewall 规则 4 收敛为「公开 hooks + 类型」——函数式 API 一律直导
// `api/*`，故 mock 需按新的导入路径分别声明。
vi.mock('@/features/lsp/api/definitionTarget', () => ({
  jdtClassFileDisplayName: (uri: string) =>
    uri.split('?')[0]?.split('/').filter(Boolean).pop() ?? uri,
  loadDefinitionTargetContent: vi.fn(),
  showNavigationFailure: vi.fn(),
}));

vi.mock('@/features/lsp/api/languageMap', () => ({
  fromFileUri: (uri: string) => uri.replace('file://', ''),
  toFileUri: (_base: string, p: string) => `file://${p}`,
}));

vi.mock('@/features/lsp', () => ({
  useLspDefinition: () => h.definition,
}));

vi.mock('@/shared/hooks/useResolvedShortcuts', () => ({
  useCodeMirrorBinding: () => null,
}));

vi.mock('@/shared/store/editorStore', () => ({
  useEditorStore: {
    getState: () => ({
      tabs: {},
      setNavigateGoal: h.setNavigateGoal,
      clearNavigateGoal: h.clearNavigateGoal,
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

    expect(loadDefinitionTargetContent).toHaveBeenCalledWith(
      'proj-1',
      '/repo',
      'rust',
      LOCATION.uri,
    );
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
    // 货币性清除：失败路径必须凭 setNavigateGoal 返回的 seq 清自己的目标
    //（无参强制清会吞掉并发写入的新目标 —— 迟到失败清不得越权）。
    expect(h.clearNavigateGoal).toHaveBeenCalledWith(1);
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

  it('should_pass_fs_path_not_uuid_to_loader_for_external_target', async () => {
    // 回归：后端 preauth 表全用 fs path 做桶键（record/check 一致），UUID 在此
    // 恒 miss → jdt:// 与项目外 file:// 一律 read-failed。projectId(UUID)≠
    // projectPath(path) 时，loader 第 1 实参必须是 path（门控键），projId 只
    // 用于 NavLocation/tab 键。
    const { result } = renderHook(() =>
      useLspNavigation({
        projectPath: '/repo',
        tabKey: 'k1',
        tab: { filePath: '/repo/src/main.rs', projectId: 'uuid-1' } as never,
        lspLanguageIdRef: { current: 'java' },
        editorViewRef: { current: null },
      }),
    );
    expect(result.current.cmdClickExt).toEqual([]);
    const navigate = h.capturedNavigate as (...args: unknown[]) => Promise<void>;
    const JDT_URI = 'jdt://contents/java.base/java.lang/System.class?=x/=src/Main.java';
    vi.mocked(loadDefinitionTargetContent).mockResolvedValue({
      kind: 'external-readonly',
      content: { path: JDT_URI, content: 'class System {}', size: 15, is_binary: false },
    });

    await navigate(
      {
        uri: JDT_URI,
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } },
      },
      '/repo',
      'k1',
      'uuid-1',
      '/repo/src/main.rs',
      null,
    );

    // 双键：常规读取用 UUID，门控键是 fs path
    expect(loadDefinitionTargetContent).toHaveBeenCalledWith('uuid-1', '/repo', 'java', JDT_URI);
    expect(h.addTab).toHaveBeenCalledWith(
      'k1',
      expect.objectContaining({
        projectId: 'uuid-1',
        data: expect.objectContaining({
          readOnly: true,
          // tab 身份用 jdt 展示路径（tabIdentityOf，.java 结尾可命中高亮）；
          // 原始 uri（tab 内 LSP 请求凭据）经 virtualUri / content.path 各司其职
          filePath: 'jdt:/java.base/java/lang/System.java',
        }),
      }),
    );
  });

  it('should_stay_in_same_tab_for_same_file_jump_with_relative_tab_path', async () => {
    // 回归：快速打开建的 tab 用项目相对 filePath（openProjectFile），definition
    // 目标是绝对路径——同文件比较必须先归一，否则重复开 tab。
    const { result } = renderHook(() =>
      useLspNavigation({
        projectPath: '/repo',
        tabKey: 'k1',
        tab: { filePath: 'src/main.rs', projectId: 'uuid-1' } as never,
        lspLanguageIdRef: { current: 'rust' },
        editorViewRef: { current: null },
      }),
    );
    expect(result.current.cmdClickExt).toEqual([]);
    const navigate = h.capturedNavigate as (...args: unknown[]) => Promise<void>;

    await navigate(
      {
        uri: 'file:///repo/src/main.rs',
        range: { start: { line: 4, character: 2 }, end: { line: 4, character: 6 } },
      },
      '/repo',
      'k1',
      'uuid-1',
      'src/main.rs',
      null,
    );

    expect(h.addTab).not.toHaveBeenCalled();
    expect(h.setNavigateGoal).not.toHaveBeenCalled();
    expect(loadDefinitionTargetContent).not.toHaveBeenCalled();
  });
});

describe('resolveLspDocumentUri — jdt 展示身份缺原始 uri 时不得伪造文档', () => {
  it('tab 自带原始 jdt uri → 原样', () => {
    expect(
      resolveLspDocumentUri(
        { filePath: '/a.ts', virtualUri: 'jdt://contents/java.base/Foo.class?=q' },
        '/repo',
      ),
    ).toBe('jdt://contents/java.base/Foo.class?=q');
  });

  it('jdt 展示身份 + 无原始 uri（调试打开的 JDK 源码）→ null，调用方跳过 LSP', () => {
    expect(
      resolveLspDocumentUri(
        {
          filePath: 'jdt:/java.base/java/io/PrintStream.java',
          content: { path: '/cache/jdk-src-21/java.base/java/io/PrintStream.java' },
        },
        '/repo',
      ),
    ).toBeNull();
  });

  it('常规文件 → file:// 文档', () => {
    expect(resolveLspDocumentUri({ filePath: 'src/a.ts' }, '/repo')).toBe('file://src/a.ts');
  });

  it('缺 projectPath 的常规文件 → null', () => {
    expect(resolveLspDocumentUri({ filePath: 'src/a.ts' }, '')).toBeNull();
  });
});

describe('useLspNavigation — lspKeymap 身份稳定（配置纯净不变量）', () => {
  it('tab 换新对象引用（FileViewer 每次渲染新建）后 lspKeymap 引用不变', () => {
    const tab = { filePath: '/repo/src/main.rs', projectId: 'proj-1' };

    // 回归：keymap 进入 CodeMirror extensions 数组，身份一变宿主就 reconfigure
    // 重建整个扩展世界 —— lint 经 appendConfig 惰性安装的渲染扩展被丢掉，
    // 波浪线随每次内容变更闪烁/消失。
    const { result, rerender } = renderHook(
      (props: { tab: typeof tab }) =>
        useLspNavigation({
          projectPath: '/repo',
          tabKey: 'k1',
          tab: props.tab as never,
          lspLanguageIdRef: h.lspLanguageIdRef,
          editorViewRef: h.editorViewRef as never,
        }),
      { initialProps: { tab } },
    );

    const mounted = result.current.lspKeymap;
    rerender({ tab: { ...tab } });

    expect(result.current.lspKeymap).toBe(mounted);
  });
});
