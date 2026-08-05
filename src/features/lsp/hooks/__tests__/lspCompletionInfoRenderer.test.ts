// Mock the heavy CM6 packages before importing the unit under test.
const { snippetMock } = vi.hoisted(() => ({ snippetMock: vi.fn() }));
vi.mock('@codemirror/lsp-client', () => ({
  // `serverCompletionSource` is the canonical source we wrap. Mock it so we
  // can control the returned completion options without an LSP round-trip.
  serverCompletionSource: vi.fn().mockResolvedValue(null),
  LSPPlugin: { get: vi.fn() },
}));
vi.mock('@codemirror/view', () => ({
  EditorView: {
    theme: (spec: unknown) => ({ type: 'theme', spec }),
    baseTheme: (spec: unknown) => ({ type: 'baseTheme', spec }),
  },
  tooltips: (config: unknown) => ({ type: 'tooltips', config }),
}));
vi.mock('@codemirror/autocomplete', () => ({
  autocompletion: (config: unknown) => ({ type: 'autocompletion', config }),
  snippet: snippetMock,
}));

import { LSPPlugin, serverCompletionSource } from '@codemirror/lsp-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildFunctionSnippet,
  extractParamName,
  parseSignatureParams,
} from '../completionRenderer';
import {
  createThemedCompletionSource,
  createThemedServerCompletion,
  flipPositionInfo,
} from '../lspCompletionInfoRenderer';

