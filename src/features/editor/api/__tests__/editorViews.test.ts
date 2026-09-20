// @vitest-environment node
/**
 * editorViews 注册表（与 aiActionRegistry 同构）：同文件多 tab 共用同一身份时，
 * 卸载必须引用计数 —— 先卸载的 tab 不得摘掉存活页的视图。
 */
import type { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it } from 'vitest';

import { getEditorView, registerEditorView, unregisterEditorView } from '../editorViews';

const IDENTITY = 'test-identity';
const viewA = {} as EditorView;
const viewB = {} as EditorView;

describe('editorViews · 同身份多视图引用计数', () => {
  beforeEach(() => {
    unregisterEditorView(IDENTITY);
    unregisterEditorView(IDENTITY);
  });

  it('注册两个同身份视图 → 注销一个仍可解析；注销全部才返回 null', () => {
    registerEditorView(IDENTITY, viewA);
    registerEditorView(IDENTITY, viewB);

    unregisterEditorView(IDENTITY);
    expect(getEditorView(IDENTITY)).not.toBeNull();

    unregisterEditorView(IDENTITY);
    expect(getEditorView(IDENTITY)).toBeNull();
  });

  it('未登记的注销是 no-op', () => {
    expect(() => unregisterEditorView('missing-identity')).not.toThrow();
    expect(getEditorView('missing-identity')).toBeNull();
  });
});
