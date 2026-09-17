// @vitest-environment node
import { listen } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { LSP_PROGRESS_EVENT_PREFIX, LSP_PROFILE_EVENT } from '@/shared/events';

import { useLspStore } from '../lspStore';

type Handler = (event: { payload: Record<string, unknown> }) => void;

const PROJECT = '/tmp/neeko';
const LANG = 'java';
function emit(captured: Map<string, Handler>, eventName: string, payload: Record<string, unknown>) {
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
    // session + progress + profile 三路订阅
    expect(captured.has(`lsp-session-${PROJECT}`)).toBe(true);
    expect(captured.has(`${LSP_PROGRESS_EVENT_PREFIX}${PROJECT}`)).toBe(true);
    expect(captured.has(LSP_PROFILE_EVENT)).toBe(true);

    unlisten();
    // safeUnlisten 同步调用 unlisten（promise 化重试在后台）
    await Promise.resolve();
    expect(unlistens).toHaveLength(3);
    for (const fn of unlistens) expect(fn).toHaveBeenCalledTimes(1);
  });
});
