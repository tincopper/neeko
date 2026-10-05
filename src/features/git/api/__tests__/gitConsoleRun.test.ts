import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gitConsoleSessionId, useTaskStore } from '@/shared/store/taskStore';

import { beginGitConsoleRun, GIT_BUSY_MESSAGE, runGitConsoleOp } from '../gitConsoleRun';

// 与 Rust `common/git/transport/cancel.rs::BUSY_MESSAGE` 对齐；两端的值都有 pin 测试。
const RUST_BUSY_MESSAGE = 'Another git operation is already in progress for this repository';

describe('GIT_BUSY_MESSAGE', () => {
  it('与后端 BUSY_MESSAGE 保持同文案（跨语言 pin）', () => {
    expect(GIT_BUSY_MESSAGE).toBe(RUST_BUSY_MESSAGE);
  });
});

// 只 mock、不消费实现：`taskStore` 经此拿 cancelGitSync（import/no-restricted-paths）。
vi.mock('@/features/git/api/gitApi', () => ({
  cancelGitSync: vi.fn().mockResolvedValue(undefined),
}));

const ARGS = { projectId: 'p1', projectPath: '/repo/main', header: 'git push' };
const RUN_ID = gitConsoleSessionId('/repo/main');

function gitRun() {
  return useTaskStore.getState().consoleSessions.find((s) => s.id === RUN_ID);
}

describe('runGitConsoleOp', () => {
  beforeEach(() => {
    useTaskStore.setState({ consoleSessions: [], activeConsoleId: null, consolePanelOpen: false });
  });

  it('runs the op with the repo runId and finishes ok', async () => {
    const run = vi.fn().mockResolvedValue('done');

    const result = await runGitConsoleOp({ ...ARGS, run });

    expect(result).toEqual({ status: 'ok', value: 'done' });
    expect(run).toHaveBeenCalledWith(RUN_ID);
    expect(gitRun()?.status).toBe('idle');
  });

  it('refuses to start when the repo tab is already running (no clobber)', async () => {
    useTaskStore.getState().openGitConsole(ARGS);
    const run = vi.fn();

    const result = await runGitConsoleOp({ ...ARGS, run });

    expect(result).toEqual({ status: 'busy' });
    expect(run).not.toHaveBeenCalled();
    // 既有 run 的 header 不被新命令覆盖（仍只有一行 `$ git push`）
    const output = gitRun()?.output ?? '';
    expect(output.split('$ git push').length - 1).toBe(1);
  });

  it('returns stopped and leaves a [Stopped] tail when the user cancelled', async () => {
    let reject!: (reason: unknown) => void;
    const run = vi.fn(
      () =>
        new Promise<string>((_resolve, rej) => {
          reject = rej;
        }),
    );

    const pending = runGitConsoleOp({ ...ARGS, run });
    await Promise.resolve();
    await useTaskStore.getState().cancelGitConsole(RUN_ID);
    reject(new Error('git command cancelled'));

    expect(await pending).toEqual({ status: 'stopped' });
    expect(gitRun()?.status).toBe('idle');
    expect(gitRun()?.output).toContain('[Stopped]');
  });

  it('marks auth-required runs without failing', async () => {
    const result = await runGitConsoleOp({
      ...ARGS,
      run: async () => ({ AuthRequired: {} }),
      isAuthRequired: (o) => 'AuthRequired' in o,
    });

    expect(result.status).toBe('ok');
    expect(gitRun()?.status).toBe('idle');
    expect(gitRun()?.output).toContain('[authentication required]');
  });

  it('beginGitConsoleRun returns null when the repo is busy', () => {
    useTaskStore.getState().openGitConsole(ARGS);
    expect(beginGitConsoleRun(ARGS.projectId, ARGS.projectPath, 'git fetch')).toBeNull();
  });

  it('treats stopping runs as busy (no takeover before the old run settles)', async () => {
    let reject!: (reason: unknown) => void;
    const first = vi.fn(
      () =>
        new Promise<string>((_resolve, rej) => {
          reject = rej;
        }),
    );
    const pending = runGitConsoleOp({ ...ARGS, run: first });
    await Promise.resolve();
    await useTaskStore.getState().cancelGitConsole(RUN_ID); // → stopping

    const secondRun = vi.fn();
    expect(await runGitConsoleOp({ ...ARGS, run: secondRun })).toEqual({ status: 'busy' });
    expect(secondRun).not.toHaveBeenCalled();

    reject(new Error('git command cancelled'));
    expect(await pending).toEqual({ status: 'stopped' });
  });
});
