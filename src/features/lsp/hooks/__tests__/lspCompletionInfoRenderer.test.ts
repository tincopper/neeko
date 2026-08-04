// Mock the heavy CM6 packages before importing the unit under test.
vi.mock('@codemirror/lsp-client', () => ({
  // `serverCompletionSource` is the canonical source we wrap. Mock it so we
  // can control the returned completion options without an LSP round-trip.
  serverCompletionSource: vi.fn().mockResolvedValue(null),
  LSPPlugin: { get: vi.fn() },
}));
vi.mock('@codemirror/view', () => ({ type: {} }));
vi.mock('@codemirror/autocomplete', () => ({
  autocompletion: () => ({}),
}));

import { LSPPlugin, serverCompletionSource } from '@codemirror/lsp-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createThemedCompletionSource, flipPositionInfo } from '../lspCompletionInfoRenderer';

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
    const optionWithDocs = {
      label: 'foo',
      documentation: '**hello**',
      info: function original() {
        return document.createElement('div');
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

    const plugin = {
      docToHTML: vi.fn().mockReturnValue('<strong>hello</strong>'),
    };
    vi.mocked(LSPPlugin.get).mockReturnValue(plugin as any);

    const fakeView = { fake: true } as any;
    await createThemedCompletionSource({ view: fakeView } as any);

    const infoResult = optionWithDocs.info();
    expect(LSPPlugin.get).toHaveBeenCalledWith(fakeView);
    expect(plugin.docToHTML).toHaveBeenCalledWith('**hello**');
    expect(infoResult).toBeInstanceOf(HTMLElement);
    expect(infoResult.className).toContain('cm-lsp-hover-tooltip');
    expect(infoResult.className).toContain('cm-lsp-documentation');
    expect(infoResult.innerHTML).toBe('<strong>hello</strong>');
  });

  it('should_fall_back_to_original_info_when_plugin_unavailable', async () => {
    const fallback = document.createElement('div');
    fallback.className = 'default';

    const option = {
      label: 'bar',
      documentation: '**docs**',
      info: function original() {
        return fallback;
      },
    };

    vi.mocked(serverCompletionSource).mockResolvedValue({
      options: [option],
      from: 0,
      to: 3,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(LSPPlugin.get).mockReturnValue(undefined as any);

    await createThemedCompletionSource({ view: {} } as any);

    const result = option.info();
    expect(result).toBe(fallback);
    expect(result.className).toBe('default');
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
    expect(result.style).toContain(`left: ${list.right + 4}px`);
  });

  it('should_flip_to_left_when_right_overflows', () => {
    // List sits near the right edge — the 400px-wide info would overflow.
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
    expect(result.style).toContain('right: 4px');
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
});
