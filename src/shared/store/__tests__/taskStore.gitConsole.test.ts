import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gitConsoleSessionId, useTaskStore } from '../taskStore';

// 只 mock、不导入（import/no-restricted-paths：shared 不得直导 feature 实现）。
// 「store → api.cancelGitSync」这一步的断言在 features/git 侧的 useGitActions.test.ts。
vi.mock('@/features/git/api/gitApi', () => ({
  cancelGitSync: vi.fn().mockResolvedValue(undefined),
}));

const ARGS = { projectId: 'p1', projectPath: '/repo/main', header: 'git push' };

describe('taskStore — Git Console', () => {
  beforeEach(() => {
    useTaskStore.setState({ consoleSessions: [], activeConsoleId: null, consolePanelOpen: false });
  });

  it('opens one stable tab per repo and focuses it', () => {
    const id = useTaskStore.getState().openGitConsole(ARGS);
    expect(id).toBe(gitConsoleSessionId('/repo/main'));

    const state = useTaskStore.getState();
    expect(state.consolePanelOpen).toBe(true);
    expect(state.activeConsoleId).toBe(id);
    const run = state.consoleSessions.find((s) => s.id === id);
    expect(run).toMatchObject({
      source: 'git',
      status: 'running',
      projectId: 'p1',
      projectPath: '/repo/main',
    });
    expect(run?.name).toBe('Git · main');
    expect(run?.output).toContain('$ git push');
  });

  it('reopening appends a header and re-arms running without a second tab', () => {
    const store = useTaskStore.getState();
    const id = store.openGitConsole(ARGS);
    store.finishGitConsole(id, true);
    expect(useTaskStore.getState().consoleSessions.find((s) => s.id === id)?.status).toBe('idle');

    const again = useTaskStore.getState().openGitConsole({ ...ARGS, header: 'git fetch' });
    expect(again).toBe(id);
    const runs = useTaskStore.getState().consoleSessions.filter((s) => s.id === id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('running');
    expect(runs[0].output).toContain('$ git push');
    expect(runs[0].output).toContain('$ git fetch');
  });

  it('appends streamed chunks and marks failure with an exit code', () => {
    const id = useTaskStore.getState().openGitConsole(ARGS);
    useTaskStore.getState().appendGitConsoleOutput(id, 'remote: hello\r\n');
    useTaskStore.getState().finishGitConsole(id, false);

    const run = useTaskStore.getState().consoleSessions.find((s) => s.id === id);
    expect(run?.output).toContain('remote: hello');
    expect(run?.status).toBe('failed');
    expect(run?.exitCode).toBe(1);
    expect(run?.endedAt).not.toBeNull();
  });

  it('out-of-order chunks arrive in call order and truncation stays bounded', () => {
    const id = useTaskStore.getState().openGitConsole(ARGS);
    useTaskStore.getState().appendGitConsoleOutput(id, 'first ');
    useTaskStore.getState().appendGitConsoleOutput(id, 'second');
    const run = useTaskStore.getState().consoleSessions.find((s) => s.id === id);
    expect(run?.output).toContain('first second');
  });

  it('append/finish on a closed tab is a harmless no-op', () => {
    const id = useTaskStore.getState().openGitConsole(ARGS);
    useTaskStore.getState().closeConsoleSession(id);
    expect(() => {
      useTaskStore.getState().appendGitConsoleOutput(id, 'x');
      useTaskStore.getState().finishGitConsole(id, true);
    }).not.toThrow();
    expect(useTaskStore.getState().consoleSessions).toHaveLength(0);
  });

  it('two repos get two independent tabs', () => {
    const a = useTaskStore.getState().openGitConsole(ARGS);
    const b = useTaskStore.getState().openGitConsole({
      ...ARGS,
      projectPath: '/repo/other',
    });
    expect(a).not.toBe(b);
    expect(useTaskStore.getState().consoleSessions).toHaveLength(2);
  });

  it('cancelGitConsole marks the run stopping (backend cancel fired best-effort)', async () => {
    const id = useTaskStore.getState().openGitConsole(ARGS);
    await useTaskStore.getState().cancelGitConsole(id);

    expect(useTaskStore.getState().consoleSessions.find((s) => s.id === id)?.status).toBe(
      'stopping',
    );
  });

  it('cancelGitConsole leaves non-running runs untouched', async () => {
    const id = useTaskStore.getState().openGitConsole(ARGS);
    useTaskStore.getState().finishGitConsole(id, true);
    await useTaskStore.getState().cancelGitConsole(id);

    expect(useTaskStore.getState().consoleSessions.find((s) => s.id === id)?.status).toBe('idle');
  });
});
