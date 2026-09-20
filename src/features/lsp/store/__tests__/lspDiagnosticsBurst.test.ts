// @vitest-environment node
import { listen } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LSP_DIAG_EVENT_PREFIX, LSP_SESSION_EVENT_PREFIX } from '@/shared/events';

import type { LspDiagnostic } from '../../types';
import { useLspStore } from '../lspStore';

type Handler = (event: { payload: Record<string, unknown> }) => void;

const PROJECT = '/tmp/neeko-burst';

function diag(line: number, message = 'boom'): LspDiagnostic {
  return {
    range: { start: { line, character: 0 }, end: { line, character: 4 } },
    severity: 1,
    message,
    source: 'test-ls',
  };
}

function emit(
  captured: Map<string, Handler>,
  eventName: string,
  payload: Record<string, unknown> | null,
) {
  captured.get(eventName)?.({ payload });
}

function flushDiagBatch(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('lspStore diagnostics burst coalescing (P1)', () => {
  let captured: Map<string, Handler>;

  beforeEach(() => {
    captured = new Map();
    vi.mocked(listen).mockImplementation(((eventName: string, handler: Handler) => {
      captured.set(eventName, handler);
      const unlisten = vi.fn(() => {
        captured.delete(eventName);
      });
      return Promise.resolve(unlisten);
    }) as typeof listen);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    useLspStore.setState({ sessions: {}, progressTokens: {}, diagnosticsByProject: {} });
  });

  it('200 个 uri 突发 publish → 订阅通知 ≤ 3 且数据完整', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    let notifications = 0;
    const unsubCount = useLspStore.subscribe(() => {
      notifications += 1;
    });

    const N = 200;
    for (let i = 0; i < N; i += 1) {
      emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, {
        uri: `file:///burst/file${i}.java`,
        diagnostics: [diag(i, `diag-${i}`)],
      });
    }
    await flushDiagBatch();

    const byUri = useLspStore.getState().diagnosticsByProject[PROJECT] ?? {};
    expect(Object.keys(byUri)).toHaveLength(N);
    expect(byUri['file:///burst/file0.java']).toEqual([diag(0, 'diag-0')]);
    expect(notifications).toBeLessThanOrEqual(3);

    unsubCount();
    unlisten();
  });

  it('同 uri 在突发内多次推送 → flush 后整体替换为最后一次', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, {
      uri: 'file:///burst/dup.java',
      diagnostics: [diag(0, 'first')],
    });
    emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, {
      uri: 'file:///burst/dup.java',
      diagnostics: [diag(1, 'second'), diag(2, 'third')],
    });
    await flushDiagBatch();

    expect(useLspStore.getState().diagnosticsByProject[PROJECT]['file:///burst/dup.java']).toEqual([
      diag(1, 'second'),
      diag(2, 'third'),
    ]);
    unlisten();
  });

  it('卸载时同步 flush 残留突发（防丢尾）', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    // 发射后不等待 microtask，立即卸载 → 卸载兜底必须同步落库，否则尾部诊断丢失
    emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, {
      uri: 'file:///burst/tail.java',
      diagnostics: [diag(7, 'tail diag')],
    });
    unlisten();

    expect(useLspStore.getState().diagnosticsByProject[PROJECT]['file:///burst/tail.java']).toEqual(
      [diag(7, 'tail diag')],
    );
  });

  it('会话边界清缓冲：旧会话待 flush 诊断不写回', async () => {
    const unlisten = await useLspStore.getState().subscribeToProject(PROJECT);
    // 旧会话诊断进入待 flush 缓冲（未到 microtask）
    emit(captured, `${LSP_DIAG_EVENT_PREFIX}${PROJECT}`, {
      uri: 'file:///burst/stale.java',
      diagnostics: [diag(0, 'stale')],
    });
    // 新会话起点（starting）→ 缓冲丢弃 + projectPath 键清除
    emit(captured, `${LSP_SESSION_EVENT_PREFIX}${PROJECT}`, {
      languageId: 'java',
      status: 'starting',
    });
    // 等 flush：陈旧诊断不得被 microtask 写回
    await flushDiagBatch();

    const byUri = useLspStore.getState().diagnosticsByProject[PROJECT];
    expect(byUri?.['file:///burst/stale.java']).toBeUndefined();
    unlisten();
  });
});
