// @vitest-environment node
/**
 * WorkspaceEdit 落地的行为契约：多 edit 合并为**一个事务**（单步撤销、无坐标漂移），
 * 且只作用于已打开的编辑器页。
 */
import { EditorState, Text } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';

import type { LspWorkspaceEdit } from '../lspWorkspaceEdit';
import { applyWorkspaceEdit, editsForUri, workspaceEditToChanges } from '../lspWorkspaceEdit';

const URI = 'file:///proj/main.go';
const DOC = 'package main\n\nfunc main() {\n}\n';

/** 最小 view：只实现 dispatch（与 lspCompletionApplyEdits.test.ts 同构）。 */
function makeView(doc: string) {
  let state = EditorState.create({ doc });
  const dispatches: unknown[][] = [];
  const view = {
    get state() {
      return state;
    },
    dispatch: (...specs: unknown[]) => {
      dispatches.push(specs);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      state = state.update(...(specs as any[])).state;
    },
  };
  return { view, dispatches, doc: () => state.doc.toString() };
}

const EDIT: LspWorkspaceEdit = {
  changes: {
    [URI]: [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'import "fmt"\n',
      },
      {
        range: {
          start: { line: 3, character: 1 },
          end: { line: 3, character: 1 },
        },
        newText: '\tfmt.Println("hi")\n',
      },
    ],
  },
};

describe('editsForUri', () => {
  it('从 changes 形态取目标 uri 的编辑', () => {
    expect(editsForUri(EDIT, URI)).toHaveLength(2);
  });

  it('从 documentChanges 形态取目标 uri 的编辑', () => {
    const asDocChanges: LspWorkspaceEdit = {
      documentChanges: [
        { textDocument: { uri: URI }, edits: EDIT.changes![URI] },
        { textDocument: { uri: 'file:///other.go' }, edits: [] },
      ],
    };
    expect(editsForUri(asDocChanges, URI)).toHaveLength(2);
  });

  it('create/rename/delete 等资源操作被忽略', () => {
    const withResourceOps: LspWorkspaceEdit = {
      documentChanges: [{ kind: 'create' }, { kind: 'rename' }],
    };
    expect(editsForUri(withResourceOps, URI)).toEqual([]);
  });
});

describe('workspaceEditToChanges', () => {
  it('越界坐标被夹紧而不是抛错', () => {
    const doc = Text.of(DOC.split('\n'));
    const changes = workspaceEditToChanges(doc, [
      {
        range: { start: { line: 99, character: 0 }, end: { line: 99, character: 0 } },
        newText: 'x',
      },
    ]);
    expect(changes).toHaveLength(1);
  });
});

describe('applyWorkspaceEdit', () => {
  it('多 edit 合并进一次 dispatch —— 单步撤销', () => {
    const { view, dispatches, doc } = makeView(DOC);
    const ok = applyWorkspaceEdit(EDIT, URI, () => view);

    expect(ok).toBe(true);
    expect(dispatches).toHaveLength(1);
    const text = doc();
    expect(text).toContain('import "fmt"');
    expect(text).toContain('fmt.Println');
  });

  it('没有打开的编辑器页时跳过且不抛', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ok = applyWorkspaceEdit(EDIT, URI, () => null);

    expect(ok).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('目标 uri 无编辑时不改文档', () => {
    const { view, dispatches, doc } = makeView(DOC);
    const ok = applyWorkspaceEdit({ changes: {} }, URI, () => view);

    expect(ok).toBe(false);
    expect(dispatches).toHaveLength(0);
    expect(doc()).toBe(DOC);
  });
});
