# Tailwind CSS Migration

## Goal

Replace the monolithic `src/styles.css` (3,364 lines, ~520 class selectors) with Tailwind CSS v4 utility classes, improving maintainability and consistency. CSS custom properties (One Dark Pro theme) are preserved and mapped to Tailwind theme config.

## Requirements

- Install Tailwind CSS v4 with `@tailwindcss/vite` plugin
- Install `clsx` + `tailwind-merge` for dynamic class merging
- Map 22 CSS variables to Tailwind theme colors via `@theme` block
- Create `cn()` utility function in `src/utils/cn.ts`
- Migrate all 28 component files from BEM-like CSS classes to Tailwind utility classes
- Keep ~260 lines of un-migratable complex CSS as `@layer base` / `@layer components`
- Remove `src/styles.css` entirely
- Inline `style={{}}` values: convert one-offs to Tailwind, keep dynamic computed values as inline style

## Acceptance Criteria

- [ ] `pnpm install` succeeds with new dependencies (tailwindcss, @tailwindcss/vite, clsx, tailwind-merge)
- [ ] `pnpm build` succeeds (tsc + vite build)
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `pnpm test` passes (no test breakage from class name changes)
- [ ] All visual rendering matches pre-migration behavior
- [ ] CSS variable dynamic updates still work (sidebar drag resize, font size settings, theme colors)
- [ ] xterm terminal rendering is unaffected (background colors, viewport)
- [ ] Custom radio/checkbox components render correctly
- [ ] Side terminal grid layout (`:has()` selector) works for 1/2/3/4 terminals
- [ ] Scrollbar styling is preserved
- [ ] Diff view syntax highlighting works
- [ ] No remaining references to deleted CSS class names in components
- [ ] Custom CSS in tailwind.css is under 400 lines

## Phase 1: Infrastructure

1. `pnpm add -D tailwindcss @tailwindcss/vite && pnpm add clsx tailwind-merge`
2. Update `vite.config.ts` — add `tailwindcss()` plugin
3. Create `src/tailwind.css`:
   - `@import "tailwindcss"`
   - `@theme` block mapping CSS vars to Tailwind theme
   - `@layer base` with `:root` variable definitions
   - `@layer components` with un-migratable CSS (see below)
4. Create `src/utils/cn.ts` — `twMerge(clsx(...))` wrapper
5. Update `src/main.tsx` — import `./tailwind.css` instead of `./styles.css`
6. Delete `src/styles.css`

## Phase 2: Un-migratable CSS (keep in @layer, ~260 lines)

| Block | Reason |
|-------|--------|
| `:root` CSS variable definitions (22 vars) | Theme system, values defined once |
| `.terminal-wrapper .xterm*` overrides (4 rules, `!important`) | xterm.js external lib |
| `.side-terminal-grid-container:has(> :nth-child(...))` (~30 lines) | `:has()` + `:nth-child()` grid logic |
| `.custom-radio` / `.custom-checkbox` (~60 lines) | `::after` pseudo-elements + sibling selectors |
| `::-webkit-scrollbar` (~15 lines) | Pseudo-element scrollbar styling |
| `.hljs*` syntax highlighting (~85 lines) | highlight.js external styles |
| `@keyframes` animations (3, ~20 lines) | Keyframe definitions |
| `-webkit-app-region` (3 lines) | Tauri window drag |

## Phase 3: Component Migration

### Migration Pattern

**Static classes** → direct Tailwind:
```tsx
// Before: <div className="modal-overlay">
// After:  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
```

**Dynamic classes** → `cn()`:
```tsx
// Before: className={`agent-option ${selected ? "selected" : ""}`}
// After:  className(cn("px-3 py-2 cursor-pointer", selected && "bg-accent-blue/20"))
```

**Inline styles** → Tailwind where possible:
```tsx
// Before: style={{ opacity: 0.5 }}
// After:  className="opacity-50"
```

**Keep inline style**: dynamic computed values (`paddingLeft: indent`), JS-driven sizes (`width: sideTerminalWidth`), dynamic positioning (`left: pos.left`)

### Migration Order (bottom-up by dependency)

**Tier 1 — Leaf components (simple):**
- `WindowControls.tsx` — 5 classes
- `AgentIcon.tsx` — 1 class + inline style
- `AppToast.tsx` — 1 dynamic class
- `FileTree.tsx` — 7 classes + dynamic badge

**Tier 2 — Terminal components:**
- `TerminalView.tsx`, `WorktreeTerminalView.tsx` — 2 classes each
- `SideTerminalView.tsx` — 6 classes
- `WSLTerminalView.tsx`, `RemoteTerminalView.tsx` — 7 classes + conditional style

**Tier 3 — Dialog components:**
- `GitDialog.tsx`, `AddProjectModal.tsx`, `ProjectSettingsDialog.tsx`
- `ContextMenu.tsx`, `RemoteAuthDialog.tsx`
- `WSLDialog.tsx`, `RemoteDialog.tsx`

**Tier 4 — Layout components:**
- `TitleBar.tsx` — 13 classes
- `AgentSelector.tsx` — 8 dynamic classes
- `ProjectSidebar.tsx` — 4 classes
- `MainContent.tsx`, `RemoteProjectView.tsx`

**Tier 5 — Complex business components:**
- `ProjectItem.tsx` — ~35 classes (classList manipulation needs refactoring to state-based)
- `WorktreeList.tsx` — ~20 classes + animations
- `RemoteItems.tsx` — ~30 classes
- `SettingsPanel.tsx` — ~50 classes (most complex)
- `DiffView.tsx` — ~30 classes + dangerouslySetInnerHTML

**Tier 6 — Entry:**
- `App.tsx` — 3 classes

### Special Cases

**ProjectItem.tsx `classList` manipulation**: `classList.add("dragging")` / `classList.remove("drag-over")` must be refactored to state variables (`isDragging`, `dragOverTarget`) so Tailwind conditional classes work. Current pointer-events drag system tracks targets via `dragRef`.

**DiffView.tsx `dangerouslySetInnerHTML`**: `word-diff-removed` / `word-diff-added` classes are embedded in generated HTML strings. These must remain as class names defined in `@layer components`.

**SettingsPanel.tsx font dropdown**: Complex nested component with `::after` pseudo-element for built-in font indicator. Keep the `::after` rule in `@layer components`.

## Technical Notes

- Tailwind v4 uses `@import "tailwindcss"` (not `@tailwind` directives)
- `@theme` block maps CSS vars to Tailwind theme: `--color-bg-primary: var(--bg-primary)`
- `twMerge` resolves conflicting utilities (e.g., `p-2 p-4` → `p-4`)
- Existing ~40 hand-written utility classes (`.mt-2`, `.flex`, `.gap-8`) are deleted — Tailwind provides these natively
- CSS variables remain runtime-switchable (sidebar drag, font size, theme)
- No media queries needed (fixed-size desktop app)
- `!important` overrides for xterm.js remain in `@layer` (higher specificity than Tailwind)
