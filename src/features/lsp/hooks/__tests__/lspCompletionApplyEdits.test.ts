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
import { serverCompletionSource } from '@codemirror/lsp-client';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { resolveCompletionItem } from '../lspCompletionResolve';

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

describe('自动导包：延迟编辑（completionItem/resolve）真正跑通 patch', () => {
  /** 与 rust-analyzer 1.97.1 的 flyimport 响应同构：无内联编辑，只有 `data`。 */
  const DOC = 'fn main() {\n    Hash\n}\n';
  const IMPORT_EDIT = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: 'use std::collections::HashMap;\n',
  };
  const ITEM = {
    label: 'HashMap',
    insertText: 'HashMap',
    filterText: 'HashMap',
    kind: 22,
    data: { imports: [{ full_import_path: 'std::collections::HashMap' }] },
    textEdit: {
      range: { start: { line: 1, character: 4 }, end: { line: 1, character: 8 } },
      newText: 'HashMap',
    },
  };

  /** `LSPPlugin.get(view)` 只调 `view.plugin(...)` —— 无需 DOM 即可驱动真实库代码。 */
  function harness() {
    const calls: { method: string; params: unknown }[] = [];
    let state = EditorState.create({ doc: DOC });
    const dispatches: unknown[][] = [];
    const view = {
      get state() {
        return state;
      },
      plugin: () => ({
        uri: 'file:///probe.rs',
        // 与库内 `toPosition` 同实现（doc 偏移 → LSP {line, character}）
        toPosition: (pos: number) => {
          const line = state.doc.lineAt(pos);
          return { line: line.number - 1, character: pos - line.from };
        },
        client: {
          serverCapabilities: {},
          hasCapability: () => true,
          sync: async () => undefined,
          request: async (method: string, params: unknown) => {
            calls.push({ method, params });
            if (method === 'textDocument/completion') return { items: [ITEM] };
            return { additionalTextEdits: [IMPORT_EDIT] };
          },
        },
      }),
      dispatch: (...specs: unknown[]) => {
        dispatches.push(specs);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        state = state.update(...(specs as any[])).state;
      },
    };
    return { calls, view, dispatches, doc: () => state.doc.toString() };
  }

  it('库把原始 item 透出并在构建期标记需要 resolve', async () => {
    const h = harness();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await serverCompletionSource({
      view: h.view,
      state: h.view.state,
      pos: 18,
      explicit: true,
      // `getCompletions` 把 context 本身当 abort 用（调 context.addEventListener）
      addEventListener: () => undefined,
    } as unknown as import('@codemirror/autocomplete').CompletionContext);

    const option = result.options[0];
    expect(option.lspItem).toBe(ITEM); // resolve 的凭据（含 data）
    expect(option.neekoNeedsResolve).toBe(true); // 构建期判定，晚一步就退化成裸插入
  });

  it('延迟编辑与插入文本在同一事务落地（一次 dispatch、可一步撤销）', async () => {
    const h = harness();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await serverCompletionSource({
      view: h.view,
      state: h.view.state,
      pos: 18,
      explicit: true,
      // `getCompletions` 把 context 本身当 abort 用（调 context.addEventListener）
      addEventListener: () => undefined,
    } as unknown as import('@codemirror/autocomplete').CompletionContext);
    const option = result.options[0];

    // 真实 resolver 往返：发 resolve 并把编辑写回候选
    const edits = await resolveCompletionItem(option, {
      client: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        request: (h.view as any).plugin().client.request,
      },
    });
    expect(edits).toEqual([IMPORT_EDIT]);

    // 接受补全
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    option.apply(h.view, option, result.from, result.to);

    const doc = h.doc();
    expect(doc).toContain('HashMap');
    expect(doc).toContain('use std::collections::HashMap;');
    // 原子：插入 + import 合并进**一次** dispatch
    expect(h.dispatches).toHaveLength(1);
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

  it('安装的包必须透出原始 CompletionItem 并在接受时收集延迟编辑', () => {
    // ① 原始 item 必须挂到 option 上 —— 否则客户端无从发起 `completionItem/resolve`
    //    （服务器靠 item 里的 `data` 计算 import 编辑）。
    expect(dist).toContain('option.lspItem = item');
    // ② 「该项需要 resolve」必须在**构建期**判定（`item.data != null`）：装 apply 的
    //    分支此刻就求值，等调用方拿到 options 再标已经晚了（会退化成裸 label 插入）。
    expect(dist).toMatch(/if \(item\.data != null\)\s*\n\s*option\.neekoNeedsResolve = true;/);
    // ② 编辑必须在**接受时**收集：延迟到 resolve 的编辑此刻才存在
    expect(dist).toMatch(/collectEdits\(view\.state\.doc\)/);
    // ③ 非 snippet 分支的 applyEdits 也要能吃"取值函数"，否则延迟编辑进不来
    expect(dist).toContain('resolvedEdits');
    // ④ 仍然保持单事务：插入与 import 编辑合并进同一个 dispatch
    expect(dist).toMatch(/dispatch\(snippetTxn, \{ changes:/);
  });

  it('安装的包不得回退到会丢 import 的旧写法', () => {
    // ① 上游原样：snippet 分支直接 `option.apply = …snippet(…)` → additionalTextEdits 被丢弃
    expect(dist).not.toContain('=> snippet(lspToSnippet(text))(view, c, from, to);');
    // ② 第一版补丁：把 snippet() 的 void 返回值当 spec 传给 dispatch → TypeError（import 仍不落）
    expect(dist).not.toMatch(/let spec = snippet\(lspToSnippet\(text\)\(/);
  });
});
