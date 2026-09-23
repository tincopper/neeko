import type { EditorView } from '@codemirror/view';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LspLocation } from '@/features/lsp/types';

import {
  handleCmdClickToDefinition,
  isOnDefinitionSite,
  useCmdClickGoToDefinition,
} from '../useCmdClickGoToDefinition';

vi.mock('@/shared/utils/platform', () => ({ IS_MACOS: true }));
vi.mock('@/features/symbol-nav/store/referencesPeekStore', () => ({
  useReferencesPeekStore: { getState: vi.fn(() => ({ openPeek: vi.fn() })) },
}));

/** 显式标量入参（hook 只消费这些，不再捕获整个 tab 对象）。 */
const CMD_CLICK_TARGET = {
  lspDocumentUri: 'file:///repo/src/main.rs',
  projectId: 'proj-1',
  filePath: '/repo/src/main.rs',
};

const LOCATION: LspLocation = {
  uri: 'file:///repo/src/lib.rs',
  range: { start: { line: 3, character: 1 }, end: { line: 3, character: 5 } },
};

function makeView(overrides: Record<string, unknown> = {}) {
  return {
    dispatch: vi.fn(),
    posAtCoords: vi.fn(() => 5),
    state: { doc: { lineAt: vi.fn(() => ({ number: 2, from: 3 })) } },
    ...overrides,
  } as unknown as EditorView;
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    metaKey: true,
    ctrlKey: false,
    button: 0,
    preventDefault: vi.fn(),
    clientX: 10,
    clientY: 20,
    ...overrides,
  } as unknown as MouseEvent;
}

describe('handleCmdClickToDefinition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_jump_to_symbol_under_mouse_on_cmd_click', async () => {
    const view = makeView();
    const event = makeEvent();
    const goToDefinition = vi.fn().mockResolvedValue({ location: LOCATION, fileContent: 'src' });
    const navigateToLocation = vi.fn().mockResolvedValue(undefined);

    handleCmdClickToDefinition({
      event,
      view,
      projectPath: '/repo',
      tabKey: 'k1',
      ...CMD_CLICK_TARGET,
      lspLanguageIdRef: { current: 'rust' },
      goToDefinition,
      findReferences: vi.fn(),
      navigateToLocation,
    });

    // offset 5 on line 2 (from=3) → LSP line 1, character 2; uri 由调用方派生传入。
    expect(goToDefinition).toHaveBeenCalledWith('rust', 'file:///repo/src/main.rs', 1, 2);
    await vi.waitFor(() => {
      expect(navigateToLocation).toHaveBeenCalledWith(
        LOCATION,
        '/repo',
        'k1',
        'proj-1',
        '/repo/src/main.rs',
        'src',
      );
    });
  });

  it('should_ignore_non_modifier_click', () => {
    const goToDefinition = vi.fn();
    handleCmdClickToDefinition({
      event: makeEvent({ metaKey: false, ctrlKey: false }),
      view: makeView(),
      projectPath: '/repo',
      tabKey: 'k1',
      ...CMD_CLICK_TARGET,
      lspLanguageIdRef: { current: 'rust' },
      goToDefinition,
      findReferences: vi.fn(),
      navigateToLocation: vi.fn(),
    });
    expect(goToDefinition).not.toHaveBeenCalled();
  });

  it('should_ignore_click_when_no_language_id', () => {
    const goToDefinition = vi.fn();
    handleCmdClickToDefinition({
      event: makeEvent(),
      view: makeView(),
      projectPath: '/repo',
      tabKey: 'k1',
      ...CMD_CLICK_TARGET,
      lspLanguageIdRef: { current: null },
      goToDefinition,
      findReferences: vi.fn(),
      navigateToLocation: vi.fn(),
    });
    expect(goToDefinition).not.toHaveBeenCalled();
  });

  it('should_ignore_click_without_document_uri（jdt 展示路径等无有效文档身份）', () => {
    // 回归：uri 曾在此处由 tab 自行推导并回退 `file://jdt:/…` 伪造 uri，
    // 与 F12 keymap 的守卫（resolveLspDocumentUri 返回 null 即跳过）不一致。
    const goToDefinition = vi.fn();
    handleCmdClickToDefinition({
      event: makeEvent(),
      view: makeView(),
      projectPath: '/repo',
      tabKey: 'k1',
      ...CMD_CLICK_TARGET,
      lspDocumentUri: null,
      lspLanguageIdRef: { current: 'rust' },
      goToDefinition,
      findReferences: vi.fn(),
      navigateToLocation: vi.fn(),
    });
    expect(goToDefinition).not.toHaveBeenCalled();
  });

  it('should_ignore_click_outside_editor', () => {
    const goToDefinition = vi.fn();
    handleCmdClickToDefinition({
      event: makeEvent(),
      view: makeView({ posAtCoords: vi.fn(() => null) }),
      projectPath: '/repo',
      tabKey: 'k1',
      ...CMD_CLICK_TARGET,
      lspLanguageIdRef: { current: 'rust' },
      goToDefinition,
      findReferences: vi.fn(),
      navigateToLocation: vi.fn(),
    });
    expect(goToDefinition).not.toHaveBeenCalled();
  });

  it('should_ignore_click_when_position_resolution_fails', () => {
    const goToDefinition = vi.fn();
    handleCmdClickToDefinition({
      event: makeEvent(),
      view: makeView({
        state: {
          doc: {
            lineAt: vi.fn(() => {
              throw new Error('bad line');
            }),
          },
        },
      }),
      projectPath: '/repo',
      tabKey: 'k1',
      ...CMD_CLICK_TARGET,
      lspLanguageIdRef: { current: 'rust' },
      goToDefinition,
      findReferences: vi.fn(),
      navigateToLocation: vi.fn(),
    });
    expect(goToDefinition).not.toHaveBeenCalled();
  });
});

