// @vitest-environment node
/**
 * 自动导包（补全接受时原子应用 `additionalTextEdits`）的机制与补丁护栏。
 *
 * 背景：`@codemirror/lsp-client` 的 `serverCompletionSource` 把「插入文本」与
 * 「附加编辑（import）」当成互斥分支 —— snippet 格式的补全（gopls 的函数补全
 * `fmt.Println(${1:a ...any})`）走 snippet 分支后 **丢弃** `additionalTextEdits`，
 * 于是"接受补全后 import 不落"。本仓库以 pnpm patch 修正该分支（见
 * `patches/@codemirror__lsp-client@6.2.5.patch`），此文件同时护栏三件事：
 *   1. 上游 `snippet()` 的 apply 函数契约（返回 void、内部自行 dispatch）；
 *   2. 修正方案依赖的事务语义（多 spec 合并 = 旧文档坐标系 + 单事务）；
 *   3. 安装到 node_modules 的包必须真的是修正后的版本。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { snippet } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

/** `@codemirror/lsp-client/dist/index.js` 的 `lspToSnippet` 同实现。 */
const lspToSnippet = (text: string): string =>
  text.replace(/\\([$}\\])|\$(\d+)/g, (_m, esc: string, field: string) => esc || `\${${field}}`);

const BASE = 'package main\n\nimport (\n)\n\nfunc main() {\n\tfmt.Pr\n}\n';
const SNIPPET_TEXT = 'Println(${1:a ...any})';
const IMPORT_AT = BASE.indexOf('import (') + 'import ('.length;
/** import "fmt" 的附加编辑：LSP 语义下与主替换**同一坐标系**（旧文档）。 */
const ADDITIONAL_EDITS = [{ from: IMPORT_AT, to: IMPORT_AT, text: '\n\t"fmt"' }];
const FROM = BASE.indexOf('Pr');
const TO = FROM + 2;

interface FakeView {
  state: EditorState;
  dispatch: (...specs: unknown[]) => void;
}

/** 最小 view：只实现 snippet()/apply 用到的 state + dispatch。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeView(): FakeView & { count: () => number; last: () => any } {
  let state = EditorState.create({ doc: BASE });
  let count = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let last: any = null;
  return {
    get state() {
      return state;
    },
    dispatch: (...specs: unknown[]) => {
      count += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tr = state.update(...(specs as any[]));
      last = tr;
      state = tr.state;
    },
    count: () => count,
    last: () => last,
  };
}

describe('自动导包：补全应用机制', () => {
  it('上游 snippet() 的 apply 返回 void —— 因此 `view.dispatch(spec, …)` 会抛错', () => {
    const view = makeView();
    const apply = snippet(lspToSnippet(SNIPPET_TEXT));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const returned = (apply as any)(view, undefined, FROM, TO);

    expect(returned).toBeUndefined();
    expect(view.state.doc.toString()).toContain('Println(');
    // 关键陷阱：把 void 当成 spec 传给 dispatch（旧补丁正是这么写的）必抛
    expect(() => view.dispatch(returned, { changes: [] })).toThrow(TypeError);
  });

  it('捕获 shim 合并附加编辑：单事务落地 insert + import，可一步撤销', () => {
    const view = makeView();
    let captured: unknown = null;
    const capture = {
      get state() {
        return view.state;
      },
      dispatch: (tr: unknown) => {
        captured = tr;
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snippet(lspToSnippet(SNIPPET_TEXT))(capture as any, undefined, FROM, TO);
    expect(captured).not.toBeNull();
    view.dispatch(captured, {
      changes: ADDITIONAL_EDITS.map((e) => ({ from: e.from, to: e.to, insert: e.text })),
    });

    const doc = view.state.doc.toString();
    expect(doc).toContain('Println('); // 主替换
    expect(doc).toContain('"fmt"'); // 自动导入
    expect(view.count()).toBe(1); // 原子：一次 dispatch = 单步撤销

    // 该事务确实同时携带两处编辑（旧文档坐标系合并）
    const tr = view.last();
    let changeCount = 0;
    tr.changes.iterChanges(() => {
      changeCount += 1;
    });
    expect(changeCount).toBe(2);
    expect(tr.newDoc.toString()).toBe(doc);
  });
});

describe('自动导包：补丁护栏（pnpm patch 丢失/回退即红）', () => {
  const distPath = join(process.cwd(), 'node_modules/@codemirror/lsp-client/dist/index.js');
  const dist = readFileSync(distPath, 'utf8');

  it('安装的包必须含「snippet + additionalTextEdits 合并」实现', () => {
    expect(dist).toContain('Neeko patch');
    // 合并必须发生在**同一事务**（captured snippet transaction + edits）
    expect(dist).toMatch(/dispatch\(snippetTxn, \{ changes:/);
  });

  it('安装的包不得回退到会丢 import 的旧写法', () => {
    // ① 上游原样：snippet 分支直接 `option.apply = …snippet(…)` → additionalTextEdits 被丢弃
    expect(dist).not.toContain('=> snippet(lspToSnippet(text))(view, c, from, to);');
    // ② 第一版补丁：把 snippet() 的 void 返回值当 spec 传给 dispatch → TypeError（import 仍不落）
    expect(dist).not.toMatch(/let spec = snippet\(lspToSnippet\(text\)\(/);
  });
});
