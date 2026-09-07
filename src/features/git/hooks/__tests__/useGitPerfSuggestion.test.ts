import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '@/shared/store/notificationStore';

type ListenCb = (event: { payload: unknown }) => void;

const { listeners } = vi.hoisted(() => ({
  listeners: new Map<string, Array<(event: { payload: unknown }) => void>>(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (eventName: string, cb: ListenCb) => {
    const list = listeners.get(eventName) ?? [];
    list.push(cb);
    listeners.set(eventName, list);
    return Promise.resolve(() => {});
  },
}));

import { useGitPerfSuggestion } from '../useGitPerfSuggestion';

function emit(payload: unknown) {
  for (const cb of listeners.get('git-perf-suggestion') ?? []) {
    cb({ payload });
  }
}

describe('useGitPerfSuggestion — G7 性能引导通知', () => {
  beforeEach(() => {
    listeners.clear();
    useNotificationStore.setState({ notifications: [] });
  });

  it('建议事件转为通知（每条建议一条）', async () => {
    renderHook(() => useGitPerfSuggestion());
    await waitFor(() => expect(listeners.has('git-perf-suggestion')).toBe(true));

    act(() => {
      emit({
        project_id: 'p1',
        suggestions: [
          { kind: 'fsmonitor', command: 'git config core.fsmonitor true', label: 'fsmonitor' },
          { kind: 'untrackedCache', command: 'git config core.untrackedCache true', label: 'uc' },
        ],
      });
    });

    const messages = useNotificationStore.getState().notifications.map((n) => n.message);
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.includes('git config core.fsmonitor true'))).toBe(true);
    expect(messages.some((m) => m.includes('git config core.untrackedCache true'))).toBe(true);
  });

  it('同项目重复事件不重复通知（每会话至多一次）', async () => {
    renderHook(() => useGitPerfSuggestion());
    await waitFor(() => expect(listeners.has('git-perf-suggestion')).toBe(true));

    const payload = {
      project_id: 'p1',
      suggestions: [{ kind: 'fsmonitor', command: 'cmd', label: 'l' }],
    };
    act(() => {
      emit(payload);
      emit(payload);
    });

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });

  it('空建议列表不产生通知', async () => {
    renderHook(() => useGitPerfSuggestion());
    await waitFor(() => expect(listeners.has('git-perf-suggestion')).toBe(true));

    act(() => {
      emit({ project_id: 'p1', suggestions: [] });
    });

    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
