import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SequencedEvent } from '@/shared/types/agentChat';

import { useTranslationStore } from '../../translation/store';
import TranslationView from '../TranslationView';

// ── mock 基础设施 ────────────────────────────────────────────────────────
type EventHandler = (event: { payload: SequencedEvent[] | SequencedEvent }) => void;
const eventHandlers: EventHandler[] = [];
const invokeCalls: Array<{ cmd: string; args: unknown }> = [];

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, handler: EventHandler) => {
    eventHandlers.push(handler);
    return () => {};
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args?: unknown) => {
    invokeCalls.push({ cmd, args });
    if (cmd === 'translation_stream') return 'tr_test_1';
    if (cmd === 'list_agent_models') return [];
    return undefined;
  }),
}));

vi.mock('@/shared/contexts', () => ({
  useEditorContext: () => ({
    agents: [{ id: 'opencode', name: 'OpenCode', enabled: true, icon: '' }],
  }),
}));

vi.mock('@/shared/contexts/AppContext', () => ({
  useAppContext: () => ({ config: {} }),
}));

function emitEvents(events: SequencedEvent[]) {
  act(() => {
    for (const handler of eventHandlers) handler({ payload: events });
  });
}

const seq = (n: number, ev: Record<string, unknown>) =>
  ({ seq: n, session_id: 'tr_test_1', ...ev }) as SequencedEvent;

const params = {
  filePath: 'README.md',
  content: 'Hello world.\n\nSecond paragraph.',
  projectId: 'p1',
  enabled: true,
};

const renderView = () => render(<TranslationView {...params} />);

beforeEach(() => {
  eventHandlers.length = 0;
  invokeCalls.length = 0;
  useTranslationStore.getState().clear('p1:README.md');
});

afterEach(() => {
  useTranslationStore.getState().clear('p1:README.md');
  vi.clearAllMocks();
});

describe('TranslationView — AI 译文视图', () => {
  it('进入视图不自动翻译；点击 Translate 后发起并回填译文', async () => {
    renderView();

    // 选择阶段：不发翻译请求，正文显示原文
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Translate' })).toBeInTheDocument();
    });
    expect(invokeCalls.some((c) => c.cmd === 'translation_stream')).toBe(false);
    expect(screen.getByText('Hello world.')).toBeInTheDocument();

    // 点击 Translate → 发起
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => {
      expect(invokeCalls.some((c) => c.cmd === 'translation_stream')).toBe(true);
    });
    const req = (
      invokeCalls.find((c) => c.cmd === 'translation_stream')?.args as { req: { prompt: string } }
    ).req;
    expect(req.prompt).toContain('[0] Hello world.');
    expect(req.prompt).toContain('[1] Second paragraph.');

    emitEvents([
      seq(1, { type: 'text_delta', delta: '["你好", ' }),
      seq(2, { type: 'text_delta', delta: '"世界"]' }),
      seq(3, { type: 'turn_end', turn_id: 't1', reason: 'completed' }),
    ]);

    await waitFor(() => {
      expect(screen.getAllByText('你好').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('世界').length).toBeGreaterThan(0);
    // 原文 + 译文都在（双语对照）
    expect(screen.getByText('Hello world.')).toBeInTheDocument();
    // 完成后出现重新翻译入口
    expect(screen.getByRole('button', { name: '重新翻译' })).toBeInTheDocument();
  });

  it('turn 失败 → 段落标记失败并出现重试按钮，点击重发翻译', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

    await waitFor(() => {
      expect(invokeCalls.some((c) => c.cmd === 'translation_stream')).toBe(true);
    });
    emitEvents([seq(1, { type: 'error', kind: 'agent', code: 'E1', message: 'boom' })]);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /^Retry b/ }).length).toBe(2);
    });

    fireEvent.click(screen.getAllByRole('button', { name: /^Retry b/ })[0]);
    await waitFor(() => {
      expect(invokeCalls.filter((c) => c.cmd === 'translation_stream')).toHaveLength(2);
    });
  });

  it('running 时显示停止按钮', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => {
      expect(invokeCalls.some((c) => c.cmd === 'translation_stream')).toBe(true);
    });
    expect(screen.getByRole('button', { name: '停止翻译' })).toBeInTheDocument();
  });
});
