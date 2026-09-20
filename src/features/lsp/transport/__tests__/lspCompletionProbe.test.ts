import { describe, expect, it } from 'vitest';

import {
  rememberPendingCompletionId,
  summarizeCompletionDiagnostics,
  summarizeCompletionRequest,
  summarizeLifecycleMessage,
} from '../lspCompletionProbe';

/**
 * 自动导包探针的响应摘要（纯函数）：「接受补全后 import 不落」时，
 * 需要一眼区分「服务端没给 additionalTextEdits」与「客户端应用层丢了」。
 *
 * （F7b 纯搬移：用例体与 `tauriLspTransport.test.ts` 原 describe 逐字一致，
 * 只换 import 源；transport 侧只留订阅/转发/生命周期的集成用例。）
 */
describe('summarizeCompletionDiagnostics', () => {
  it('数组形态（CompletionItem[]）统计附加编辑并取样本', () => {
    const items = [
      { label: 'Println', insertTextFormat: 2, additionalTextEdits: [{ newText: 'import "fmt"' }] },
      { label: 'Printf' },
    ];
    const summary = summarizeCompletionDiagnostics(items);
    expect(summary.total).toBe(2);
    expect(summary.withAdditionalEdits).toBe(1);
    expect(summary.samples).toEqual([{ label: 'Println', edits: 1, insertTextFormat: 2 }]);
  });

  it('对象形态（{ items }）等价处理', () => {
    const summary = summarizeCompletionDiagnostics({
      items: [{ label: 'a', additionalTextEdits: [{}, {}] }],
    });
    expect(summary.total).toBe(1);
    expect(summary.withAdditionalEdits).toBe(1);
    expect(summary.samples[0]).toEqual({ label: 'a', edits: 2, insertTextFormat: undefined });
  });

  it('异常 / 空载荷 → 全零且不抛错（不得因探针本身炸掉补全链路）', () => {
    for (const payload of [null, undefined, {}, { items: 'nope' }, 'nope', 42]) {
      const summary = summarizeCompletionDiagnostics(payload);
      expect(summary.total).toBe(0);
      expect(summary.withAdditionalEdits).toBe(0);
      expect(summary.samples).toEqual([]);
    }
  });

  it('空 additionalTextEdits 数组不算「有附加编辑」', () => {
    const summary = summarizeCompletionDiagnostics({
      items: [{ label: 'a', additionalTextEdits: [] }],
    });
    expect(summary.withAdditionalEdits).toBe(0);
  });
});

describe('rememberPendingCompletionId（纯函数不变量）', () => {
  it('id 集合有界且保新：超限淘汰最旧（纯函数不变量）', () => {
    const pending = new Set<number>();
    for (let id = 1; id <= 65; id++) {
      rememberPendingCompletionId(pending, id, 64);
    }
    expect(pending.size).toBe(64);
    expect(pending.has(1)).toBe(false); // 最旧被淘汰
    expect(pending.has(65)).toBe(true); // 最新保留

    // 响应会把 id 移出集合（配合 clear 形成"只留在途"的不变量）
    const single = new Set<number>();
    rememberPendingCompletionId(single, 7);
    expect([...single]).toEqual([7]);
  });
});

describe('importCandidates（M=0 分叉判据）', () => {
  it('M=0 时必须能区分「没有需导包的候选」与「有候选但服务器没给编辑」', () => {
    // r-a 的 flyimport 候选：label 是符号名，模块路径在 labelDetails.detail / detail 里
    const withCandidate = summarizeCompletionDiagnostics({
      items: [
        { label: 'HashMap', labelDetails: { detail: 'std::collections' } },
        { label: 'self::' },
      ],
    });
    expect(withCandidate.importCandidates).toEqual([
      { label: 'HashMap', modulePath: 'std::collections', edits: 0, hasData: false },
    ]);

    // 候选带编辑（正常自动导包路径）
    const withEdits = summarizeCompletionDiagnostics([
      {
        label: 'BTreeMap',
        labelDetails: { detail: 'std::collections' },
        additionalTextEdits: [{ newText: 'use std::collections::BTreeMap;\n' }],
        data: { import: 'std::collections::BTreeMap' },
      },
    ]);
    expect(withEdits.importCandidates[0]).toMatchObject({
      label: 'BTreeMap',
      edits: 1,
      hasData: true,
    });

    // 路径关键字（self:: / crate:: / super::）不是导包候选
    expect(
      summarizeCompletionDiagnostics([{ label: 'crate::' }, { label: 'super::' }]).importCandidates,
    ).toEqual([]);

    // 纯类型签名 detail 不误判
    expect(
      summarizeCompletionDiagnostics([{ label: 'len', detail: 'fn(&self) -> usize' }])
        .importCandidates,
    ).toEqual([]);
  });
});

/**
 * 文档同步探针：补全列表"不随前缀收敛"时要能判断服务器手里的文本是否滞后。
 * 关键：完补请求的 uri 必须与 didChange/didOpen 的 uri 一致，且 didChange 真的发出。
 */
describe('文档同步探针', () => {
  it('didChange 摘要含 uri 尾段 / 版本 / 变更量与是否全量', () => {
    const incremental = summarizeLifecycleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'file:///p/src/main.rs', version: 7 },
          contentChanges: [{ range: { start: {}, end: {} }, text: 'HashMa' }],
        },
      }),
    );
    expect(incremental).toBe('textDocument/didChange main.rs v=7 changes=1 full=false len=6');

    const full = summarizeLifecycleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: 'file:///p/src/main.rs', version: 8 },
          contentChanges: [{ text: 'fn main() {}' }],
        },
      }),
    );
    expect(full).toContain('full=true');

    const open = summarizeLifecycleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: { uri: 'file:///p/src/main.rs', version: 1, text: 'fn main() {}\n' },
        },
      }),
    );
    expect(open).toBe('textDocument/didOpen main.rs v=1 open-len=13');
  });

  it('非生命周期消息与异常载荷不产生摘要', () => {
    expect(summarizeLifecycleMessage('{"method":"textDocument/completion"}')).toBeNull();
    expect(summarizeLifecycleMessage('not json')).toBeNull();
  });

  it('补全请求摘要含目标 uri 与位置（用于与生命周期 uri 对照）', () => {
    expect(
      summarizeCompletionRequest(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 42,
          method: 'textDocument/completion',
          params: {
            textDocument: { uri: 'file:///p/src/main.rs' },
            position: { line: 11, character: 7 },
          },
        }),
      ),
    ).toBe('id=42 main.rs @11:7');
    expect(summarizeCompletionRequest('{"method":"textDocument/completion"}')).toBeNull();
  });
});
