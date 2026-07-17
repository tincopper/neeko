import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as lspApi from '../api/lspApi';
import {
  applyCustomServersFromConfig,
  cacheLiveLanguageResolution,
  getLspLanguageId,
  resolveLspLanguageId,
  setCustomLspExtensionMap,
} from '../languageMap';

describe('languageMap', () => {
  beforeEach(() => {
    setCustomLspExtensionMap([]);
    vi.restoreAllMocks();
  });

  it('should_map_builtin_extensions', () => {
    expect(getLspLanguageId('src/main.go')).toBe('go');
    expect(getLspLanguageId('/tmp/lib.rs')).toBe('rust');
    expect(getLspLanguageId('App.tsx')).toBe('typescriptreact');
  });

  it('should_prefer_custom_extension_map', () => {
    setCustomLspExtensionMap([
      {
        extension: 'proto',
        languageId: 'protobuf',
        serverName: 'buf-lsp',
        isCustom: true,
      },
    ]);
    expect(getLspLanguageId('api/v1.proto')).toBe('protobuf');
  });

  it('should_apply_custom_servers_from_config', () => {
    applyCustomServersFromConfig([
      { languageId: 'terraform', file_extensions: ['tf', '.TF'] },
    ]);
    expect(getLspLanguageId('main.tf')).toBe('terraform');
  });

  it('should_cache_live_resolution_for_unknown_ext', () => {
    expect(getLspLanguageId('schema.graphql')).toBeNull();
    cacheLiveLanguageResolution('schema.graphql', 'graphql');
    expect(getLspLanguageId('schema.graphql')).toBe('graphql');
  });

  it('should_not_cache_empty_language', () => {
    cacheLiveLanguageResolution('x.foo', '  ');
    expect(getLspLanguageId('x.foo')).toBeNull();
  });
});

describe('resolveLspLanguageId', () => {
  beforeEach(() => {
    setCustomLspExtensionMap([]);
    vi.restoreAllMocks();
  });

  it('should_use_backend_live_registry_when_available', async () => {
    vi.spyOn(lspApi, 'lspResolveLanguage').mockResolvedValue('protobuf');

    const id = await resolveLspLanguageId('svc/foo.proto');
    expect(id).toBe('protobuf');
    expect(getLspLanguageId('svc/foo.proto')).toBe('protobuf');
  });

  it('should_fall_back_to_local_map_when_backend_fails', async () => {
    vi.spyOn(lspApi, 'lspResolveLanguage').mockRejectedValue(new Error('no runtime'));

    const id = await resolveLspLanguageId('main.go');
    expect(id).toBe('go');
  });

  it('should_fall_back_when_backend_returns_null', async () => {
    vi.spyOn(lspApi, 'lspResolveLanguage').mockResolvedValue(null);

    const id = await resolveLspLanguageId('main.py');
    expect(id).toBe('python');
  });
});
