// @vitest-environment node
import { listen } from '@tauri-apps/api/event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  LSP_DIAG_EVENT_PREFIX,
  LSP_PROGRESS_EVENT_PREFIX,
  LSP_PROFILE_EVENT,
} from '@/shared/events';

import { useLspStore } from '../lspStore';
import type { LspDiagnostic } from '../types';

type Handler = (event: { payload: Record<string, unknown> }) => void;

const PROJECT = '/tmp/neeko';
const LANG = 'java';
function emit(
  captured: Map<string, Handler>,
  eventName: string,
  payload: Record<string, unknown> | null,
) {
  captured.get(eventName)?.({ payload });
}

describe('lspStore progress tokens', () => {
  let captured: Map<string, Handler>;
  let unlistens: Mock[];

  beforeEach(() => {
    captured = new Map();
    unlistens = [];
    vi.mocked(listen).mockImplementation(((eventName: string, handler: Handler) => {
      captured.set(eventName, handler);
      const unlisten = vi.fn();
      unlistens.push(unlisten);
      return Promise.resolve(unlisten);
    }) as typeof listen);
    useLspStore.setState({ sessions: {}, progressTokens: {} });
  });

  it('begin 推 token 并把 ready 会话置 indexing（busy）', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    useLspStore.getState().setSessionState(PROJECT, LANG, { status: 'ready' });

    emit(captured, `${LSP_PROGRESS_EVENT_PREFIX}${PROJECT}`, {
      languageId: LANG,
      token: 'import-1',
      kind: 'begin',
    });

    expect(useLspStore.getState().progressTokens[PROJECT]?.[LANG]).toEqual(['import-1']);
    expect(useLspStore.getState().sessions[PROJECT]?.[LANG]?.status).toBe('indexing');
    unlisten();
  });

  it('多 token 先后 end：非末仍 busy，末 token 才 ready', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    useLspStore.getState().setSessionState(PROJECT, LANG, { status: 'ready' });

    emit(captured, `${LSP_PROGRESS_EVENT_PREFIX}${PROJECT}`, {
      languageId: LANG,
      token: 'import-long',
      kind: 'begin',
    });
    emit(captured, `${LSP_PROGRESS_EVENT_PREFIX}${PROJECT}`, {
      languageId: LANG,
      token: 'validate-short',
      kind: 'begin',
    });

    // 后端短任务 end 先推 session ready：open token 非空时不得覆盖 busy。
    emit(captured, `lsp-session-${PROJECT}`, { languageId: LANG, status: 'ready' });
    expect(useLspStore.getState().sessions[PROJECT]?.[LANG]?.status).toBe('indexing');

    emit(captured, `${LSP_PROGRESS_EVENT_PREFIX}${PROJECT}`, {
      languageId: LANG,
      token: 'validate-short',
      kind: 'end',
    });
    expect(useLspStore.getState().progressTokens[PROJECT]?.[LANG]).toEqual(['import-long']);
    expect(useLspStore.getState().sessions[PROJECT]?.[LANG]?.status).toBe('indexing');

    emit(captured, `${LSP_PROGRESS_EVENT_PREFIX}${PROJECT}`, {
      languageId: LANG,
      token: 'import-long',
      kind: 'end',
    });
    expect(useLspStore.getState().progressTokens[PROJECT]?.[LANG]).toEqual([]);
    expect(useLspStore.getState().sessions[PROJECT]?.[LANG]?.status).toBe('ready');
    unlisten();
  });

  it('starting 到达即清空该语言残留 token', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    useLspStore.getState().addProgressToken(PROJECT, LANG, 'stale-token');

    emit(captured, `lsp-session-${PROJECT}`, { languageId: LANG, status: 'starting' });

    expect(useLspStore.getState().progressTokens[PROJECT]?.[LANG]).toEqual([]);
    expect(useLspStore.getState().sessions[PROJECT]?.[LANG]?.status).toBe('starting');
    unlisten();
  });

  it('report 更新 progressPct', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    useLspStore.getState().setSessionState(PROJECT, LANG, { status: 'indexing' });

    emit(captured, `${LSP_PROGRESS_EVENT_PREFIX}${PROJECT}`, {
      languageId: LANG,
      token: 'import-1',
      kind: 'report',
      percentage: 42,
    });

    expect(useLspStore.getState().sessions[PROJECT]?.[LANG]?.progressPct).toBe(42);
    unlisten();
  });

  it('unsubscribe 一并注销 progress 监听', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    // session + progress + profile + diagnostics 四路订阅
    expect(captured.has(`lsp-session-${PROJECT}`)).toBe(true);
    expect(captured.has(`${LSP_PROGRESS_EVENT_PREFIX}${PROJECT}`)).toBe(true);
    expect(captured.has(LSP_PROFILE_EVENT)).toBe(true);
    expect(captured.has(`${LSP_DIAG_EVENT_PREFIX}${PROJECT}`)).toBe(true);

    unlisten();
    // safeUnlisten 同步调用 unlisten（promise 化重试在后台）
    await Promise.resolve();
    expect(unlistens).toHaveLength(4);
    for (const fn of unlistens) expect(fn).toHaveBeenCalledTimes(1);
  });
});

/**
 * 诊断切片（design.md D3 单写点）：lspStore 直采 `lsp-diagnostics-{projectPath}`
 * 事件建立 uri 键控状态；CM squiggle 走 lsp-client 独立消费同一事件流，互不转发。
 * publishDiagnostics 语义 = 整体替换该 uri 的诊断（非合并）。
 */
