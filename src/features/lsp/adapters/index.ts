// LSP Adapter layer — re-exports for CodeMirror integration
//
// With @codemirror/lsp-client, manual adapters are no longer needed
// for hover, diagnostics, completion, or document highlight.
// The TauriLspTransport bridges the client to our Rust backend.
//
// This directory is kept for future custom adapters that extend
// @codemirror/lsp-client's built-in capabilities.

export { TauriLspTransport } from '../transport/TauriLspTransport';