describe('isOnDefinitionSite — 定义处判定（纯函数）', () => {
  const HERE: LspLocation = {
    uri: 'file:///repo/src/main.rs',
    range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
  };

  it('should_treat_range_end_as_exclusive', () => {
    expect(isOnDefinitionSite('file:///repo/src/main.rs', 1, 2, HERE)).toBe(true);
    expect(isOnDefinitionSite('file:///repo/src/main.rs', 1, 5, HERE)).toBe(true);
    // 半开区间：end(8) 处已不属于该符号
    expect(isOnDefinitionSite('file:///repo/src/main.rs', 1, 8, HERE)).toBe(false);
    expect(isOnDefinitionSite('file:///repo/src/main.rs', 1, 7, HERE)).toBe(true);
  });

  it('should_return_false_when_different_file', () => {
    expect(isOnDefinitionSite('file:///repo/src/other.rs', 1, 5, HERE)).toBe(false);
  });

  it('should_return_false_when_same_file_different_line_or_outside_range', () => {
    expect(isOnDefinitionSite('file:///repo/src/main.rs', 2, 5, HERE)).toBe(false);
    expect(isOnDefinitionSite('file:///repo/src/main.rs', 1, 9, HERE)).toBe(false);
    expect(isOnDefinitionSite('file:///repo/src/main.rs', 1, 0, HERE)).toBe(false);
  });

  it('should_match_jdt_uris_with_different_queries_via_normalization', () => {
    const current = 'jdt://contents/java.base/java.io/PrintStream.class?=a';
    const loc: LspLocation = {
      uri: 'jdt://contents/java.base/java.io/PrintStream.class?=b',
      range: { start: { line: 10, character: 4 }, end: { line: 10, character: 15 } },
    };
    expect(isOnDefinitionSite(current, 10, 6, loc)).toBe(true);
  });

  it('should_not_guess_across_uri_forms_and_encodings', () => {
    const at = (uri: string): LspLocation => ({
      uri,
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
    });
    // jdt:/ 展示路径不是 LSP uri → 不判同文档（不猜）。
    expect(
      isOnDefinitionSite(
        'jdt:/java.base/java/io/PrintStream.java',
        1,
        3,
        at('jdt://contents/java.base/java.io/PrintStream.class?=x'),
      ),
    ).toBe(false);
    // 同一 file uri 的百分号编码差异 → 身份相等。
    expect(isOnDefinitionSite('file:///p/a%20b.rs', 1, 3, at('file:///p/a b.rs'))).toBe(true);
    // 两侧都解析不出的 scheme：完全相同的字符串仍是同一文档，不猜不同。
    expect(isOnDefinitionSite('untitled:Untitled-1', 1, 3, at('untitled:Untitled-1'))).toBe(true);
  });
});