describe('lspStore diagnostics slice (D3 single write point)', () => {
  let captured: Map<string, Handler>;
  let unlistens: Mock[];

  /** 构造一条最小合法诊断（LSP 行号 0-based）。 */
  function diag(line: number, severity: number | null = 1, message = 'boom'): LspDiagnostic {
    return {
      range: { start: { line, character: 0 }, end: { line, character: 4 } },
      severity,
      message,
      source: 'test-ls',
    };
  }

  beforeEach(() => {
    captured = new Map();
    unlistens = [];
    vi.mocked(listen).mockImplementation(((eventName: string, handler: Handler) => {
      captured.set(eventName, handler);
      // unlisten 语义对齐真实 Tauri：反注册后事件不再投递到 handler
      const unlisten = vi.fn(() => {
        captured.delete(eventName);
      });
      unlistens.push(unlisten);
      return Promise.resolve(unlisten);
    }) as typeof listen);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useLspStore.setState({
      sessions: {},
      progressTokens: {},
      diagnosticsByProject: {},
      problemsPanelOpen: false,
    });
  });

  afterEach(() => {
    vi.mocked(console.warn).mockRestore();
  });

  it('setProjectDiagnostics replaces the uri slice wholesale (publishDiagnostics semantics)', () => {
    const { setProjectDiagnostics } = useLspStore.getState();
    setProjectDiagnostics(PROJECT, 'file:///a.ts', [diag(0), diag(1)]);
    setProjectDiagnostics(PROJECT, 'file:///b.ts', [diag(2)]);
    expect(useLspStore.getState().diagnosticsByProject[PROJECT]['file:///a.ts']).toHaveLength(2);

    // 同 uri 二次推送 → 整体替换，不是合并追加
    setProjectDiagnostics(PROJECT, 'file:///a.ts', [diag(9, 2, 'fresh')]);
    const byUri = useLspStore.getState().diagnosticsByProject[PROJECT];
    expect(byUri['file:///a.ts']).toEqual([diag(9, 2, 'fresh')]);
    // 其他 uri 不受影响
    expect(byUri['file:///b.ts']).toHaveLength(1);
  });

  it('empty diagnostics array clears the uri entry (empty replace)', () => {
    const { setProjectDiagnostics } = useLspStore.getState();
    setProjectDiagnostics(PROJECT, 'file:///a.ts', [diag(0)]);
    setProjectDiagnostics(PROJECT, 'file:///a.ts', []);
    expect(useLspStore.getState().diagnosticsByProject[PROJECT]['file:///a.ts']).toEqual([]);
  });

  it('diagnostics stay isolated across projects', () => {
    const { setProjectDiagnostics } = useLspStore.getState();
    setProjectDiagnostics('/p1', 'file:///x.rs', [diag(0)]);
    setProjectDiagnostics('/p2', 'file:///x.rs', [diag(1)]);
    // p1 再推 → 只动 p1 键，p2 原样（#14 同类门控：跨项目不串）
    setProjectDiagnostics('/p1', 'file:///x.rs', [diag(2), diag(3)]);
    expect(useLspStore.getState().diagnosticsByProject['/p1']['file:///x.rs']).toHaveLength(2);
    expect(useLspStore.getState().diagnosticsByProject['/p2']['file:///x.rs']).toHaveLength(1);
  });

  it('subscribeToProject feeds diagnostics events into the slice (whole replacement)', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, {
      uri: 'file:///a.go',
      diagnostics: [diag(0)],
    });
    // 同 uri 第二次推送 → 替换为最新（两条），证明订阅链路直写切片
    emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, {
      uri: 'file:///a.go',
      diagnostics: [diag(1), diag(2)],
    });
    expect(useLspStore.getState().diagnosticsByProject[PROJECT]['file:///a.go']).toHaveLength(2);
    unlisten();
  });

  it('malformed diagnostics payloads are discarded with a warning (parse tolerance)', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    // 先落一条合法事件作为基线
    emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, {
      uri: 'file:///ok.go',
      diagnostics: [diag(0)],
    });
    const before = useLspStore.getState().diagnosticsByProject[PROJECT];

    // 三种损坏形态：payload 非 null 缺 uri / diagnostics 非数组 / payload 为 null
    emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, { diagnostics: [diag(1)] });
    emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, {
      uri: 'file:///x.go',
      diagnostics: 'nope',
    });
    emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, null);

    // 单事件损坏不污染状态：基线原样
    expect(useLspStore.getState().diagnosticsByProject[PROJECT]).toBe(before);
    expect(console.warn).toHaveBeenCalledTimes(3);
    unlisten();
  });

  it('session stopped clears the project diagnostics; other statuses do not', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    useLspStore.getState().setProjectDiagnostics(PROJECT, 'file:///a.go', [diag(0)]);

    emit(captured, `lsp-session-${PROJECT}`, { languageId: 'go', status: 'ready' });
    expect(useLspStore.getState().diagnosticsByProject[PROJECT]).toBeDefined();

    // 会话结束（stopped = 后端进程退出/关闭的终态）→ projectPath 键整体清除
    emit(captured, `lsp-session-${PROJECT}`, { languageId: 'go', status: 'stopped' });
    expect(useLspStore.getState().diagnosticsByProject[PROJECT]).toBeUndefined();
    unlisten();
  });

  it('diagnostics stop flowing after unsubscribe (register/release symmetric)', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    unlisten();
    await Promise.resolve();

    emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, {
      uri: 'file:///a.go',
      diagnostics: [diag(0)],
    });
    expect(useLspStore.getState().diagnosticsByProject[PROJECT]).toBeUndefined();
  });
});
