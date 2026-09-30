// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LANGUAGE_BY_EXTENSION } from '@/shared/utils/languageRegistry';

import {
  LSP_EXTENSIONS,
  applyCustomServersFromConfig,
  cacheLiveLanguageResolution,
  getLspLanguageId,
  resolveLspLanguageId,
  applyBackendExtensionMap,
  toFileUri,
} from '../languageMap';
import * as lspApi from '../lspApi';

describe('languageMap', () => {
  beforeEach(() => {
    applyBackendExtensionMap([]);
    vi.restoreAllMocks();
  });

  it('should_map_builtin_extensions', () => {
    expect(getLspLanguageId('src/main.go')).toBe('go');
    expect(getLspLanguageId('/tmp/lib.rs')).toBe('rust');
    expect(getLspLanguageId('App.tsx')).toBe('typescriptreact');
  });

  it('should_prefer_custom_extension_map', () => {
    applyBackendExtensionMap([
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
    applyCustomServersFromConfig([{ languageId: 'terraform', file_extensions: ['tf', '.TF'] }]);
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
    applyBackendExtensionMap([]);
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

describe('LSP 覆盖度护栏', () => {
  it('LSP_EXTENSIONS 均收录于 languageRegistry 词表（新增扩展名只改词表）', () => {
    expect(LSP_EXTENSIONS.length).toBeGreaterThan(0);
    const missing = LSP_EXTENSIONS.filter((ext) => !LANGUAGE_BY_EXTENSION[ext]);
    expect(missing).toEqual([]);
  });
});

/**
 * LSP 文档 uri 的形态契约（锚定 + 形态各自单点：`canonicalFsPath` / `fileUriOfPath`）。
 * 关键是**盘符必须占第三斜杠**：`file://C:/…` 的 `C:` 会被服务端按 RFC 3986 当作 authority，
 * 路径退化为 `/…`；相对入参在 Windows 项目根上尤其容易踩（旧实现只在绝对分支判盘符）。
 */
describe('toFileUri — 文档 uri 形态', () => {
  it('POSIX 绝对路径：三斜杠', () => {
    expect(toFileUri('/repo', '/repo/src/a.ts')).toBe('file:///repo/src/a.ts');
  });

  it('POSIX 相对路径：先锚定项目根', () => {
    expect(toFileUri('/repo', 'src/a.ts')).toBe('file:///repo/src/a.ts');
  });

  it('Windows 绝对路径：盘符占第三斜杠（不落 host 位）', () => {
    expect(toFileUri('C:/ws', 'C:/ws/src/a.ts')).toBe('file:///C:/ws/src/a.ts');
  });

  it('Windows 相对路径：锚定后仍走盘符分支（旧实现此处产出 file://C:/…）', () => {
    expect(toFileUri('C:/ws', 'src\\a.ts')).toBe('file:///C:/ws/src/a.ts');
  });
});
