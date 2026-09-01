import { EditorView } from '@codemirror/view';

/**
 * App-themed CodeMirror autocomplete + completion-info styles.
 *
 * Why an `EditorView.theme` extension instead of plain global CSS?
 *
 * CodeMirror ships a `baseTheme` for its autocomplete widget that uses
 * double-class selectors like `.cm-tooltip.cm-tooltip-autocomplete`
 * (specificity 0,2,0). A single-class rule in our stylesheet (0,1,0)
 * loses the cascade, which is why the dropdown kept showing CodeMirror's
 * default look even though we had CSS for it.
 *
 * `EditorView.theme()` injects rules with a higher specificity than
 * `baseTheme`, so our colors and spacing win. The tooltip DOM inherits
 * the editor's theme classes (`.cm-editor.cm-s-...`), which is how these
 * rules reach the tooltip even though it's rendered in a separate layer.
 *
 * Visual design goals:
 *   - Match the app's elevated-surface language (bg-secondary + border + shadow)
 *   - Apple-style rounded corners (radius-apple-md ≈ 11px)
 *   - Two-line list items (label + muted module path)
 *   - IDEA-style info panel that follows the selected option
 *   - CSS-drawn completion icons (no codicon font dependency)
 */
export function completionTheme() {
  return EditorView.theme({
    /* ── Dropdown container ─────────────────────────────────────── */
    // NOTE: no `overflow: hidden` here. The completion-info panel is mounted
    // as a CHILD of this container (CM6 `addInfoPane` appends it to the list
    // tooltip DOM) and positioned just outside it — clipping the container
    // would crop the panel and hide the function documentation.
    '.cm-tooltip.cm-tooltip-autocomplete': {
      zIndex: 5000,
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius-apple-md, 11px)',
      border: '1px solid var(--border-color)',
      boxShadow: '0 0 0 1px oklch(1 0 0 / 4%), 0 8px 32px oklch(0 0 0 / 45%)',
      color: 'var(--text-primary)',
      fontFamily: 'inherit',
      animation: 'cm-autocomplete-in 150ms ease-out',
    },

    /* List container — horizontal scroll so long labels don't get clipped.
       Carries the container's radius (overflow: auto clips li hover bgs),
       but stays on the `ul` so the sibling info panel is never cropped. */
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'inherit',
      whiteSpace: 'nowrap',
      overflow: 'auto',
      borderRadius: 'inherit',
      maxWidth: 'min(700px, 95vw)',
      minWidth: '280px',
      maxHeight: '320px',
      height: '100%',
      listStyle: 'none',
      margin: 0,
      padding: '4px 0',
    },

    /* Individual list items — two-line enhanced layout.
       `min-width: max-content` lets a long label+detail row stretch beyond
       the dropdown width, so the `ul`'s horizontal scrollbar (overflow:auto)
       can reveal the full text instead of wrapping or ellipsizing it. */
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      padding: '8px 12px',
      lineHeight: 1.4,
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      gap: '4px',
      overflow: 'hidden',
      minWidth: 'max-content',
      cursor: 'pointer',
      borderLeft: '2px solid transparent',
      transition: 'background-color 120ms ease-out, border-color 120ms ease-out',
    },

    /* Selected item — accent left-border + hover bg.
       We use CSS variables so the same rule works for both light and dark
       themes — no need for separate &light / &dark variants. */
    '.cm-tooltip-autocomplete ul li[aria-selected="true"]': {
      background: 'var(--bg-hover)',
      color: 'var(--text-primary)',
      borderLeftColor: 'var(--accent-blue)',
    },

    /* Disabled selected item */
    '.cm-tooltip-autocomplete-disabled ul li[aria-selected="true"]': {
      background: 'var(--bg-tertiary)',
      color: 'var(--text-muted)',
    },

    /* Completion icon — CSS-drawn shapes replacing codicon font */
    '.cm-completionIcon': {
      width: '16px',
      height: '16px',
      fontSize: '0', // hide the codicon character
      position: 'relative',
      flexShrink: 0,
      marginRight: '8px',
      marginTop: '1px',
      verticalAlign: 'middle',
    },
    '.cm-completionIcon::before': {
      content: '""',
      position: 'absolute',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '3px',
      fontSize: '10px',
      fontWeight: 700,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      lineHeight: 1,
    },
    /* Function — blue ƒ (prototype icon-function) */
    '.cm-completionIcon-function::before': {
      background: 'var(--accent-blue)',
      color: '#fff',
      content: '"ƒ"',
      fontStyle: 'italic',
    },
    /* Method — light-blue m (prototype icon-method) */
    '.cm-completionIcon-method::before': {
      background: '#79c0ff',
      color: '#1a1a1a',
      content: '"m"',
    },
    '.cm-completionIcon-constructor::before': {
      background: 'var(--accent-purple, #a855f7)',
      color: '#fff',
      content: '"C"',
    },
    /* Class / Interface — purple C (prototype icon-class) */
    '.cm-completionIcon-class::before, .cm-completionIcon-interface::before': {
      background: 'var(--accent-purple, #a855f7)',
      color: '#fff',
      content: '"C"',
    },
    /* Variable / Property — green v (prototype icon-variable) */
    '.cm-completionIcon-variable::before, .cm-completionIcon-property::before, .cm-completionIcon-field::before':
      {
        background: 'var(--accent-green)',
        color: '#fff',
        content: '"v"',
      },
    '.cm-completionIcon-constant::before': {
      background: 'var(--accent-yellow)',
      color: '#fff',
      content: '"◆"',
      fontSize: '9px',
    },
    '.cm-completionIcon-keyword::before': {
      background: 'var(--accent-purple, #a855f7)',
      color: '#fff',
      content: '"K"',
      fontSize: '9px',
    },
    '.cm-completionIcon-namespace::before, .cm-completionIcon-module::before': {
      background: 'var(--bg-tertiary)',
      color: 'var(--text-secondary)',
      content: '"{}"',
      fontSize: '8px',
      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
    },
    '.cm-completionIcon-type::before': {
      background: 'var(--accent-cyan, #06b6d4)',
      color: '#fff',
      content: '"T"',
      fontSize: '9px',
    },
    '.cm-completionIcon-text::before': {
      background: 'var(--bg-tertiary)',
      color: 'var(--text-muted)',
      content: '"≡"',
      fontSize: '9px',
    },

    /* Completion label — primary text. `nowrap` + `flex-shrink: 0` keep the
       label on ONE line (flex-wrap is only used for the module-path second
       line); a long label + detail pair must never wrap into ragged rows
       (`run.Testxxx(xxx, xxx) xxxx` splitting across three lines). The row
       itself may grow past the dropdown — the ul scrolls horizontally. */
    '.cm-completionLabel': {
      color: 'var(--text-primary)',
      fontSize: '13px',
      fontWeight: 500,
      whiteSpace: 'nowrap',
      flexShrink: 0,
    },

    /* Matched text highlight */
    '.cm-completionMatchedText': {
      color: 'var(--accent-blue)',
      fontWeight: 600,
      textDecoration: 'none',
    },

    /* Detail (right side of label) — muted secondary text.
       The list item is display:flex, where `float` is a no-op — right-align
       with an auto left margin (prototype's space-between layout).
       `nowrap` + `flex-shrink: 0` mirror the prototype's
       `white-space: nowrap; flex-shrink: 0`: the detail stays on the label's
       line and, like the label, can push the row wide for horizontal
       scrolling (never wrapped, never ellipsized). */
    '.cm-completionDetail': {
      color: 'var(--text-muted)',
      fontSize: '11px',
      fontStyle: 'normal',
      marginLeft: 'auto',
      paddingLeft: '12px',
      flexShrink: 0,
      whiteSpace: 'nowrap',
    },

    /* Module path (second line) — injected via addToOptions */
    '.cm-lsp-completion-module': {
      fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
      fontSize: '11px',
      color: 'var(--text-muted)',
      flexBasis: '100%',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      marginTop: '2px',
      paddingLeft: '24px',
    },

    /* ── Completion info panel (right column) ──────────────────── */
    /* The themed info tooltip arrives with one of two classes: the default
       `.cm-completionInfo` (lsp-client) or our `.cm-lsp-completion-info-wrapper`
       (from `flipPositionInfo`). Both get the identical glass treatment. */
    '.cm-tooltip.cm-completionInfo': {
      zIndex: 5001,
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius-apple-md, 11px)',
      border: '1px solid var(--border-color)',
      boxShadow: '0 0 0 1px oklch(1 0 0 / 4%), 0 8px 32px oklch(0 0 0 / 45%)',
      color: 'var(--text-primary)',
      padding: '10px 14px',
      width: '440px',
      maxWidth: 'min(440px, 42vw)',
      maxHeight: '340px',
      overflowY: 'auto',
      overflowX: 'hidden',
      overflowWrap: 'break-word',
      fontSize: '12px',
      lineHeight: 1.6,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      boxSizing: 'border-box',
      whiteSpace: 'normal',
      animation: 'cm-autocomplete-in 200ms ease-out 40ms both',
    },
    '.cm-tooltip.cm-lsp-completion-info-wrapper': {
      zIndex: 6000,
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius-apple-md, 11px)',
      border: '1px solid var(--border-color)',
      boxShadow: '0 0 0 1px oklch(1 0 0 / 4%), 0 8px 32px oklch(0 0 0 / 45%)',
      color: 'var(--text-primary)',
      padding: '10px 14px',
      width: '440px',
      maxWidth: 'min(440px, 42vw)',
      maxHeight: '340px',
      overflowY: 'auto',
      overflowX: 'hidden',
      overflowWrap: 'break-word',
      fontSize: '12px',
      lineHeight: 1.6,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      boxSizing: 'border-box',
      whiteSpace: 'normal',
      animation: 'cm-autocomplete-in 200ms ease-out 40ms both',
    },

    /* Nested markdown typography inside the info panel (docs body). */
    '.cm-tooltip.cm-completionInfo p, .cm-tooltip.cm-lsp-completion-info-wrapper p': {
      margin: '0 0 0.5em 0',
      color: 'var(--text-primary)',
      '&:last-child': { marginBottom: '0' },
    },
    '.cm-tooltip.cm-completionInfo a, .cm-tooltip.cm-lsp-completion-info-wrapper a': {
      color: 'var(--accent-blue)',
      textDecoration: 'none',
      '&:hover': { textDecoration: 'underline' },
    },
    '.cm-tooltip.cm-completionInfo code:not(pre code), .cm-tooltip.cm-lsp-completion-info-wrapper code:not(pre code)':
      {
        background: 'var(--bg-tertiary)',
        color: 'var(--accent-orange)',
        padding: '1px 5px',
        borderRadius: '3px',
        fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
        fontSize: '11px',
      },
    '.cm-tooltip.cm-completionInfo pre, .cm-tooltip.cm-lsp-completion-info-wrapper pre': {
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '5px',
      padding: '8px 10px',
      margin: '0.5em 0',
      maxWidth: '100%',
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    },
    '.cm-tooltip.cm-completionInfo pre code, .cm-tooltip.cm-lsp-completion-info-wrapper pre code': {
      background: 'transparent',
      color: 'var(--text-primary)',
      padding: '0',
      borderRadius: '0',
      fontSize: '11px',
      lineHeight: 1.5,
      fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
    },
    '.cm-tooltip.cm-completionInfo ul, .cm-tooltip.cm-completionInfo ol, .cm-tooltip.cm-lsp-completion-info-wrapper ul, .cm-tooltip.cm-lsp-completion-info-wrapper ol':
      {
        paddingLeft: '1.5em',
        margin: '0.4em 0',
      },
    '.cm-tooltip.cm-completionInfo ul, .cm-tooltip.cm-lsp-completion-info-wrapper ul': {
      listStyleType: 'disc',
    },
    '.cm-tooltip.cm-completionInfo ol, .cm-tooltip.cm-lsp-completion-info-wrapper ol': {
      listStyleType: 'decimal',
    },
    '.cm-tooltip.cm-completionInfo li, .cm-tooltip.cm-lsp-completion-info-wrapper li': {
      marginBottom: '0.15em',
    },

    /* Info panel inner container (built by buildInfoPanel). */
    '.cm-lsp-completion-info': {
      fontSize: 'var(--font-size, 12px)',
      lineHeight: 1.6,
      color: 'var(--text-primary)',
    },

    /* Position: offset from the list by 4px gap */
    '.cm-completionInfo.cm-completionInfo-right': {
      left: '100%',
      marginLeft: '4px',
    },
    '.cm-completionInfo.cm-completionInfo-left': {
      right: '100%',
      marginRight: '4px',
    },

    /* Signature header inside info panel */
    '.cm-lsp-info-signature': {
      fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
      fontSize: '12px',
      color: 'var(--text-secondary)',
      marginBottom: '8px',
      paddingBottom: '8px',
      borderBottom: '1px solid var(--border-color)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    },

    /* Docs body */
    '.cm-lsp-info-docs': {
      marginBottom: '8px',
      color: 'var(--text-primary)',
    },

    /* Parameter table */
    '.cm-lsp-info-params': {
      width: '100%',
      borderCollapse: 'collapse',
      margin: '8px 0',
      fontSize: '11px',
    },
    '.cm-lsp-info-params th': {
      textAlign: 'left',
      padding: '3px 8px',
      borderBottom: '1px solid var(--border-color)',
      color: 'var(--text-muted)',
      fontWeight: 600,
      fontSize: '10px',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    },
    '.cm-lsp-info-params td': {
      textAlign: 'left',
      padding: '3px 8px',
      borderBottom: '1px solid var(--border-color)',
    },
    '.cm-lsp-param-name': {
      fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
      color: 'var(--cm-function, var(--accent-blue))',
    },
    '.cm-lsp-param-type': {
      fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
      color: 'var(--cm-typeName, var(--accent-yellow, #eab308))',
    },

    /* Returns line */
    '.cm-lsp-info-returns': {
      display: 'flex',
      gap: '8px',
      alignItems: 'center',
      fontSize: '11px',
      color: 'var(--text-secondary)',
      margin: '4px 0',
    },

    /* ── Signature syntax highlighting spans ───────────────────── */
    /* Colors mirror the prototype info panel: fn-name purple, param orange,
       param type blue (#79c0ff), return green. */
    '.cm-lsp-info-fn-name': {
      color: '#d2a8ff',
      fontWeight: 600,
    },
    '.cm-lsp-info-param': {
      color: 'var(--accent-orange, #f97316)',
      fontWeight: 600,
    },
    '.cm-lsp-info-param-type': {
      color: '#79c0ff',
    },
    '.cm-lsp-info-return-type': {
      color: 'var(--accent-green)',
    },
    '.cm-lsp-info-section-title': {
      fontSize: '10px',
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--text-muted)',
      fontWeight: 600,
      margin: '8px 0 4px',
    },
    '.cm-lsp-info-returns-label': {
      color: 'var(--text-muted)',
      fontSize: '10px',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      fontWeight: 600,
    },
    '.cm-lsp-info-returns-type': {
      fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
      color: 'var(--accent-green)',
    },

    /* ── Signature help tooltip ─────────────────────────────────── */
    '.cm-tooltip.cm-lsp-signature-tooltip': {
      zIndex: 5000,
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius-apple-md, 11px)',
      border: '1px solid var(--border-color)',
      boxShadow: '0 0 0 1px oklch(1 0 0 / 4%), 0 8px 32px oklch(0 0 0 / 45%)',
      color: 'var(--text-primary)',
      maxWidth: '480px',
      maxHeight: '280px',
      overflowY: 'auto',
      overflowX: 'hidden',
      overflowWrap: 'break-word',
      padding: '10px 14px',
      fontSize: '13px',
      lineHeight: 1.5,
      fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
    },
    '.cm-lsp-signature-num': {
      position: 'absolute',
      top: '6px',
      right: '10px',
      fontSize: '11px',
      color: 'var(--text-muted)',
      fontVariantNumeric: 'tabular-nums',
      background: 'var(--bg-tertiary)',
      padding: '1px 6px',
      borderRadius: '3px',
    },
    '.cm-lsp-signature': {
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      color: 'var(--text-primary)',
    },
    '.cm-lsp-active-parameter': {
      color: 'var(--accent-orange, #f97316)',
      fontWeight: 700,
      textDecoration: 'underline',
      textUnderlineOffset: '2px',
      background: 'color-mix(in srgb, var(--accent-orange, #f97316) 12%, transparent)',
      padding: '0 2px',
      borderRadius: '2px',
    },
    '.cm-lsp-signature-documentation': {
      marginTop: '8px',
      paddingTop: '8px',
      borderTop: '1px solid var(--border-color)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      fontSize: '12px',
      lineHeight: 1.6,
      color: 'var(--text-secondary)',
    },

    /* ── Hover tooltip ─────────────────────────────────────────── */
    '.cm-tooltip.cm-lsp-hover-tooltip': {
      zIndex: 5000,
      background: 'var(--bg-secondary)',
      borderRadius: 'var(--radius-apple-md, 11px)',
      border: '1px solid var(--border-color)',
      boxShadow: '0 0 0 1px oklch(1 0 0 / 4%), 0 8px 32px oklch(0 0 0 / 45%)',
      color: 'var(--text-primary)',
      padding: '10px 14px',
      maxWidth: '480px',
      maxHeight: '340px',
      overflowY: 'auto',
      overflowX: 'hidden',
      overflowWrap: 'break-word',
      fontSize: '12px',
      lineHeight: 1.6,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },

    /* ── Scrollbars inside tooltips ────────────────────────────── */
    /* 与 base.css 全局自动隐藏滚动条对齐：标准属性切换显隐
       （WebKit 对 ::-webkit-scrollbar 伪元素的动态 class 切换不重绘） */
    '.cm-tooltip, .cm-tooltip *': {
      scrollbarWidth: 'thin',
      scrollbarColor: 'transparent transparent',
    },
    '.cm-tooltip.is-scrolling, .cm-tooltip .is-scrolling': {
      scrollbarColor: 'var(--bg-hover) transparent',
    },

    /* Entrance animation shared by dropdown + info panel */
    '@keyframes cm-autocomplete-in': {
      from: { opacity: 0, transform: 'translateY(-4px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
  });
}
