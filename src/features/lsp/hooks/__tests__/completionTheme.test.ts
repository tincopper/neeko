// Tests for the completionTheme EditorView.theme extension.
//
// We mock `@codemirror/view` so we can inspect the theme spec object
// that gets passed to `EditorView.theme()`, verifying all the key
// selectors and properties are present without spinning up a real editor.

vi.mock('@codemirror/view', () => ({
  EditorView: {
    theme: (spec: unknown) => ({ type: 'theme', spec }),
    baseTheme: (spec: unknown) => ({ type: 'baseTheme', spec }),
  },
}));

import { describe, expect, it } from 'vitest';

import { completionTheme } from '../completionTheme';

describe('completionTheme', () => {
  const theme = completionTheme() as { type: string; spec: Record<string, unknown> };

  it('returns an EditorView.theme extension', () => {
    expect(theme.type).toBe('theme');
    expect(theme.spec).toBeDefined();
    expect(typeof theme.spec).toBe('object');
  });

  it('styles the autocomplete dropdown container', () => {
    const dropdown = theme.spec['.cm-tooltip.cm-tooltip-autocomplete'] as Record<string, unknown>;
    expect(dropdown).toBeDefined();
    expect(dropdown.zIndex).toBe(5000);
    expect(dropdown.background).toBe('var(--bg-secondary)');
    expect(dropdown.border).toBe('1px solid var(--border-color)');
    expect(dropdown.borderRadius).toBe('var(--radius-apple-md, 11px)');
    expect(dropdown.boxShadow).toBeTruthy();
    expect(dropdown.color).toBe('var(--text-primary)');
  });

  it('styles the list container with horizontal scroll support', () => {
    const list = theme.spec['.cm-tooltip.cm-tooltip-autocomplete > ul'] as Record<string, unknown>;
    expect(list).toBeDefined();
    expect(list.overflow).toBe('auto');
    expect(list.minWidth).toBe('280px');
    expect(list.maxHeight).toBe('320px');
    expect(list.padding).toBe('4px 0');
    expect(list.fontFamily).toBe('inherit');
  });

  it('styles list items with two-line enhanced padding', () => {
    const items = theme.spec['.cm-tooltip.cm-tooltip-autocomplete > ul > li'] as Record<
      string,
      unknown
    >;
    expect(items).toBeDefined();
    expect(items.padding).toBe('8px 12px');
    expect(items.lineHeight).toBe(1.4);
    expect(items.borderLeft).toBe('2px solid transparent');
  });

  it('styles selected items with accent border and hover bg', () => {
    const selected = theme.spec['.cm-tooltip-autocomplete ul li[aria-selected="true"]'] as Record<
      string,
      unknown
    >;

    expect(selected).toBeDefined();
    expect(selected.background).toBe('var(--bg-hover)');
    expect(selected.color).toBe('var(--text-primary)');
    expect(selected.borderLeftColor).toBe('var(--accent-blue)');
  });

  it('styles the completion info panel (right column)', () => {
    const info = theme.spec['.cm-tooltip.cm-completionInfo'] as Record<string, unknown>;
    expect(info).toBeDefined();
    expect(info.zIndex).toBe(5001);
    expect(info.background).toBe('var(--bg-secondary)');
    expect(info.border).toBe('1px solid var(--border-color)');
    expect(info.borderRadius).toBe('var(--radius-apple-md, 11px)');
    expect(info.maxWidth).toBe('min(440px, 42vw)');
    expect(info.maxHeight).toBe('340px');
    expect(info.padding).toBe('10px 14px');
    expect(info.whiteSpace).toBe('normal');
  });

  it('uses a fixed width for the info panel (master-detail look)', () => {
    const info = theme.spec['.cm-tooltip.cm-completionInfo'] as Record<string, unknown>;
    const wrapper = theme.spec['.cm-tooltip.cm-lsp-completion-info-wrapper'] as Record<
      string,
      unknown
    >;
    // Fixed 440px column (clamped on narrow viewports) so list + panel read
    // as one connected master-detail widget, like the prototype.
    expect(info.width).toBe('440px');
    expect(info.maxWidth).toBe('min(440px, 42vw)');
    expect(wrapper).toBeDefined();
    expect(wrapper.width).toBe('440px');
  });

  it('positions info panel with 4px gap from the list', () => {
    const right = theme.spec['.cm-completionInfo.cm-completionInfo-right'] as Record<
      string,
      unknown
    >;
    const left = theme.spec['.cm-completionInfo.cm-completionInfo-left'] as Record<string, unknown>;

    expect(right).toBeDefined();
    expect(right.left).toBe('100%');
    expect(right.marginLeft).toBe('4px');

    expect(left).toBeDefined();
    expect(left.right).toBe('100%');
    expect(left.marginRight).toBe('4px');
  });

  it('styles the signature header inside info panel', () => {
    const sig = theme.spec['.cm-lsp-info-signature'] as Record<string, unknown>;
    expect(sig).toBeDefined();
    expect(sig.marginBottom).toBe('8px');
    expect(sig.paddingBottom).toBe('8px');
    expect(sig.borderBottom).toBe('1px solid var(--border-color)');
  });

  it('styles the signature help tooltip', () => {
    const sigHelp = theme.spec['.cm-tooltip.cm-lsp-signature-tooltip'] as Record<string, unknown>;
    expect(sigHelp).toBeDefined();
    expect(sigHelp.background).toBe('var(--bg-secondary)');
    expect(sigHelp.border).toBe('1px solid var(--border-color)');
    expect(sigHelp.borderRadius).toBe('var(--radius-apple-md, 11px)');
  });

  it('styles the active parameter highlight', () => {
    const active = theme.spec['.cm-lsp-active-parameter'] as Record<string, unknown>;
    expect(active).toBeDefined();
    expect(active.fontWeight).toBe(700);
    expect(active.color).toBe('var(--accent-orange, #f97316)');
  });

  it('styles the hover tooltip consistently', () => {
    const hover = theme.spec['.cm-tooltip.cm-lsp-hover-tooltip'] as Record<string, unknown>;
    expect(hover).toBeDefined();
    expect(hover.background).toBe('var(--bg-secondary)');
    expect(hover.border).toBe('1px solid var(--border-color)');
    expect(hover.borderRadius).toBe('var(--radius-apple-md, 11px)');
  });

  it('styles matched text with accent color', () => {
    const matched = theme.spec['.cm-completionMatchedText'] as Record<string, unknown>;
    expect(matched).toBeDefined();
    expect(matched.color).toBe('var(--accent-blue)');
    expect(matched.fontWeight).toBe(600);
  });

  it('styles completion detail as muted secondary text', () => {
    const detail = theme.spec['.cm-completionDetail'] as Record<string, unknown>;
    expect(detail).toBeDefined();
    expect(detail.color).toBe('var(--text-muted)');
    expect(detail.fontSize).toBe('11px');
  });

  it('right-aligns detail via auto margin (flex-safe), not float', () => {
    const detail = theme.spec['.cm-completionDetail'] as Record<string, unknown>;
    // li is display:flex — float is a no-op on flex items; the prototype's
    // right-aligned detail must come from margin-left: auto.
    expect(detail.marginLeft).toBe('auto');
    expect(detail.float).toBeUndefined();
  });

  it('keeps the label on a single line (no flex-wrap ragged rows)', () => {
    const label = theme.spec['.cm-completionLabel'] as Record<string, unknown>;
    // Long `name(params) type` labels must NOT wrap under flex-wrap — the
    // reported `run.Testxxx(xxx, xxx) xxxx` → 3-line split bug.
    expect(label.whiteSpace).toBe('nowrap');
    // The row may outgrow the dropdown; the ul scrolls horizontally.
    expect(label.flexShrink).toBe(0);
    expect(label.overflow).toBeUndefined();
    expect(label.textOverflow).toBeUndefined();
  });

  it('keeps the detail on the label line, never wrapped', () => {
    const detail = theme.spec['.cm-completionDetail'] as Record<string, unknown>;
    expect(detail.whiteSpace).toBe('nowrap');
    expect(detail.overflow).toBeUndefined();
    expect(detail.textOverflow).toBeUndefined();
    expect(detail.maxWidth).toBeUndefined();
    // Detail is informational: it must not shrink below its content either.
    expect(detail.flexShrink).toBe(0);
  });

  it('lets long rows stretch for horizontal scrolling', () => {
    const li = theme.spec['.cm-tooltip.cm-tooltip-autocomplete > ul > li'] as Record<
      string,
      unknown
    >;
    // `min-width: max-content` widens the row beyond the dropdown so the ul's
    // horizontal scrollbar can reveal the full label instead of wrapping.
    expect(li.minWidth).toBe('max-content');
    expect(li.flexWrap).toBe('wrap'); // module path stays on its own line
  });

  it('styles the module path second line', () => {
    const module = theme.spec['.cm-lsp-completion-module'] as Record<string, unknown>;
    expect(module).toBeDefined();
    expect(module.fontSize).toBe('11px');
    expect(module.color).toBe('var(--text-muted)');
  });

  it('styles tooltip scrollbars to match app theme', () => {
    // 与 base.css 全局自动隐藏对齐：标准属性切换显隐（WebKit 伪元素不重绘）
    const scrollbar = theme.spec['.cm-tooltip, .cm-tooltip *'] as Record<string, unknown>;
    expect(scrollbar).toBeDefined();
    expect(scrollbar.scrollbarWidth).toBe('thin');
    expect(scrollbar.scrollbarColor).toBe('transparent transparent');
    const scrolling = theme.spec['.cm-tooltip.is-scrolling, .cm-tooltip .is-scrolling'] as Record<
      string,
      unknown
    >;
    expect(scrolling.scrollbarColor).toBe('var(--bg-hover) transparent');
  });

  it('aligns list items with flex-start for two-line icon alignment', () => {
    const items = theme.spec['.cm-tooltip.cm-tooltip-autocomplete > ul > li'] as Record<
      string,
      unknown
    >;
    expect(items.display).toBe('flex');
    expect(items.alignItems).toBe('flex-start');
  });

  it('adds staggered entrance animation to info panel', () => {
    const info = theme.spec['.cm-tooltip.cm-completionInfo'] as Record<string, unknown>;
    expect(info.animation).toBe('cm-autocomplete-in 200ms ease-out 40ms both');
  });

  it('styles returns section as flex layout', () => {
    const returns = theme.spec['.cm-lsp-info-returns'] as Record<string, unknown>;
    expect(returns).toBeDefined();
    expect(returns.display).toBe('flex');
    expect(returns.gap).toBe('8px');
    expect(returns.alignItems).toBe('center');
  });

  it('styles signature syntax highlighting spans', () => {
    const fnName = theme.spec['.cm-lsp-info-fn-name'] as Record<string, unknown>;
    expect(fnName).toBeDefined();
    // Prototype signature header: function name in purple (#d2a8ff).
    expect(fnName.color).toBe('#d2a8ff');

    const param = theme.spec['.cm-lsp-info-param'] as Record<string, unknown>;
    expect(param).toBeDefined();
    expect(param.color).toBe('var(--accent-orange, #f97316)');

    const paramType = theme.spec['.cm-lsp-info-param-type'] as Record<string, unknown>;
    expect(paramType).toBeDefined();
    // Prototype signature header: parameter type in blue (#79c0ff).
    expect(paramType.color).toBe('#79c0ff');

    const returnType = theme.spec['.cm-lsp-info-return-type'] as Record<string, unknown>;
    expect(returnType).toBeDefined();
    expect(returnType.color).toBe('var(--accent-green)');
  });

  it('styles completion icons with prototype letter glyphs', () => {
    const fn = theme.spec['.cm-completionIcon-function::before'] as Record<string, unknown>;
    expect(fn).toBeDefined();
    expect(fn.content).toBe('"ƒ"');
    expect(fn.background).toBe('var(--accent-blue)');

    const method = theme.spec['.cm-completionIcon-method::before'] as Record<string, unknown>;
    expect(method).toBeDefined();
    expect(method.content).toBe('"m"');
    expect(method.background).toBe('#79c0ff');

    const cls = theme.spec[
      '.cm-completionIcon-class::before, .cm-completionIcon-interface::before'
    ] as Record<string, unknown>;
    expect(cls).toBeDefined();
    expect(cls.content).toBe('"C"');
    expect(cls.background).toBe('var(--accent-purple, #a855f7)');

    const variable = theme.spec[
      '.cm-completionIcon-variable::before, .cm-completionIcon-property::before, .cm-completionIcon-field::before'
    ] as Record<string, unknown>;
    expect(variable).toBeDefined();
    expect(variable.content).toBe('"v"');
  });

  it('styles section title and returns label/type', () => {
    const title = theme.spec['.cm-lsp-info-section-title'] as Record<string, unknown>;
    expect(title).toBeDefined();
    expect(title.fontSize).toBe('10px');
    expect(title.textTransform).toBe('uppercase');

    const returnsLabel = theme.spec['.cm-lsp-info-returns-label'] as Record<string, unknown>;
    expect(returnsLabel).toBeDefined();
    expect(returnsLabel.color).toBe('var(--text-muted)');

    const returnsType = theme.spec['.cm-lsp-info-returns-type'] as Record<string, unknown>;
    expect(returnsType).toBeDefined();
    expect(returnsType.color).toBe('var(--accent-green)');
  });
});
