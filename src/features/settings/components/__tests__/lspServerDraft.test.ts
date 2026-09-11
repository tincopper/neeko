import { describe, expect, it } from 'vitest';

import type { CustomLspServerConfig } from '@/features/settings/types';

import {
  buildServerEntry,
  emptyDraftForm,
  parseCommaList,
  parseCommandText,
  parseExtensionsText,
  serverToDraftForm,
  type ServerDraftForm,
} from '../lspServerDraft';

const draft = (patch: Partial<ServerDraftForm> = {}): ServerDraftForm => ({
  ...emptyDraftForm(),
  languageId: 'protobuf',
  commandText: 'buf beta lsp',
  extensionsText: 'proto, pb',
  ...patch,
});

describe('parseCommandText', () => {
  it('按空白切分并去空（多空格 / 首尾空白）', () => {
    expect(parseCommandText('  buf   beta  lsp ')).toEqual(['buf', 'beta', 'lsp']);
    expect(parseCommandText('   ')).toEqual([]);
  });
});

describe('parseCommaList', () => {
  it('逗号切分 + trim + 去空项', () => {
    expect(parseCommaList(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
    expect(parseCommaList('')).toEqual([]);
  });
});

describe('parseExtensionsText', () => {
  it('去掉前导点并小写化', () => {
    expect(parseExtensionsText('.proto, PB')).toEqual(['proto', 'pb']);
  });
});

describe('serverToDraftForm', () => {
  it('列表字段回填为可编辑文本；initOptions 格式化 JSON', () => {
    const s = {
      id: 'id-1',
      languageId: 'protobuf',
      displayName: 'Buf',
      command: ['buf', 'beta', 'lsp'],
      file_extensions: ['proto', 'pb'],
      rootMarkers: ['buf.yaml'],
      autoStart: 'manual',
      initializationOptions: { a: 1 },
    } as CustomLspServerConfig;

    const d = serverToDraftForm(s);
    expect(d.commandText).toBe('buf beta lsp');
    expect(d.extensionsText).toBe('proto, pb');
    expect(d.rootMarkersText).toBe('buf.yaml');
    expect(d.autoStart).toBe('manual');
    expect(d.initializationOptionsText).toContain('"a": 1');
  });

  it('缺省字段回落：displayName / rootMarkers / autoStart / initOptions', () => {
    const d = serverToDraftForm({
      id: 'id-2',
      languageId: 'go',
      command: ['gopls'],
      file_extensions: ['go'],
    } as CustomLspServerConfig);
    expect(d.displayName).toBe('');
    expect(d.rootMarkersText).toBe('');
    expect(d.autoStart).toBe('onFirstFile');
    expect(d.initializationOptionsText).toBe('');
  });
});

describe('buildServerEntry', () => {
  it('合法草稿 → 条目（trim / 切分 / 去点小写）', () => {
    const r = buildServerEntry(draft({ displayName: '  Buf  ', extensionsText: '.proto, PB' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.languageId).toBe('protobuf');
    expect(r.entry.displayName).toBe('Buf');
    expect(r.entry.command).toEqual(['buf', 'beta', 'lsp']);
    expect(r.entry.file_extensions).toEqual(['proto', 'pb']);
    expect(r.entry.initializationOptions).toBeUndefined();
  });

  it('displayName 全空白 → undefined（不落空串）', () => {
    const r = buildServerEntry(draft({ displayName: '   ' }));
    expect(r.ok && r.entry.displayName).toBe(undefined);
  });

  it('校验顺序：languageId → command → extensions', () => {
    expect(
      buildServerEntry(draft({ languageId: '  ', commandText: '', extensionsText: '' })),
    ).toEqual({ ok: false, error: 'Language ID is required' });
    expect(buildServerEntry(draft({ commandText: '   ' }))).toEqual({
      ok: false,
      error: 'Command is required (e.g. gopls or buf beta lsp)',
    });
    expect(buildServerEntry(draft({ extensionsText: ' , ' }))).toEqual({
      ok: false,
      error: 'At least one file extension is required',
    });
  });

  it('initializationOptions 非法 JSON → 报错不落库', () => {
    expect(buildServerEntry(draft({ initializationOptionsText: '{oops' }))).toEqual({
      ok: false,
      error: 'initializationOptions must be valid JSON (object or array)',
    });
  });

  it('initializationOptions 合法 JSON → 解析为对象；空文本 → undefined', () => {
    const ok = buildServerEntry(draft({ initializationOptionsText: '{"a":1}' }));
    expect(ok.ok && ok.entry.initializationOptions).toEqual({ a: 1 });
    const blank = buildServerEntry(draft({ initializationOptionsText: '   ' }));
    expect(blank.ok && blank.entry.initializationOptions).toBe(undefined);
  });
});