describe('createThemedCompletionSource', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should_passthrough_null_result_from_underlying_source', async () => {
    vi.mocked(serverCompletionSource).mockResolvedValue(null);

    const result = await createThemedCompletionSource({ view: {} } as any);
    expect(result).toBeNull();
  });

  it('should_replace_info_renderer_on_options_with_documentation', async () => {
    const docsNode = document.createElement('div');
    docsNode.innerHTML = '<strong>hello</strong>';

    const optionWithDocs = {
      label: 'foo',
      documentation: '**hello**',
      info: function original() {
        return docsNode;
      },
    };

    // `serverCompletionSource` returns a `CompletionResult` with `.options`.
    vi.mocked(serverCompletionSource).mockResolvedValue({
      options: [optionWithDocs],
      from: 0,
      to: 3,
      validFor: /^\w*$/,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const fakeView = { fake: true } as any;
    await createThemedCompletionSource({ view: fakeView } as any);

    // themedInfo is async: it invokes the original renderer and lifts its HTML.
    const infoResult = await optionWithDocs.info();
    expect(infoResult).toBeInstanceOf(HTMLElement);
    expect(infoResult.className).toContain('cm-lsp-completion-info');
    expect(infoResult.querySelector('.cm-lsp-info-docs')?.innerHTML).toBe('<strong>hello</strong>');
  });

  it('should_build_themed_panel_even_without_original_info', async () => {
    // No `info` function (no documentation from the server) — the themed
    // panel must still render (signature + params + returns only).
    const optionNoInfo = { label: 'count', kind: 6, detail: 'int' } as any;
    vi.mocked(serverCompletionSource).mockResolvedValue({
      options: [optionNoInfo],
      from: 0,
      to: 3,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await createThemedCompletionSource({ view: {} } as any);

    const result = await optionNoInfo.info();
    expect(result).toBeInstanceOf(HTMLElement);
    expect(result.className).toContain('cm-lsp-completion-info');
  });

  it('should_skip_options_without_info', async () => {
    const optionNoInfo = { label: 'baz' };
    vi.mocked(serverCompletionSource).mockResolvedValue({
      options: [optionNoInfo],
      from: 0,
      to: 3,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // Should not throw.
    await expect(createThemedCompletionSource({ view: {} } as any)).resolves.toBeTruthy();
  });

  it('should_handle_empty_options_array', async () => {
    vi.mocked(serverCompletionSource).mockResolvedValue({
      options: [],
      from: 0,
      to: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await expect(createThemedCompletionSource({ view: {} } as any)).resolves.toBeTruthy();
  });
});

describe('flipPositionInfo', () => {
  // Note: the returned coordinates are RELATIVE to the completion-list DOM
  // (CM6 mounts the info panel as a child of the list tooltip), so assertions
  // subtract `list.top`/`list.left` — never viewport coordinates.

  it('should_place_on_right_when_space_available', () => {
    const list = { left: 100, right: 200, top: 50, bottom: 300 };
    const info = { left: 0, right: 400, top: 0, bottom: 200 };
    const space = { left: 0, right: 800, top: 0, bottom: 600 };

    const result = flipPositionInfo(
      {} as any,
      list,
      { left: 0, right: 0, top: 0, bottom: 0 },
      info,
      space,
    );

    expect(result.class).toContain('cm-tooltip-right');
    // Relative to the list: right side = list width + 4px gap.
    expect(result.style).toContain(`left: ${list.right - list.left + 4}px`);
  });

  it('should_flip_to_left_when_right_overflows', () => {
    // List sits near the right edge — the 400px-wide info would overflow.
    // Panel should be placed to the left of the list, not pinned to the
    // viewport right edge.
    const list = { left: 500, right: 600, top: 50, bottom: 300 };
    const info = { left: 0, right: 400, top: 0, bottom: 200 };
    const space = { left: 0, right: 800, top: 0, bottom: 600 };

    const result = flipPositionInfo(
      {} as any,
      list,
      { left: 0, right: 0, top: 0, bottom: 0 },
      info,
      space,
    );

    expect(result.class).toContain('cm-tooltip-left');
    expect(result.style).toContain('right:');
    expect(result.style).not.toContain('left:');
    expect(result.style).toContain(`right: ${list.right - list.left + 4}px`);
  });

  it('should_keep_right_when_left_fits_but_also_fits_right', () => {
    // Both sides fit — prefer right (the editor's default UX).
    const list = { left: 100, right: 200, top: 50, bottom: 300 };
    const info = { left: 0, right: 150, top: 0, bottom: 200 };
    const space = { left: 0, right: 800, top: 0, bottom: 600 };

    const result = flipPositionInfo(
      {} as any,
      list,
      { left: 0, right: 0, top: 0, bottom: 0 },
      info,
      space,
    );

    expect(result.class).toContain('cm-tooltip-right');
  });

  it('should_follow_the_selected_option_vertically', () => {
    // IDEA-style: the detail panel tracks the selected item, not the list top.
    const list = { left: 100, right: 200, top: 50, bottom: 300 };
    const option = { left: 100, right: 200, top: 180, bottom: 200 };
    const info = { left: 0, right: 300, top: 0, bottom: 120 };
    const space = { left: 0, right: 800, top: 0, bottom: 600 };

    const result = flipPositionInfo({} as any, list, option as any, info, space);

    expect(result.style).toContain(`top: ${option.top - list.top}px`);
  });

  it('should_clamp_top_to_viewport_when_option_is_near_bottom', () => {
    // The panel must not overflow past the viewport bottom edge.
    const list = { left: 100, right: 200, top: 50, bottom: 560 };
    const option = { left: 100, right: 200, top: 560, bottom: 570 };
    const info = { left: 0, right: 300, top: 0, bottom: 200 };
    const space = { left: 0, right: 800, top: 0, bottom: 600 };

    const result = flipPositionInfo({} as any, list, option as any, info, space);

    const top = parseInt(result.style.match(/top: (\d+)px/)?.[1] ?? '-1', 10);
    // Relative to the list: panel bottom (list-relative) must stay inside the
    // viewport (space.bottom - list.top).
    expect(top + 200).toBeLessThanOrEqual(space.bottom - list.top);
  });

  it('should_not_detach_from_list_when_option_near_bottom', () => {
    // IDEA-style: the info panel must stay visually attached to the list.
    // When the selected option is near the bottom, push the panel up so
    // its bottom aligns with the list bottom — never let it hang below
    // the list (floating disconnected look).
    const list = { left: 100, right: 200, top: 100, bottom: 300 };
    const option = { left: 100, right: 200, top: 280, bottom: 300 };
    const info = { left: 0, right: 300, top: 0, bottom: 150 };
    const space = { left: 0, right: 800, top: 0, bottom: 600 };

    const result = flipPositionInfo({} as any, list, option as any, info, space);
    const top = parseInt(result.style.match(/top: (\d+)px/)?.[1] ?? '-1', 10);
    const infoHeight = 150;
    const listHeight = list.bottom - list.top;

    // Bottom edge must not exceed the list bottom — panel stays anchored.
    expect(top + infoHeight).toBeLessThanOrEqual(listHeight);
    // Top must not go above the list top (list-relative origin).
    expect(top).toBeGreaterThanOrEqual(0);
    // Panel should be pushed up from the option to fit within the list.
    expect(top).toBeLessThan(option.top - list.top);
  });

  it('should_align_top_with_list_top_when_option_is_near_top', () => {
    // When the selected option is near the top of the list and the info
    // panel is tall, clamp to the list top so the panel doesn't float
    // above the list (disconnected look).
    const list = { left: 100, right: 200, top: 100, bottom: 400 };
    const option = { left: 100, right: 200, top: 105, bottom: 125 };
    const info = { left: 0, right: 300, top: 0, bottom: 350 };
    const space = { left: 0, right: 800, top: 0, bottom: 600 };

    const result = flipPositionInfo({} as any, list, option as any, info, space);
    const top = parseInt(result.style.match(/top: (\d+)px/)?.[1] ?? '-1', 10);

    // Panel top should be at the list top (relative origin 0) — no floating.
    expect(top).toBeGreaterThanOrEqual(0);
  });

  it('should_follow_option_when_everything_fits', () => {
    // Normal case: option is in the middle, panel fits entirely within
    // both the list range and the viewport. Panel follows the option.
    const list = { left: 100, right: 200, top: 100, bottom: 400 };
    const option = { left: 100, right: 200, top: 200, bottom: 220 };
    const info = { left: 0, right: 300, top: 0, bottom: 100 };
    const space = { left: 0, right: 800, top: 0, bottom: 600 };

    const result = flipPositionInfo({} as any, list, option as any, info, space);

    expect(result.style).toContain(`top: ${option.top - list.top}px`);
  });

  it('should_narrow_panel_when_neither_side_has_full_width', () => {
    // Narrow pane: the 440px-wide panel fits neither right nor left of the
    // list. It must shrink to the available space and stay on the viewport
    // side with more room — never spill past the edge or overlap the list.
    const list = { left: 150, right: 850, top: 50, bottom: 300 };
    const option = { left: 150, right: 850, top: 180, bottom: 200 };
    const info = { left: 0, right: 440, top: 0, bottom: 200 };
    const space = { left: 0, right: 1000, top: 0, bottom: 600 };

    const result = flipPositionInfo({} as any, list, option as any, info, space);

    // Both sides have equal room (146px) — right wins the tie-break.
    expect(result.class).toContain('cm-tooltip-right');
    const maxWidth = parseInt(result.style.match(/max-width: (\d+)px/)?.[1] ?? '-1', 10);
    // Narrowed to the available space on the right, not the full 440px.
    expect(maxWidth).toBeLessThan(info.right - info.left);
    expect(maxWidth).toBeGreaterThanOrEqual(120);
    // Panel left edge stays inside the viewport (relative to the list).
    expect(result.style).toContain(`left: ${list.right - list.left + 4}px`);
  });

  it('should_pick_the_side_with_more_room_when_neither_fits', () => {
    // Neither side fits the full 440px; the panel should sit on the side with
    // more available space instead of blindly defaulting to the right.
    const info = { left: 0, right: 440, top: 0, bottom: 200 };
    const space = { left: 0, right: 1200, top: 0, bottom: 600 };

    // List near the right edge: left has 396px, right only 96px.
    const listRight = { left: 400, right: 1100, top: 50, bottom: 300 };
    const resultRight = flipPositionInfo(
      {} as any,
      listRight,
      { left: 400, right: 1100, top: 180, bottom: 200 } as any,
      info,
      space,
    );
    expect(resultRight.class).toContain('cm-tooltip-left');
    expect(resultRight.style).not.toContain('left:');

    // List near the left edge: right has 396px, left only 96px.
    const listLeft = { left: 100, right: 800, top: 50, bottom: 300 };
    const resultLeft = flipPositionInfo(
      {} as any,
      listLeft,
      { left: 100, right: 800, top: 180, bottom: 200 } as any,
      info,
      space,
    );
    expect(resultLeft.class).toContain('cm-tooltip-right');
    expect(resultLeft.style).not.toContain('right:');
  });
});

describe('parseSignatureParams', () => {
  it('should_extract_typed_parameters_from_label', () => {
    expect(parseSignatureParams('foo(param1 string, param2 int) error')).toEqual([
      'param1 string',
      'param2 int',
    ]);
  });

  it('should_extract_colon_annotated_parameters', () => {
    expect(parseSignatureParams('foo(param1: str, param2: int) -> None')).toEqual([
      'param1: str',
      'param2: int',
    ]);
  });

  it('should_return_empty_array_for_no_parameters', () => {
    expect(parseSignatureParams('foo()')).toEqual([]);
  });

  it('should_handle_nested_parentheses_with_top_level_split', () => {
    expect(parseSignatureParams('foo(callback func(a int, b int) error, x int)')).toEqual([
      'callback func(a int, b int) error',
      'x int',
    ]);
  });

  it('should_return_null_when_label_has_no_parenthesis', () => {
    expect(parseSignatureParams('fooBar')).toBeNull();
  });
});

describe('extractParamName', () => {
  it('should_take_the_first_identifier_from_a_typed_param', () => {
    expect(extractParamName('param1 string')).toBe('param1');
    expect(extractParamName('param2: str = "x"')).toBe('param2');
  });

  it('should_strip_variadic_dots', () => {
    expect(extractParamName('...args ...int')).toBe('args');
  });

  it('should_return_empty_for_blank_param', () => {
    expect(extractParamName('')).toBe('');
  });
});

describe('buildFunctionSnippet', () => {
  it('should_build_named_placeholders_from_signature', () => {
    expect(buildFunctionSnippet('foo', 'foo(param1 string, param2 int) error')).toBe(
      'foo(${1:param1}, ${2:param2})',
    );
  });

  it('should_build_empty_first_field_when_no_params', () => {
    expect(buildFunctionSnippet('foo', 'foo()')).toBe('foo(${1})');
  });

  it('should_build_cursor_field_when_label_has_no_signature', () => {
    expect(buildFunctionSnippet('foo', 'foo')).toBe('foo(${1})');
  });
});

describe('createThemedCompletionSource snippet fallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should_add_snippet_apply_for_function_completions_without_snippet', async () => {
    // Server returns a function completion whose insertText is the bare name
    // (snippetSupport off or server omitted insertText). We must build a
    // parameter snippet so accepting auto-fills arguments (IDEA-style).
    const optionWithDocs = {
      label: 'parse(string) error',
      kind: 3, // Function
      insertTextFormat: 1, // PlainText
      documentation: '**docs**',
      info: function original() {
        return document.createElement('div');
      },
    };

    vi.mocked(serverCompletionSource).mockResolvedValue({
      options: [optionWithDocs],
      from: 0,
      to: 5,
      validFor: /^\w*$/,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const plugin = { docToHTML: vi.fn().mockReturnValue('<strong>docs</strong>') };
    vi.mocked(LSPPlugin.get).mockReturnValue(plugin as any);
    const applySpy = vi.fn();
    snippetMock.mockReturnValue(applySpy);

    await createThemedCompletionSource({ view: {} } as any);

    expect(typeof optionWithDocs.apply).toBe('function');

    // Applying the completion must delegate to `snippet()` with the built
    // template `parse(${1:string})`, so the cursor lands on the parameter.
    (optionWithDocs.apply as any)({}, {}, 0, 5);
    expect(snippetMock).toHaveBeenCalledWith('parse(${1:string})');
    expect(applySpy).toHaveBeenCalledWith({}, {}, 0, 5);
  });

  it('should_not_override_snippet_apply_when_server_sent_snippet', async () => {
    const serverApply = vi.fn();
    const option = {
      label: 'foo',
      kind: 3,
      insertTextFormat: 2, // Snippet — server already provided placeholders
      info: function original() {
        return document.createElement('div');
      },
      apply: serverApply,
    };

    vi.mocked(serverCompletionSource).mockResolvedValue({
      options: [option],
      from: 0,
      to: 3,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(LSPPlugin.get).mockReturnValue({ docToHTML: vi.fn() } as any);

    await createThemedCompletionSource({ view: {} } as any);

    expect(option.apply).toBe(serverApply);
  });

  it('should_leave_non_function_completions_untouched', async () => {
    const option = {
      label: 'count',
      kind: 6, // Variable
      insertTextFormat: 1,
      info: function original() {
        return document.createElement('div');
      },
    };

    vi.mocked(serverCompletionSource).mockResolvedValue({
      options: [option],
      from: 0,
      to: 5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(LSPPlugin.get).mockReturnValue({ docToHTML: vi.fn() } as any);

    await createThemedCompletionSource({ view: {} } as any);

    expect(option.apply).toBeUndefined();
  });
});

describe('createThemedServerCompletion', () => {
  it('returns an array of extensions', () => {
    const result = createThemedServerCompletion();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes a completion theme extension', () => {
    const result = createThemedServerCompletion() as any[];
    const themeExt = result.find((e) => e.type === 'theme');
    expect(themeExt).toBeDefined();
    expect(themeExt.spec).toBeDefined();
  });

  it('includes an autocompletion extension with override source', () => {
    const result = createThemedServerCompletion() as any[];
    const acExt = result.find((e) => e.type === 'autocompletion');
    expect(acExt).toBeDefined();
    expect(acExt.config).toBeDefined();
    expect(Array.isArray(acExt.config.override)).toBe(true);
    expect(acExt.config.override.length).toBe(1);
  });

  it('includes tooltips config with fixed positioning (prevents clipping)', () => {
    // Tooltips must use position: 'fixed' so the dropdown can extend
    // past the editor's bottom edge without being clipped.
    const result = createThemedServerCompletion() as any[];
    const ttExt = result.find((e) => e.type === 'tooltips');
    expect(ttExt).toBeDefined();
    expect(ttExt.config.position).toBe('fixed');
  });

  it('sets closeOnBlur to true on autocompletion', () => {
    const result = createThemedServerCompletion() as any[];
    const acExt = result.find((e) => e.type === 'autocompletion');
    expect(acExt.config.closeOnBlur).toBe(true);
  });
});
