import { describe, expect, it, vi } from 'vitest';

import { createTerminalTitleSync, type TitleEventSource } from '../terminalTitle';

/**
 * 假终端：只有 `onTitleChange`（xterm 的 `Terminal` 在 jsdom 里起不来，
 * 而这里要测的判据与真终端无关 —— 是「谁发、发几次」）。
 */
function fakeTerm() {
  const listeners = new Set<(title: string) => void>();
  const term: TitleEventSource = {
    onTitleChange: (listener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  return {
    term,
    emit: (title: string) => {
      for (const listener of [...listeners]) listener(title);
    },
    listenerCount: () => listeners.size,
  };
}

describe('createTerminalTitleSync', () => {
  it('同一值只发一次（xterm 每次 OSC 0/2 都无条件 fire）', () => {
    const { term, emit } = fakeTerm();
    const publish = vi.fn();
    createTerminalTitleSync({ term, getSessionId: () => 'pty-1', publish });

    emit('claude');
    emit('claude');
    emit('claude');

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('pty-1', 'claude');
  });

  it('值变了就发（不设时间窗：关键变化不许被节流吃掉）', () => {
    const { term, emit } = fakeTerm();
    const publish = vi.fn();
    createTerminalTitleSync({ term, getSessionId: () => 'pty-1', publish });

    emit('⠋ claude');
    emit('⠙ claude');
    emit('claude');

    expect(publish.mock.calls).toEqual([
      ['pty-1', '⠋ claude'],
      ['pty-1', '⠙ claude'],
      ['pty-1', 'claude'],
    ]);
  });

  it('归一化后再比较（空白差异不算新标题）', () => {
    const { term, emit } = fakeTerm();
    const publish = vi.fn();
    createTerminalTitleSync({ term, getSessionId: () => 'pty-1', publish });

    emit('  fix   the parser ');
    emit('fix the parser');

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('pty-1', 'fix the parser');
  });

  it('空白标题不发（OSC 复位会用空串覆盖标题）', () => {
    const { term, emit } = fakeTerm();
    const publish = vi.fn();
    createTerminalTitleSync({ term, getSessionId: () => 'pty-1', publish });

    emit('');
    emit('   ');
    emit('\t\n');

    expect(publish).not.toHaveBeenCalled();
  });

  it('会话 id 还没铸造时不发，但也不污染去重基线', () => {
    const { term, emit } = fakeTerm();
    const publish = vi.fn();
    let sessionId: string | null = null;
    createTerminalTitleSync({ term, getSessionId: () => sessionId, publish });

    // PTY 创建前后 CLI 可能已经设过标题：条目不存在的标题被丢弃（后端也不建条目）。
    emit('claude');
    expect(publish).not.toHaveBeenCalled();

    // PTY 建好后同一个值必须补发一次 —— 否则首个标题会被当成「已发过」永久丢掉。
    sessionId = 'pty-1';
    emit('claude');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('pty-1', 'claude');
  });

  it('dispose 后不再发，且释放 xterm 监听（tab 切走时不许残留闭包）', () => {
    const { term, emit, listenerCount } = fakeTerm();
    const publish = vi.fn();
    const sync = createTerminalTitleSync({ term, getSessionId: () => 'pty-1', publish });

    emit('claude');
    sync.dispose();
    expect(listenerCount()).toBe(0);

    emit('claude code');
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('dispose 幂等（终端缓存销毁与 effect cleanup 会各调一次）', () => {
    const { term, listenerCount } = fakeTerm();
    const sync = createTerminalTitleSync({
      term,
      getSessionId: () => 'pty-1',
      publish: vi.fn(),
    });

    sync.dispose();
    expect(() => sync.dispose()).not.toThrow();
    expect(listenerCount()).toBe(0);
  });
});
