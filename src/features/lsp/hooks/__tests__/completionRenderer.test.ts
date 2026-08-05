// Pure-function tests for the completion renderer. No CM6 mocking needed —
// the renderer only touches the DOM and string parsing.

import { describe, expect, it } from 'vitest';

import {
  buildInfoPanel,
  buildListItem,
  buildModuleNodeFromCompletion,
  parseSignatureDetail,
} from '../completionRenderer';

describe('parseSignatureDetail', () => {
  it('parses Go-style func detail with named params and returns', () => {
    const result = parseSignatureDetail('func(name string, id int) error');
    expect(result.params).toEqual([
      { name: 'name', type: 'string', doc: '' },
      { name: 'id', type: 'int', doc: '' },
    ]);
    expect(result.returns).toBe('error');
  });

  it('parses Rust-style method detail with colon types', () => {
    const result = parseSignatureDetail('fn clone(&self, path: &str, depth: usize) -> Result<()>');
    expect(result.params).toEqual([
      { name: '&self', type: '', doc: '' },
      { name: 'path', type: '&str', doc: '' },
      { name: 'depth', type: 'usize', doc: '' },
    ]);
    expect(result.returns).toBe('Result<()>');
  });

  it('returns empty params for a no-arg function', () => {
    const result = parseSignatureDetail('func() error');
    expect(result.params).toEqual([]);
    expect(result.returns).toBe('error');
  });

  it('returns empty returns when none present', () => {
    const result = parseSignatureDetail('func(x int)');
    expect(result.returns).toBe('');
  });

  it('handles empty detail string', () => {
    const result = parseSignatureDetail('');
    expect(result.params).toEqual([]);
    expect(result.returns).toBe('');
  });
});

