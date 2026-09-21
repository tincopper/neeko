import { forEachDiagnostic } from '@codemirror/lint';
import { LSPClient, type Transport } from '@codemirror/lsp-client';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushMicrotasks } from '@/testing/async';

import { lspDiagnosticsProjection } from '../lspDiagnosticsProjection';
import { lspServerDiagnostics } from '../lspServerDiagnostics';

/**
 * 端到端复现（2026-09-21 实证需求 + 2026-09-22 修正）：用**真实**
 * `@codemirror/lsp-client` 把「服务器推送 → 坐标映射 → lint 诊断位置」跑一遍，
 * 验证编辑器波浪线落点。
 *
 * 为什么必须有这条：用户实测「编辑后错误位置偏移 / 旧波浪线跑到别的行」，而排查
 * 只能靠日志推断，效率极低。这里把链路搬进测试，任何映射语义回归都能在本地几毫秒
 * 内定位。
 *
 * 语义（2026-09-22 十八轮逐条合并修正，见 lspServerDiagnostics.ts 头注释）：
 * - 版本门（内层）：旧版本号推送整批丢弃；
 * - 越界安全网：坐标形状落不进当前文档 → 陈旧；
 * - 内容锚定：点名 token 诊断的坐标必须落在当前文本的同名 token 上，否则陈旧
 *   （防「新版本号 + 旧坐标」把跟随正确的旧波浪线拽回旧行 —— 用户实测的错位根因）；
 * - 逐条判定 + 合并：新鲜诊断应用；陈旧诊断用 lint 已跟随位置重建坐标后一并应用
 *   （lint 里也没有 → 丢弃）。不做整批拒绝（会连带拒新鲜 syntax-error）、不做纯子集
 *   应用（整批替换语义下会隐式清除被过滤诊断）。
 * - 语法错误不再隐藏语义诊断（错误始终可见）。
 */

/** 冒充 Rust 后端的传输层：捕获上行消息、注入下行消息。 */
class StubTransport implements Transport {
  sent: string[] = [];
  private handlers = new Set<(value: string) => void>();

  constructor() {
    // initialize 请求自动应答（含诊断能力），让握手完成。
    this.onSend = (message) => {
      const parsed = JSON.parse(message) as { id?: number; method?: string };
      if (parsed.method === 'initialize' && parsed.id != null) {
        queueMicrotask(() =>
          this.receive({
            jsonrpc: '2.0',
            id: parsed.id,
            result: {
              capabilities: {
                positionEncoding: 'utf-16',
                textDocumentSync: { openClose: true, change: 2, save: {} },
              },
            },
          }),
        );
      }
    };
  }

  /** @internal 每次 send 的回调（测试注入用）。 */
  onSend: (message: string) => void = () => {};

  send(message: string): void {
    this.sent.push(message);
    this.onSend(message);
  }

  subscribe(handler: (value: string) => void): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: (value: string) => void): void {
    this.handlers.delete(handler);
  }

  receive(value: unknown): void {
    const text = JSON.stringify(value);
    for (const handler of this.handlers) handler(text);
  }

  publishDiagnostics(uri: string, version: number | null, diagnostics: unknown[]): void {
    this.receive({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        ...(version == null ? {} : { version }),
        diagnostics,
      },
    });
  }

  didChangeVersion(): number | null {
    const changes = this.sent.filter((m) => m.includes('"textDocument/didChange"'));
    const last = changes.at(-1);
    if (!last) return null;
    return (JSON.parse(last) as { params: { textDocument: { version: number } } }).params
      .textDocument.version;
  }
}

const URI = 'file:///p/crates/api/src/main.rs';

/** 三行内容前置，让 `int32` 落在第 14 行（1-based）、第 12 列 —— 与用户现场一致。 */
const DOC_LINES = [
  'pub mod app;',
  'pub mod jobs;',
  'pub mod routes;',
  '',
  'use tracing::info;',
  '',
  '#[tokio::main]',
  'async fn main() -> anyhow::Result<()> {',
  '    dotenvy::dotenv().ok();',
  '',
  '    let map = HashMap::new();',
  '    info!("{:?}", map);',
  '',
  '    let x: int32 = "oops";',
  '    Ok(())',
  '}',
  '',
  '',
  '',
  '',
];
const DOC = DOC_LINES.join('\n');

