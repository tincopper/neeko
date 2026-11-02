import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/live-sessions/api/liveSessionsApi', () => ({
  setLiveSessionTitle: vi.fn(() => Promise.resolve(true)),
}));

import { createSessionTitleReporter, installTerminalReporting } from '../sessionTitleReporter';

function setup(sessionId: string | null = 'pty-1') {
  const send = vi.fn();
  const reporter = createSessionTitleReporter({ getSessionId: () => sessionId, send });
  return { send, reporter };
}

describe('createSessionTitleReporter', () => {
  it('用户提交之前不上报（CLI 启动就刷 cwd / 品牌名，那不是会话主题）', () => {
    const { send, reporter } = setup();
    reporter.report('/Users/tomgs/RustroverProjects/neeko');
    reporter.report('π');
    expect(send).not.toHaveBeenCalled();
  });

  it('用户提交之后原样上报 —— 判据在后端，前端不过滤', () => {
    const { send, reporter } = setup();
    reporter.markUserInput();
    // 这些形态后端 `title::admit` 会判负；前端仍然上报（双端各一套黑名单必然漂移）。
    reporter.report('π');
    reporter.report('✳ Claude ready');
    expect(send).toHaveBeenNthCalledWith(1, 'pty-1', 'π');
    expect(send).toHaveBeenNthCalledWith(2, 'pty-1', '✳ Claude ready');
  });

  it('与上次上报的原文相同 ⇒ 不发（CLI 每帧重绘都会触发 onTitleChange）', () => {
    const { send, reporter } = setup();
    reporter.markUserInput();
    reporter.report('✳ Fix login bug');
    reporter.report('✳ Fix login bug');
    reporter.report('  ✳ Fix login bug  ');
    expect(send).toHaveBeenCalledTimes(1);
  });

  /**
   * spinner 逐帧只换字形、不换文字 ⇒ 归一后是同一个标题，不重复发 IPC。
   *
   * 回归钉子：逐字比较会把每一帧都当成新标题，用户首次输入之后每秒几次 IPC，
   * 而它们去重后本就是同一句话。
   */
  it('spinner 换字形不算新标题（归一后去重）', () => {
    const { send, reporter } = setup();
    reporter.markUserInput();
    reporter.report('⣋ Fix login bug');
    reporter.report('⣙ Fix login bug');
    reporter.report('⣟ Fix login bug');
    expect(send).toHaveBeenCalledTimes(1);

    // 文字真的变了仍然上报。
    reporter.report('⣿ Fix logout bug');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(2, 'pty-1', '⣿ Fix logout bug');
  });

  it('标题变化时上报（CLI 换了任务）', () => {
    const { send, reporter } = setup();
    reporter.markUserInput();
    reporter.report('✳ Fix login bug');
    reporter.report('✳ Fix logout bug');
    expect(send).toHaveBeenNthCalledWith(2, 'pty-1', '✳ Fix logout bug');
  });

  it('空白标题不是素材 ⇒ 不发，也不污染去重槽位', () => {
    const { send, reporter } = setup();
    reporter.markUserInput();
    reporter.report('   ');
    reporter.report('');
    expect(send).not.toHaveBeenCalled();
    // 去重槽位未被空白占住：真正的标题仍然上报。
    reporter.report('fix the parser');
    expect(send).toHaveBeenCalledWith('pty-1', 'fix the parser');
  });

  it('会话 id 还没就绪（PTY 未创建）⇒ 不上报', () => {
    const { send, reporter } = setup(null);
    reporter.markUserInput();
    reporter.report('fix the parser');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('installTerminalReporting', () => {
  it('输入开闸 ⇒ OSC 标题以 native 上报；用户输入以 prompt 上报；dispose 解绑', async () => {
    const { setLiveSessionTitle } = await import('@/features/live-sessions/api/liveSessionsApi');
    vi.mocked(setLiveSessionTitle).mockClear();
    const dispose = vi.fn();
    let listener: ((title: string) => void) | null = null;
    const reporting = installTerminalReporting({
      term: {
        onTitleChange: (cb) => {
          listener = cb;
          return { dispose };
        },
      },
      getSessionId: () => 'pty-1',
    });

    // 首次提交之前不上报（传输优化 1）。
    listener?.('π');
    expect(setLiveSessionTitle).not.toHaveBeenCalled();

    // 用户提交：既是 `Prompt` 素材，也是 OSC 标题的闸门（按回车才结算一行）。
    reporting.reportUserInput('fix the parser\r');
    expect(setLiveSessionTitle).toHaveBeenCalledWith('pty-1', 'fix the parser', 'prompt');

    listener?.('✳ Fix login bug');
    expect(setLiveSessionTitle).toHaveBeenLastCalledWith('pty-1', '✳ Fix login bug', 'native');

    reporting.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
