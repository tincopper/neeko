import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/live-sessions/api/liveSessionsApi', () => ({
  reportLiveSessionActivity: vi.fn(() => Promise.resolve(true)),
  renameLiveSessionTitle: vi.fn(() => Promise.resolve(true)),
}));

import {
  renameLiveSessionTitle,
  reportLiveSessionActivity,
} from '@/features/live-sessions/api/liveSessionsApi';

import { installTerminalReporting } from '../sessionTitleReporter';

function setup(sessionId: string | null = 'pty-1') {
  vi.mocked(reportLiveSessionActivity).mockClear();
  vi.mocked(renameLiveSessionTitle).mockClear();
  return installTerminalReporting({ getSessionId: () => sessionId });
}

describe('installTerminalReporting — 终端 I/O 不是标题源', () => {
  /**
   * 事故形态：用户在 `/model` 面板里敲过滤词 `deep`，CLI 把它反射到 OSC 标题栏。
   * 旧实现把 `/model`、`deep` 当 `Prompt` 素材、把 OSC `deep` 当 `Native` 素材，
   * 三次写入标题 IPC ⇒ 侧栏会话名变成 `deep`。
   *
   * 现在只有一条上行通道：活动 + 行文本。行文本能否命名由后端
   * `Registry::report_terminal_input` 按 `agent_id` 裁决（前端一份判据都没有）。
   */
  it('/model → deep 只上报活动，不触发任何改名 IPC', () => {
    const reporting = setup();

    reporting.reportUserInput('/model\r');
    reporting.reportUserInput('deep\r');

    expect(renameLiveSessionTitle).not.toHaveBeenCalled();
    expect(reportLiveSessionActivity).toHaveBeenCalledTimes(2);
    expect(reportLiveSessionActivity).toHaveBeenNthCalledWith(1, 'pty-1', '/model');
    expect(reportLiveSessionActivity).toHaveBeenNthCalledWith(2, 'pty-1', 'deep');
  });

  /**
   * 契约钉子：本模块**不接收** xterm 实例，因此结构上不可能订阅 `onTitleChange`。
   *
   * 旧实现在这里收 `term` 并订阅 OSC；用 `@ts-expect-error` 钉住「这个参数已不存在」——
   * 一旦有人把 `term` 加回签名（那是 OSC 通道复活的唯一入口），本行就会变成
   * 「未使用 @ts-expect-error」错误。
   */
  it('不接收 term：OSC 订阅在类型层就已不存在', () => {
    const reporting = installTerminalReporting({
      getSessionId: () => 'pty-1',
      // @ts-expect-error -- 终端 I/O 不是标题源，本模块不接受 xterm 实例
      term: { onTitleChange: () => ({ dispose: () => undefined }) },
    });

    expect(Object.keys(reporting)).toEqual(['reportUserInput']);
  });

  it('纯 shell 的首条输入行随活动一起上报（后端按 agent_id 决定要不要命名）', () => {
    const reporting = setup();
    reporting.reportUserInput('npm test\r');

    expect(reportLiveSessionActivity).toHaveBeenCalledExactlyOnceWith('pty-1', 'npm test');
    expect(renameLiveSessionTitle).not.toHaveBeenCalled();
  });

  it('会话 id 未就绪 ⇒ 连活动也不上报', () => {
    const reporting = setup(null);
    reporting.reportUserInput('fix the parser\r');

    expect(reportLiveSessionActivity).not.toHaveBeenCalled();
    expect(renameLiveSessionTitle).not.toHaveBeenCalled();
  });
});