describe('buildListItem', () => {
  it('returns type/detail/moduleNode/optionClass for a function', () => {
    const item = {
      label: 'NewClient',
      kind: 3,
      detail: 'func(name string) (mypkg.Client, error)',
      insert_text: null,
    } as any;
    const completion = { label: 'NewClient' } as any;

    const result = buildListItem(completion, item);

    expect(result.type).toBe('function');
    expect(result.detail).toBe('(name string) (mypkg.Client, error)');
    expect(result.optionClass).toBe('cm-completion-item-enhanced');
    expect(result.moduleNode).toBeInstanceOf(HTMLElement);
    expect(result.moduleNode!.className).toBe('cm-lsp-completion-module');
    expect(result.moduleNode!.textContent).toBe('mypkg');
  });

  it('maps method kind to type "method"', () => {
    const item = { label: 'String', kind: 2, detail: '() string', insert_text: null } as any;
    const result = buildListItem({} as any, item);
    expect(result.type).toBe('method');
  });

  it('maps variable kind to type "variable"', () => {
    const item = { label: 'count', kind: 6, detail: 'int', insert_text: null } as any;
    const result = buildListItem({} as any, item);
    expect(result.type).toBe('variable');
  });

  it('uses lsp-client mapped type when raw kind is absent', () => {
    // @codemirror/lsp-client hands us options WITHOUT the raw `kind` —
    // it only carries the already-mapped `type` (kindToType). The icon must
    // come from that, otherwise every entry degrades to "property" (the "v"
    // icon) — the reported bug.
    const funcOption = { label: 'dispatch', type: 'function', detail: 'func(ctx) error' } as any;
    expect(buildListItem({} as any, funcOption).type).toBe('function');

    const varOption = { label: 'count', type: 'variable', detail: 'int' } as any;
    expect(buildListItem({} as any, varOption).type).toBe('variable');

    const methodOption = { label: 'String', type: 'method', detail: '() string' } as any;
    expect(buildListItem({} as any, methodOption).type).toBe('method');

    const classOption = { label: 'Client', type: 'class', detail: 'struct' } as any;
    expect(buildListItem({} as any, classOption).type).toBe('class');
  });

  it('falls back to property when neither kind nor type is present', () => {
    const item = { label: 'unknown' } as any;
    const result = buildListItem({} as any, item);
    expect(result.type).toBe('property');
  });

  it('strips leading "func(" prefix from Go detail', () => {
    const item = {
      label: 'New',
      kind: 3,
      detail: 'func(name string) error',
      insert_text: null,
    } as any;
    const result = buildListItem({} as any, item);
    // detail should NOT start with "func("
    expect(result.detail).not.toMatch(/^func\(/);
    expect(result.detail).toBe('(name string) error');
  });

  it('returns null moduleNode when no module info available', () => {
    const item = { label: 'foo', kind: 3, detail: '', insert_text: null } as any;
    const result = buildListItem({} as any, item);
    expect(result.moduleNode).toBeNull();
  });
});

describe('buildModuleNodeFromCompletion (module path second line)', () => {
  it('extracts a full Go package path from detail', () => {
    const completion = {
      label: 'dispatch',
      detail: 'func(ctx, opts) (github.com/larksuite/oapi-sdk-go/v3/event/dispatch.Type, error)',
    } as any;
    const node = buildModuleNodeFromCompletion(completion);
    expect(node).toBeInstanceOf(HTMLElement);
    expect(node!.className).toBe('cm-lsp-completion-module');
    expect(node!.textContent).toBe('github.com/larksuite/oapi-sdk-go/v3/event/dispatch');
  });

  it('extracts a Rust crate::module path from detail', () => {
    const completion = {
      label: 'read',
      detail: 'fn read(path: &str) -> std::fs::Result<Vec<u8>>',
    } as any;
    const node = buildModuleNodeFromCompletion(completion);
    expect(node).not.toBeNull();
    expect(node!.textContent).toBe('std::fs');
  });

  it('does NOT render a module row for a dot-qualified label (package shorthand)', () => {
    // `run.Testxxx` → `run` is just a package shorthand, not a module path.
    // Rendering it produced a confusing extra "run" line above the symbol.
    const completion = { label: 'run.BuildDispatcher', detail: '' } as any;
    const node = buildModuleNodeFromCompletion(completion);
    expect(node).toBeNull();
  });

  it('extracts module from a ::-qualified label (Rust path)', () => {
    const completion = { label: 'std::fs::read', detail: '' } as any;
    const node = buildModuleNodeFromCompletion(completion);
    expect(node).not.toBeNull();
    expect(node!.textContent).toBe('std::fs');
  });

  it('prefers a file URI from completion.data when present', () => {
    const completion = {
      label: 'TestDispatchBadOutputFormat',
      detail: 'func(t *testing.T)',
      data: { URI: 'file:///home/dev/proj/event/dispatcher/dispatch_test.go' },
    } as any;
    const node = buildModuleNodeFromCompletion(completion);
    expect(node).not.toBeNull();
    // Prototype shows the source file path on the second line.
    expect(node!.textContent).toBe('event/dispatcher/dispatch_test.go');
  });

  it('returns null when no module info and no data URI', () => {
    const completion = { label: 'count', detail: 'int' } as any;
    const node = buildModuleNodeFromCompletion(completion);
    expect(node).toBeNull();
  });
});

describe('buildInfoPanel', () => {
  it('builds a full panel with signature + docs + params + returns', () => {
    const item = {
      label: 'NewClient',
      kind: 3,
      detail: 'func(name string, id int) error',
      insert_text: null,
    } as any;
    const completion = { label: 'NewClient' } as any;
    const docHtml = '<p>Creates a new client.</p>';

    const panel = buildInfoPanel(completion, item, docHtml);

    expect(panel.className).toBe('cm-lsp-completion-info');
    expect(panel.querySelector('.cm-lsp-info-signature')?.textContent).toBe(
      'NewClient(name string, id int) error',
    );
    expect(panel.querySelector('.cm-lsp-info-docs')?.innerHTML).toBe(docHtml);
    expect(panel.querySelectorAll('.cm-lsp-info-params tbody tr')).toHaveLength(2);
    expect(panel.querySelector('.cm-lsp-info-returns')?.textContent).toContain('error');
    // The panel ends at Returns — no auto-generated `fn(param, ...)` call line.
    expect(panel.querySelector('.cm-lsp-info-example')).toBeNull();
  });

  it('omits params table when no params', () => {
    const item = { label: 'Run', kind: 3, detail: 'func()', insert_text: null } as any;
    const completion = { label: 'Run' } as any;

    const panel = buildInfoPanel(completion, item, '<p>Runs.</p>');

    expect(panel.querySelector('.cm-lsp-info-params')).toBeNull();
  });

  it('omits returns block when no returns', () => {
    const item = { label: 'Print', kind: 3, detail: 'func(msg string)', insert_text: null } as any;
    const completion = { label: 'Print' } as any;

    const panel = buildInfoPanel(completion, item, '<p>Prints.</p>');

    expect(panel.querySelector('.cm-lsp-info-returns')).toBeNull();
  });

  it('never renders an auto-generated call example', () => {
    const item = { label: 'foo', kind: 6, detail: '', insert_text: null } as any;
    const completion = { label: 'foo' } as any;

    const panel = buildInfoPanel(completion, item, '');

    // The `fn(param, ...)` line under Returns was reported as an extra row —
    // the panel must never render it.
    expect(panel.querySelector('.cm-lsp-info-example')).toBeNull();
    expect(panel.querySelector('.cm-lsp-info-params')).toBeNull();
    expect(panel.querySelector('.cm-lsp-info-returns')).toBeNull();
  });

  it('omits docs block when documentation is empty', () => {
    const item = { label: 'foo', kind: 3, detail: 'func()', insert_text: null } as any;
    const completion = { label: 'foo' } as any;

    const panel = buildInfoPanel(completion, item, '');

    // No blank block with stray margins — the panel just skips the section.
    expect(panel.querySelector('.cm-lsp-info-docs')).toBeNull();
  });

  it('renders signature with syntax highlighting spans', () => {
    const item = {
      label: 'NewClient',
      kind: 3,
      detail: 'func(name string, id int) error',
      insert_text: null,
    } as any;
    const completion = { label: 'NewClient' } as any;

    const panel = buildInfoPanel(completion, item, '<p>docs</p>');
    const sig = panel.querySelector('.cm-lsp-info-signature');

    expect(sig?.querySelector('.cm-lsp-info-fn-name')?.textContent).toBe('NewClient');
    expect(sig?.querySelectorAll('.cm-lsp-info-param')).toHaveLength(2);
    expect(sig?.querySelectorAll('.cm-lsp-info-param-type')).toHaveLength(2);
    expect(sig?.querySelector('.cm-lsp-info-return-type')?.textContent).toBe('error');
  });

  it('renders Parameters section title before params table', () => {
    const item = {
      label: 'Fn',
      kind: 3,
      detail: 'func(a int, b string)',
      insert_text: null,
    } as any;
    const completion = { label: 'Fn' } as any;

    const panel = buildInfoPanel(completion, item, '<p>docs</p>');
    const title = panel.querySelector('.cm-lsp-info-section-title');

    expect(title).toBeTruthy();
    expect(title?.textContent).toBe('Parameters');
  });

  it('renders returns as structured label + type', () => {
    const item = {
      label: 'Get',
      kind: 3,
      detail: 'func() error',
      insert_text: null,
    } as any;
    const completion = { label: 'Get' } as any;

    const panel = buildInfoPanel(completion, item, '<p>docs</p>');
    const returns = panel.querySelector('.cm-lsp-info-returns');

    expect(returns?.querySelector('.cm-lsp-info-returns-label')?.textContent).toBe('Returns');
    expect(returns?.querySelector('.cm-lsp-info-returns-type')?.textContent).toBe('error');
  });

  it('falls back to plain text signature when detail has no parseable params', () => {
    const item = { label: 'foo', kind: 6, detail: 'func()', insert_text: null } as any;
    const completion = { label: 'foo' } as any;

    const panel = buildInfoPanel(completion, item, '<p>docs</p>');
    const sig = panel.querySelector('.cm-lsp-info-signature');

    // No syntax highlighting spans when there are no params/returns
    expect(sig?.querySelector('.cm-lsp-info-fn-name')).toBeNull();
    expect(sig?.textContent).toBe('foo()');
  });
});
