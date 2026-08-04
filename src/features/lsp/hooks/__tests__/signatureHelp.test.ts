// Mock the CM6 packages before importing the unit under test.
vi.mock('@codemirror/lsp-client', () => {
  // A mock LSPClient that records the extensions it was constructed with and
  // returns a predictable plugin extension. This lets us assert that the
  // signatureHelp extension is actually wired in by `acquireLspPlugin`.
  class MockLSPClient {
    lastExtensions: unknown[] = [];
    lastTimeout = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(cfg: any) {
      this.lastExtensions = cfg.extensions ?? [];
      this.lastTimeout = cfg.timeout ?? 0;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugin(): any {
      return { mocked: 'pluginExtension' };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connect() {}
  }
  return {
    LSPClient: MockLSPClient,
    serverDiagnostics: vi.fn().mockReturnValue({ mocked: 'serverDiagnostics' }),
    // signatureHelp() returns an extension array — mimic that shape.
    signatureHelp: vi.fn().mockReturnValue({ mocked: 'signatureHelpExtension' }),
    serverCompletionSource: vi.fn().mockResolvedValue(null),
    LSPPlugin: { get: vi.fn() },
    createLspHoverTooltips: vi.fn().mockReturnValue({ mocked: 'hoverTooltips' }),
  };
});
vi.mock('@codemirror/state', () => ({ type: {} }));
vi.mock('@codemirror/view', () => ({ type: {} }));
vi.mock('@codemirror/autocomplete', () => ({
  autocompletion: () => ({}),
}));
// Mock the local hover extension so acquireLspPlugin doesn't pull in the
// real CM6 hover plumbing (which needs a live EditorView).
vi.mock('../lspHoverExtension', () => ({
  createLspHoverTooltips: vi.fn().mockReturnValue({ mocked: 'hoverTooltips' }),
}));

// Import after mocks are set up.

import { signatureHelp } from '@codemirror/lsp-client';

import {
  acquireLspPlugin,
  releaseLspClient,
  __resetLspClientPoolForTests,
} from '../lspClientManager';

describe('lspClientManager.signatureHelp wiring', () => {
  beforeEach(() => {
    __resetLspClientPoolForTests();
    vi.restoreAllMocks();
  });

  it('should_include_signatureHelp_extension_in_LSPClient_config', () => {
    // Spy on the signatureHelp factory to detect when it is invoked by the
    // manager while constructing the LSP client.
    const sigHelpSpy = vi.mocked(signatureHelp);

    acquireLspPlugin('/proj', 'rust', 'file:///proj/lib.rs');

    // The factory must have been called (with no args) to opt-in the default
    // keymap + plugin behavior.
    expect(sigHelpSpy).toHaveBeenCalled();
    expect(sigHelpSpy.mock.calls.some((call) => call.length === 0)).toBe(true);
  });

  it('should_return_a_callable_plugin_after_acquire', () => {
    // The public contract: acquireLspPlugin returns a CM6 plugin extension.
    // We assert the returned value is the one our MockLSPClient.plugin()
    // produces, and that it is stable across calls for the same key.
    const first = acquireLspPlugin('/proj2', 'typescript', 'file:///proj2/app.tsx');
    expect(first).toBeTruthy();
    expect((first as any).mocked).toBe('pluginExtension');

    // Re-acquire the same key — should return a plugin extension of the
    // same shape (cache hit on the bundle, so MockLSPClient is not
    // re-instantiated).
    const second = acquireLspPlugin('/proj2', 'typescript', 'file:///proj2/app.tsx');
    expect(second).toStrictEqual(first);
  });

  it('should_release_without_throwing', () => {
    // Release path must not throw even when called after acquire.
    acquireLspPlugin('/proj3', 'python', 'file:///proj3/main.py');
    expect(() => releaseLspClient('/proj3', 'python')).not.toThrow();
  });

  it('should_reset_pool_cleanly', () => {
    acquireLspPlugin('/proj4', 'go', 'file:///proj4/main.go');
    expect(() => __resetLspClientPoolForTests()).not.toThrow();
    // After reset, acquiring again must succeed (no stale state).
    expect(() => acquireLspPlugin('/proj4', 'go', 'file:///proj4/main.go')).not.toThrow();
  });
});

describe('signatureHelp factory contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should_be_callable_with_no_args', () => {
    expect(() => signatureHelp()).not.toThrow();
    expect(signatureHelp()).toBeTruthy();
  });

  it('should_accept_keymap_false_option', () => {
    expect(() => signatureHelp({ keymap: false })).not.toThrow();
  });
});
