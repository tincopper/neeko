// @vitest-environment node
/**
 * `create_terminal_session` 的跨栈参数契约：纯 shell 恢复时要带上旧 sessionId，
 * 后端据此读净化日志并在建 PTY 阶段把回放字节推进 drain。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { createTerminalSession } from '../terminalApi';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const WORKSPACE = WorkspaceSession.of('p1', null);

async function invokeMock() {
  const { invoke } = await import('@tauri-apps/api/core');
  return vi.mocked(invoke);
}

describe('createTerminalSession — resumeFrom', () => {
  beforeEach(async () => {
    const invoke = await invokeMock();
    invoke.mockReset();
    invoke.mockResolvedValue({ id: 'new-id' });
  });

  it('新建会话不带 resumeFrom ⇒ 传给后端的仍是 null', async () => {
    await createTerminalSession(WORKSPACE, 80, 24, { agentId: null });
    const invoke = await invokeMock();
    expect(invoke).toHaveBeenCalledWith(
      'create_terminal_session',
      expect.objectContaining({ resumeFrom: null, agentId: null }),
    );
  });

  it('纯 shell 恢复 ⇒ resumeFrom 透传旧 sessionId', async () => {
    await createTerminalSession(WORKSPACE, 80, 24, {
      agentId: null,
      resumeFrom: 'old-session-id',
    });
    const invoke = await invokeMock();
    expect(invoke).toHaveBeenCalledWith(
      'create_terminal_session',
      expect.objectContaining({ resumeFrom: 'old-session-id' }),
    );
  });

  it('其余既有参数不被新字段顶掉', async () => {
    await createTerminalSession(WORKSPACE, 100, 30, {
      shell: '/bin/zsh',
      workingDir: 'src',
      command: 'echo hi',
      agentId: null,
      resumeFrom: 'old',
    });
    const invoke = await invokeMock();
    const [, payload] = vi.mocked(invoke).mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(payload).toMatchObject({
      cols: 100,
      rows: 30,
      shell: '/bin/zsh',
      workingDir: 'src',
      command: 'echo hi',
      agentId: null,
      resumeFrom: 'old',
    });
  });
});
