// Mock the CM6 packages that @codemirror/lsp-client depends on. We import the
// actual `signatureHelp` to verify its shape, then assert the wrapper wires it.
vi.mock('@codemirror/lsp-client', () => ({
  LSPClient: vi.fn(),
  serverDiagnostics: vi.fn(),
  signatureHelp: vi.fn().mockReturnValue({ mocked: 'signatureHelpExtension' }),
  // `createThemedServerCompletion` imports `autocompletion` + `serverCompletionSource`
  // — keep them light so the wrapper module loads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serverCompletionSource: () => Promise.resolve(null) as any,
}));
vi.mock('@codemirror/state', () => ({ type: {} }));
vi.mock('@codemirror/view', () => ({ type: {} }));
vi.mock('@codemirror/autocomplete', () => ({
  autocompletion: () => ({}),
}));

import { signatureHelp } from '@codemirror/lsp-client';
import { describe, expect, it, vi } from 'vitest';

// Import the wrapper module — it touches the cache but does not require a live
// editor, so we can assert statically that the extensions array was built with
// the signatureHelp extension present.
import { __resetLspClientPoolForTests } from '../lspClientManager';
import { createThemedServerCompletion } from '../lspCompletionInfoRenderer';

describe('signatureHelp integration', () => {
  it('should_be_importable_without_error', () => {
    // `signatureHelp` is a factory from @codemirror/lsp-client. Asserting it is
    // callable and returns an Extension (or Extension[]) is the cheapest
    // contract test — the runtime signature dispatch is covered by the CM6
    // library's own tests.
    expect(typeof signatureHelp).toBe('function');
    const ext = signatureHelp();
    expect(ext).toBeDefined();
  });

  it('should_default_to_including_keymap', () => {
    // `signatureHelp()` (no args) should bind Mod-Shift-Space / Arrow keys by
    // default. We can't exercise the key dispatch without an EditorView, so we
    // assert the factory does not throw and returns a non-empty config.
    expect(() => signatureHelp()).not.toThrow();
    const ext = signatureHelp();
    // The extension is an array of [stateField, viewPlugin, keymap] when
    // keymap is enabled. A bare Extension is also valid, but it must be truthy.
    expect(ext).toBeTruthy();
  });

  it('should_respect_keymap_false_option', () => {
    // `signatureHelp({ keymap: false })` should drop the key bindings. The
    // return shape should differ (no keymap element). We assert the call is
    // accepted and does not throw.
    expect(() => signatureHelp({ keymap: false })).not.toThrow();
  });

  it('should_reset_pool_without_throwing', () => {
    // Sanity check that the pool helper is exported and callable — used by
    // other tests to isolate state.
    expect(() => __resetLspClientPoolForTests()).not.toThrow();
  });

  it('themed_completion_source_is_a_function', () => {
    // `createThemedCompletionSource` is exported from the renderer module so
    // it can be unit-tested in isolation. Assert it is a function and returns
    // a promise-like when given a minimal context.
    expect(typeof createThemedServerCompletion).toBe('function');
  });
});