/** `int32` 的 LSP 范围：0-based 第 13 行、11..16 列（服务器实测发来的就是这个）。 */
const INT32_RANGE = {
  start: { line: 13, character: 11 },
  end: { line: 13, character: 16 },
};
const INT32_DIAGNOSTIC = {
  range: INT32_RANGE,
  severity: 1,
  source: 'rustc',
  code: 'E0425',
  message: 'cannot find type `int32` in this scope',
};

/** 在当前文本里直接定位 `int32` —— 比手算行号/列号可靠（编辑后行号会变）。 */
function expectedOffset(doc: EditorView['state']['doc']): { from: number; to: number } {
  const from = doc.toString().indexOf('int32');
  if (from < 0) throw new Error('int32 not found in document');
  return { from, to: from + 'int32'.length };
}

function lintPositions(view: EditorView): [number, number][] {
  const out: [number, number][] = [];
  forEachDiagnostic(view.state, (_d, from, to) => {
    out.push([from, to]);
  });
  return out;
}

describe('诊断坐标端到端：服务器范围 → 编辑器波浪线位置', () => {
  const views: EditorView[] = [];

  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    vi.restoreAllMocks();
  });

  function setup(): { view: EditorView; client: LSPClient; transport: StubTransport } {
    const transport = new StubTransport();
    const client = new LSPClient({
      extensions: [lspServerDiagnostics()],
      timeout: 120_000,
      rootUri: 'file:///p',
    });
    client.connect(transport);
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [client.plugin(URI, 'rust'), lspDiagnosticsProjection()],
      }),
      parent: document.body,
    });
    views.push(view);
    return { view, client, transport };
  }

  it('当前版本的推送：波浪线正好落在 int32 上', async () => {
    const { view, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    transport.publishDiagnostics(URI, 0, [INT32_DIAGNOSTIC]);

    expect(lintPositions(view)).toEqual([
      [expectedOffset(view.state.doc).from, expectedOffset(view.state.doc).to],
    ]);
  });

  it('编辑后（已同步）的推送：位置跟着文本走，不偏移', async () => {
    const { view, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    // 在文件上方插入两行（模拟用户回车）→ autoSync 发 didChange
    view.dispatch({ changes: { from: 0, insert: '// a\n// b\n' } });
    await vi.waitFor(() => expect(transport.didChangeVersion()).toEqual(1));

    // 服务器在新文本上重算：`int32` 下移两行 → 0-based line 15
    transport.publishDiagnostics(URI, 1, [
      {
        ...INT32_DIAGNOSTIC,
        range: { start: { line: 15, character: 11 }, end: { line: 15, character: 16 } },
      },
    ]);

    const expected = expectedOffset(view.state.doc);
    expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);
  });

  it('**过期版本**的推送：必须被版本门丢弃（这是位置偏移的根源）', async () => {
    const { view, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    transport.publishDiagnostics(URI, 0, [INT32_DIAGNOSTIC]);
    view.dispatch({ changes: { from: 0, insert: '// a\n// b\n' } });
    await vi.waitFor(() => expect(transport.didChangeVersion()).toEqual(1));

    // 服务器还在旧版本（v0）上算 → 这批坐标属于旧文本，绝不能按新文本套用
    transport.publishDiagnostics(URI, 0, [INT32_DIAGNOSTIC]);

    const expected = expectedOffset(view.state.doc);
    expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);
  });

  it('**带 version 却拿旧坐标**的推送：内容锚定识破，整批拒绝，跟随旧线不被拽回', async () => {
    const { view, client, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    // 基线：v0 权威推送，波浪线落在 int32 上
    transport.publishDiagnostics(URI, 0, [INT32_DIAGNOSTIC]);
    expect(lintPositions(view)).toHaveLength(1);

    // 在 int32 行正上方插入一行并同步（v1）：int32 下移一行，旧波浪线经映射跟随
    const int32Line = view.state.doc.line(14);
    view.dispatch({ changes: { from: int32Line.from, insert: '    let inserted = 1;\n' } });
    client.sync();
    await flushMicrotasks();
    expect(transport.didChangeVersion()).toEqual(1);
    const expected = expectedOffset(view.state.doc);
    expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);

    // 服务器落后：把 v1 版本号盖在旧坐标（line 13）上发出来。版本门放行（版本相符）、
    // 坐标不越界（插入行够长）→ 但内容锚定识破：该范围文本（插入行 11..16 = "inser"）
    // 不含 `int32` token → 整批拒绝 → 已随文本映射到 line 14 的旧波浪线**不被拽回**。
    // （用户实测「编辑后旧波浪线跑到别的行」的根因正是陈旧推送覆盖跟随正确的旧线。）
    transport.publishDiagnostics(URI, 1, [INT32_DIAGNOSTIC]);

    expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);

    // 新鲜推送（正确坐标 line 14）到达：锚定通过 → 整批替换，波浪线在 int32 上
    transport.publishDiagnostics(URI, 1, [
      {
        ...INT32_DIAGNOSTIC,
        range: { start: { line: 14, character: 11 }, end: { line: 14, character: 16 } },
      },
    ]);
    expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);
  });

  it('带 version 的新鲜推送：坐标直接应用到位（锚定通过）', async () => {
    const { view, client, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    transport.publishDiagnostics(URI, 0, [INT32_DIAGNOSTIC]);
    expect(lintPositions(view)).toHaveLength(1);

    const int32Line = view.state.doc.line(14);
    view.dispatch({ changes: { from: int32Line.from, insert: '    let inserted = 1;\n' } });
    client.sync();
    await flushMicrotasks();
    expect(transport.didChangeVersion()).toEqual(1);

    // 服务器新鲜推送（新坐标 line 14，跟随插入行下移）：版本相符 + 坐标不越界
    // + 锚定通过（该范围文本含 int32）→ 整批应用到位
    transport.publishDiagnostics(URI, 1, [
      {
        ...INT32_DIAGNOSTIC,
        range: { start: { line: 14, character: 11 }, end: { line: 14, character: 16 } },
      },
    ]);

    const expected = expectedOffset(view.state.doc);
    expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);
  });

  /// 实测场景（2026-09-21，rust-analyzer）：输入过程中文件处于语法错误状态，服务器
  /// 沿用**上一次类型分析**的坐标 —— 例如把 `int32` 报在只 12 列的新行上（char 11..16
  /// 越界）。这类坐标不属于当前文本，必须丢弃，否则波浪线画到行尾/错行。
  it('**越界（陈旧坐标）**整批丢弃：保留上一批正确的波浪线', async () => {
    const { view, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    transport.publishDiagnostics(URI, 0, [INT32_DIAGNOSTIC]);

    // 把 `int32` 之后的尾巴删掉（保留诊断本身）→ 该行只剩 16 列
    const line = view.state.doc.line(14);
    const tailFrom = line.text.indexOf(' = ');
    view.dispatch({ changes: { from: line.from + tailFrom, to: line.to, insert: '' } });
    const mapped = lintPositions(view);
    expect(mapped).toHaveLength(1);

    // 服务器仍发旧坐标（line 13, char 11..20），而当前该行只有 16 列 → 整批陈旧
    transport.publishDiagnostics(URI, 0, [
      {
        range: { start: { line: 13, character: 11 }, end: { line: 13, character: 20 } },
        severity: 1,
        code: 'E0425',
        message: 'stale coordinates',
      },
    ]);

    expect(lintPositions(view)).toEqual(mapped);
  });

  it('混合批：新鲜应用、陈旧无 lint 对应则丢弃（不做子集应用，跟随旧线不清除）', async () => {
    const { view, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    // 基线：v0 权威推送，波浪线落在 int32 上
    transport.publishDiagnostics(URI, 0, [INT32_DIAGNOSTIC]);
    const baseline = expectedOffset(view.state.doc);
    expect(lintPositions(view)).toEqual([[baseline.from, baseline.to]]);

    // 服务器推 [E0425(正确坐标) + 越界陈旧条]：publishDiagnostics 是整批替换语义，
    // 若只应用子集（正确条）会**隐式清除** lint 里被过滤的诊断。18 轮逐条合并下：
    // 新鲜 E0425 原样应用；陈旧越界条在 lint 无同 message 对应 → 丢弃。整批结果仍
    // 含 E0425（lint 旧线经新鲜条重新应用得以保留），不丢失也不画错位。
    transport.publishDiagnostics(URI, 0, [
      INT32_DIAGNOSTIC,
      {
        range: { start: { line: 13, character: 40 }, end: { line: 13, character: 46 } },
        severity: 1,
        code: 'E0425',
        message: 'stale coordinates',
      },
    ]);

    // 波浪线仍在 int32 上（新鲜条重新应用，陈旧条丢弃，无子集替换副作用）
    expect(lintPositions(view)).toEqual([[baseline.from, baseline.to]]);
  });

  /// 用户实测「编辑后波浪线消失」的精确复现（2026-09-22）+ 十八轮逐条合并修正：
  /// 批里 **陈旧越界的 E0425** + **新鲜的 syntax-error** 混装。整批拒绝会把新鲜的
  /// syntax 连带拒掉（缺分号波浪线不显示）；整批应用会让 E0425 跳回旧位置；只应用
  /// syntax 子集会挤掉 E0425。正确语义：**逐条决策 + 合并** —— 新鲜的 syntax 应用，
  /// 陈旧的 E0425 保留 lint/mirror 已跟随位置。
  it('陈旧越界 E0425 + 新鲜 syntax-error：逐条合并，E0425 保留且 syntax 显示', async () => {
    const { view, client, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    // 基线：v0 权威推送，E0425 波浪线落在 int32 上
    transport.publishDiagnostics(URI, 0, [INT32_DIAGNOSTIC]);
    const baseline = expectedOffset(view.state.doc);
    expect(lintPositions(view)).toEqual([[baseline.from, baseline.to]]);

    // 编辑：把 int32 行截短（模拟用户输入过程中该行变短），并**同步** —— sync 后
    // `file.doc` 更新为截短文档，E0425 旧坐标（char 11..20）对它越界（该行只有 16 列）
    const line = view.state.doc.line(14);
    const tailFrom = line.text.indexOf(' = ');
    view.dispatch({ changes: { from: line.from + tailFrom, to: line.to, insert: '' } });
    client.sync();
    await flushMicrotasks();
    const mapped = lintPositions(view);
    expect(mapped).toHaveLength(1);

    // 服务器推混装批：E0425 用旧坐标（line 13, char 11..20，对 sync 后的 file.doc 越界）
    // + 新鲜的 syntax-error（line 13 行首）。逐条合并：E0425 陈旧 → 保留 lint 已跟随
    // 位置（message 须与 lint 基线一致才能匹配）；syntax-error 新鲜 → 应用（缺分号
    // 波浪线必须显示）。
    transport.publishDiagnostics(URI, 1, [
      {
        ...INT32_DIAGNOSTIC,
        range: { start: { line: 13, character: 11 }, end: { line: 13, character: 20 } },
      },
      {
        range: { start: { line: 13, character: 0 }, end: { line: 13, character: 0 } },
        severity: 1,
        code: 'syntax-error',
        message: 'Syntax Error: expected SEMICOLON',
      },
    ]);

    // E0425 波浪线保留在 lint 已跟随位置 + syntax-error 点（行首零长度）显示
    const shortLine = view.state.doc.line(14);
    expect(lintPositions(view)).toEqual(
      expect.arrayContaining([
        [shortLine.from, shortLine.from], // syntax-error 点
        mapped[0], // E0425 保留跟随位置
      ]),
    );
  });

  /// 未同步编辑窗口（autoSync ~500ms）内的陈旧重定位：lint 跟随位置是**视图坐标**，
  /// 而内层按 `syncedDoc` 解释 range 再经 `unsyncedChanges.mapPos` 映射回视图 ——
  /// 重建必须经 `unsyncedChanges.invert` 反解回 syncedDoc，否则陈旧 E0425 会被未同步
  /// 偏移（本用例的 +2）拽离跟随位置。
  it('未同步窗口内的混装批：陈旧 E0425 反解 syncedDoc 重建，精确留在跟随位置', async () => {
    const { view, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    // 基线：v0 权威推送，E0425 波浪线落在 int32 上
    transport.publishDiagnostics(URI, 0, [INT32_DIAGNOSTIC]);
    expect(lintPositions(view)).toHaveLength(1);

    // 编辑但**不等待同步**（autoSync ~500ms 窗口内）：行首插入 2 字符，lint 跟随
    const int32Line = view.state.doc.line(14);
    view.dispatch({ changes: { from: int32Line.from, insert: 'ab' } });
    expect(transport.didChangeVersion()).toBeNull(); // 确认处于未同步窗口
    const followed = expectedOffset(view.state.doc);
    expect(lintPositions(view)).toEqual([[followed.from, followed.to]]);

    // 服务器仍在 v0 上推混装批：陈旧越界 E0425（char 40..46 超出 v0 行 26 列）+
    // 新鲜 syntax-error（v0 行首点）。逐条合并：syntax 应用；E0425 用 lint 跟随位置
    // 重建 —— 重建必须把视图偏移（含未同步的 +2）反解回 v0 坐标，经内层
    // unsyncedChanges 映射后仍精确落在 followed，否则被 "ab" 拽开。
    transport.publishDiagnostics(URI, 0, [
      {
        range: { start: { line: 13, character: 40 }, end: { line: 13, character: 46 } },
        severity: 1,
        code: 'E0425',
        message: 'cannot find type `int32` in this scope',
      },
      {
        range: { start: { line: 13, character: 0 }, end: { line: 13, character: 0 } },
        severity: 1,
        code: 'syntax-error',
        message: 'Syntax Error: expected SEMICOLON',
      },
    ]);

    const syntaxLine = view.state.doc.line(14);
    expect(lintPositions(view)).toEqual(
      expect.arrayContaining([
        [followed.from, followed.to], // E0425 精确留在跟随处（不被 +2 拽开）
        [syntaxLine.from, syntaxLine.from], // syntax 点映射到插入点之前（assoc -1）
      ]),
    );
  });

  /// 对齐 VS Code（2026-09-22 裁定）：语法诊断与语义诊断**同批都应用** —— 错误始终
  /// 可见，语法错误不再隐藏语义诊断（旧的「同批次含语法诊断只保留语法层」启发式已删，
  /// 语义诊断坐标由版本门 + 越界安全网 + 服务器重推自愈兜底）。
  it('同批次含语法诊断：语法与语义诊断同批都应用（不隐藏语义）', async () => {
    const { view, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    transport.publishDiagnostics(URI, 0, [
      {
        range: { start: { line: 13, character: 0 }, end: { line: 13, character: 0 } },
        severity: 1,
        code: 'syntax-error',
        message: 'Syntax Error: expected SEMICOLON',
      },
      INT32_DIAGNOSTIC,
    ]);

    // 语法诊断（零长度点，行首）+ 语义诊断（E0425 区间）同时渲染：
    // 按文档序（from 升序）→ 行首点在前、int32 区间在后
    const line = view.state.doc.line(14);
    const expected = expectedOffset(view.state.doc);
    expect(lintPositions(view)).toEqual([
      [line.from, line.from],
      [expected.from, expected.to],
    ]);
  });

  it('推送不带 version（服务器未声明）：即时应用，不丢诊断', async () => {
    const { view, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    transport.publishDiagnostics(URI, null, [INT32_DIAGNOSTIC]);
    const expected = expectedOffset(view.state.doc);
    expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);
  });

  /// 无 version 推送（对齐 VS Code）：与 version 推送同语义**即时应用**，无待定延迟。
  /// 客户端不猜新鲜度（信息论上无法判定），只由版本门（有 version 时）+ 越界安全网
  /// 兜底；陈旧坐标会短暂画错，靠服务器下一次新鲜推送整批替换自愈。
  describe('无 version 推送即时应用', () => {
    it('到达即应用', async () => {
      const { view, transport } = setup();
      await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

      transport.publishDiagnostics(URI, null, [INT32_DIAGNOSTIC]);
      const expected = expectedOffset(view.state.doc);
      expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);
    });

    it('快打中落后到达的推送：内容锚定识破陈旧坐标，跟随旧线不被拽回', async () => {
      const { view, client, transport } = setup();
      await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

      // 先建立波浪线（v0，位置正确）：到达即应用
      transport.publishDiagnostics(URI, null, [INT32_DIAGNOSTIC]);
      expect(lintPositions(view)).toHaveLength(1);

      // 行首插入 2 字符并同步（v1）：int32 同行右移 2 列
      //（notification 经 initializing 微任务发送，需 flushMicrotasks 兑现）
      const line = view.state.doc.line(14);
      view.dispatch({ changes: { from: line.from, insert: 'ab' } });
      client.sync();
      await flushMicrotasks();
      expect(transport.didChangeVersion()).toEqual(1);
      const expected = expectedOffset(view.state.doc);
      expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);

      // 服务器落后推送到达（仍是 v0 坐标：char 11..16，而当前该行 int32 在 13..18）：
      // 内容锚定检查该范围文本（`: int`) 不含 int32 → 整批拒绝，跟随的旧线不被拽回
      transport.publishDiagnostics(URI, null, [INT32_DIAGNOSTIC]);
      expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);

      // 服务器新鲜推送（当前坐标 char 13..18）到达：锚定通过 → 应用到位
      transport.publishDiagnostics(URI, null, [
        {
          ...INT32_DIAGNOSTIC,
          range: { start: { line: 13, character: 13 }, end: { line: 13, character: 18 } },
        },
      ]);
      expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);
    });

    it('有 version 的权威推送即时应用，后续相同推送不改变位置', async () => {
      const { view, transport } = setup();
      await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

      const staleAtLine0 = {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        severity: 1,
        message: 'stale',
      };
      // 无 version 推送：不越界即应用
      transport.publishDiagnostics(URI, null, [staleAtLine0]);
      expect(lintPositions(view)).toEqual([[0, 3]]);

      // 权威推送（v0 == 当前同步版本）：立即生效（整体替换 line 0 的旧线）
      transport.publishDiagnostics(URI, 0, [INT32_DIAGNOSTIC]);
      const expected = expectedOffset(view.state.doc);
      expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);

      // 相同的无 version 推送再到：整批替换语义，位置不变
      transport.publishDiagnostics(URI, null, [INT32_DIAGNOSTIC]);
      expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);
    });

    it('同步后到达的陈旧无version推送：内容锚定识破，跟随旧线不被拽回（用户现场）', async () => {
      const { view, client, transport } = setup();
      await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

      // 基线：无 version 推送即时应用，波浪线落在 int32 上
      transport.publishDiagnostics(URI, null, [INT32_DIAGNOSTIC]);
      expect(lintPositions(view)).toHaveLength(1);

      // 在 int32 行正上方插入一行并同步（v1）：int32 下移一行，旧波浪线经映射跟随；
      // 关键是新文档的旧行号（line 13）仍是插入长行，陈旧坐标能通过越界检查 ——
      // 这正是用户现场：内容锚定是「行号合法但内容对不上」的唯一可判定判据
      const int32Line = view.state.doc.line(14);
      view.dispatch({ changes: { from: int32Line.from, insert: '    let inserted = 1;\n' } });
      client.sync();
      await flushMicrotasks();
      expect(transport.didChangeVersion()).toEqual(1);
      const expected = expectedOffset(view.state.doc);
      expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);

      // 服务器落后推送到达（仍是旧坐标 line 13）：锚定检查该范围文本
      //（插入行 `    let inserted = 1;` 的 11..16 = "inser"）不含 int32 → 整批拒绝，
      // 已随文本映射到 line 14 的旧波浪线不被拽回插入行（用户实测的错位根因）
      transport.publishDiagnostics(URI, null, [INT32_DIAGNOSTIC]);
      expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);

      // 服务器新鲜推送（正确坐标 line 14）到达：锚定通过 → 应用到位
      transport.publishDiagnostics(URI, null, [
        {
          ...INT32_DIAGNOSTIC,
          range: { start: { line: 14, character: 11 }, end: { line: 14, character: 16 } },
        },
      ]);
      expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);
    });

    it('同步后到达的新鲜无version推送：坐标直接应用到位', async () => {
      const { view, client, transport } = setup();
      await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

      transport.publishDiagnostics(URI, null, [INT32_DIAGNOSTIC]);
      expect(lintPositions(view)).toHaveLength(1);

      const int32Line = view.state.doc.line(14);
      view.dispatch({ changes: { from: int32Line.from, insert: '    let inserted = 1;\n' } });
      client.sync();
      await flushMicrotasks();
      expect(transport.didChangeVersion()).toEqual(1);

      // 服务器新鲜推送（新坐标 line 14，跟随插入行下移）：不越界 → 直接应用
      const fresh = {
        ...INT32_DIAGNOSTIC,
        range: { start: { line: 14, character: 11 }, end: { line: 14, character: 16 } },
      };
      transport.publishDiagnostics(URI, null, [fresh]);

      const expected = expectedOffset(view.state.doc);
      expect(lintPositions(view)).toEqual([[expected.from, expected.to]]);
    });
  });

  /// 修正后的完整序列（2026-09-22 用户复测修正）：编辑插行 → 旧波浪线经
  /// lint/mirror 映射**跟随**文本（CodeMirror 天然行为）→ 服务器陈旧推送
  /// （新版本号 + 旧坐标，不越界）被**内容锚定识破**（范围文本不含 token）→ 整批拒绝，
  /// 跟随正确的旧线**不被拽回** → 新鲜推送（正确坐标）锚定通过 → 应用到位。
  /// 这就是用户实测「编辑后旧波浪线跑到别的行」的修复判据。
  it('edit_insert_line_then_stale_rejected_then_fresh_applies', async () => {
    const { view, transport } = setup();
    await vi.waitFor(() => expect(transport.sent.some((m) => m.includes('didOpen'))).toBe(true));

    // 基线：v0 权威推送，波浪线落在 int32 上
    transport.publishDiagnostics(URI, 0, [INT32_DIAGNOSTIC]);
    const baseline = expectedOffset(view.state.doc);
    expect(lintPositions(view)).toEqual([[baseline.from, baseline.to]]);

    // 编辑：在 int32 行正上方插行（autoSync 发 didChange → v1）。旧波浪线经
    // lint/mirror 的 `map(tr.changes)` 跟随文本，仍紧贴 int32 —— 不闪断
    const int32Line = view.state.doc.line(14);
    view.dispatch({ changes: { from: int32Line.from, insert: '    let inserted = 1;\n' } });
    await vi.waitFor(() => expect(transport.didChangeVersion()).toEqual(1));
    const followed = expectedOffset(view.state.doc);
    expect(followed.from).toBeGreaterThan(baseline.from); // int32 确实随插行下移
    expect(lintPositions(view)).toEqual([[followed.from, followed.to]]);

    // 服务器仍拿旧分析坐标（line 13）随当前版本号推送：版本门放行（版本相符）、
    // 坐标不越界（插入行够长）→ 内容锚定识破：插入行 11..16 = "inser" 不含 `int32`
    // → 整批拒绝 → 跟随正确的旧线保留在 line 14（用户实测的错位根因被修掉）
    transport.publishDiagnostics(URI, 1, [INT32_DIAGNOSTIC]);
    expect(lintPositions(view)).toEqual([[followed.from, followed.to]]);

    // 新鲜推送（正确坐标 line 14）到达：锚定通过 → 整批替换，波浪线在 int32 上
    transport.publishDiagnostics(URI, 1, [
      {
        ...INT32_DIAGNOSTIC,
        range: { start: { line: 14, character: 11 }, end: { line: 14, character: 16 } },
      },
    ]);
    expect(lintPositions(view)).toEqual([[followed.from, followed.to]]);
  });
});