describe('handleCmdClickToDefinition — 定义处弹调用窗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** 点击 offset 5 → LSP (1, 2)，落在定义名 range [(1,2),(1,8)] 内。 */
  function makeWordView() {
    return makeView({
      state: {
        doc: { lineAt: vi.fn(() => ({ number: 2, from: 3 })) },
        wordAt: vi.fn(() => ({ from: 1, to: 6 })),
        sliceDoc: vi.fn(() => 'my_fn'),
      },
    });
  }

  it('should_open_usages_without_jump_when_click_on_definition_name', async () => {
    const { useReferencesPeekStore } =
      await import('@/features/symbol-nav/store/referencesPeekStore');
    const openPeek = vi.fn();
    vi.mocked(useReferencesPeekStore.getState).mockReturnValue({ openPeek } as never);

    const refs = [
      {
        uri: 'file:///repo/src/call.rs',
        range: { start: { line: 9, character: 4 }, end: { line: 9, character: 9 } },
      },
    ];
    const goToDefinition = vi.fn().mockResolvedValue({
      location: {
        uri: 'file:///repo/src/main.rs',
        range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
      },
      fileContent: 'fn my_fn() {}',
    });
    const findReferences = vi.fn().mockResolvedValue(refs);
    const navigateToLocation = vi.fn();

    handleCmdClickToDefinition({
      event: makeEvent(),
      view: makeWordView(),
      projectPath: '/repo',
      tabKey: 'k1',
      ...CMD_CLICK_TARGET,
      lspLanguageIdRef: { current: 'rust' },
      goToDefinition,
      findReferences,
      navigateToLocation,
    });

    await vi.waitFor(() => {
      expect(findReferences).toHaveBeenCalledWith('rust', 'file:///repo/src/main.rs', 1, 2);
    });
    expect(openPeek).toHaveBeenCalledWith({
      projectId: 'proj-1',
      projectPath: '/repo',
      languageId: 'rust',
      locations: refs,
      symbolHint: 'my_fn',
      navigate: expect.any(Function),
    });
    // 端口必须把当前 tab 上下文绑进去（editor 是跳转实现的所有者）
    const port = openPeek.mock.calls[0][0].navigate as (loc: LspLocation) => Promise<void>;
    await port(refs[0]);
    expect(navigateToLocation).toHaveBeenCalledWith(
      refs[0],
      '/repo',
      'k1',
      'proj-1',
      CMD_CLICK_TARGET.filePath,
    );
  });

  it('should_jump_when_click_on_call_site', async () => {
    const { useReferencesPeekStore } =
      await import('@/features/symbol-nav/store/referencesPeekStore');
    const openPeek = vi.fn();
    vi.mocked(useReferencesPeekStore.getState).mockReturnValue({ openPeek } as never);

    // 定义在别文件 → 调用处，跳转。
    const goToDefinition = vi.fn().mockResolvedValue({ location: LOCATION, fileContent: 'src' });
    const findReferences = vi.fn();
    const navigateToLocation = vi.fn().mockResolvedValue(undefined);

    handleCmdClickToDefinition({
      event: makeEvent(),
      view: makeWordView(),
      projectPath: '/repo',
      tabKey: 'k1',
      ...CMD_CLICK_TARGET,
      lspLanguageIdRef: { current: 'rust' },
      goToDefinition,
      findReferences,
      navigateToLocation,
    });

    await vi.waitFor(() => {
      expect(navigateToLocation).toHaveBeenCalled();
    });
    expect(findReferences).not.toHaveBeenCalled();
    expect(openPeek).not.toHaveBeenCalled();
  });
});

describe('useCmdClickGoToDefinition', () => {
  it('should_return_empty_extension_without_project_path', () => {
    const { result } = renderHook(() =>
      useCmdClickGoToDefinition({
        projectPath: null,
        tabKey: 'k1',
        ...CMD_CLICK_TARGET,
        lspLanguageIdRef: { current: 'rust' },
        goToDefinition: vi.fn(),
        findReferences: vi.fn(),
        navigateToLocation: vi.fn(),
      }),
    );
    expect(result.current).toEqual([]);
  });

  it('should_return_dom_event_handler_extension_with_project_path', () => {
    const { result } = renderHook(() =>
      useCmdClickGoToDefinition({
        projectPath: '/repo',
        tabKey: 'k1',
        ...CMD_CLICK_TARGET,
        lspLanguageIdRef: { current: 'rust' },
        goToDefinition: vi.fn(),
        findReferences: vi.fn(),
        navigateToLocation: vi.fn(),
      }),
    );
    // Non-empty extension proves a view-lifetime `domEventHandlers` binding is
    // produced, unlike the previous effect-race ref binding that could no-op.
    expect(result.current).not.toEqual([]);
  });
});
