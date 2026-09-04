import { emit } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { terminalInputEvent } from '@/shared/utils/terminalEvents';

const { closeSessionMock, getAgentMock } = vi.hoisted(() => ({
  closeSessionMock: vi.fn().mockResolvedValue(undefined),
  getAgentMock: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../api/terminalApi', () => ({
  closeTerminalSession: closeSessionMock,
  resizeTerminal: vi.fn(),
}));

vi.mock('../../../agent/api/agentApi', () => ({
  getAgent: getAgentMock,
}));

import { terminalCache } from '../terminalCache';
import { pasteToTerminal, wrapBracketedPaste } from '../terminalCommands';

const mockEmit = vi.mocked(emit);

const START = '\x1b[200~';
const END = '\x1b[201~';

describe('pasteToTerminal', () => {
  beforeEach(() => {
    terminalCache.clear();
    mockEmit.mockClear();
  });

  it('bracketed 包裹：首尾标记夹住原文', () => {
    expect(wrapBracketedPaste('hi')).toBe(`${START}hi${END}`);
  });

  it('命中会话时整段 emit bracketed 字节并返回 true', () => {
    terminalCache.set('proj1:p1', { sessionId: 's1' } as never);
    expect(pasteToTerminal('proj1', 'echo hi')).toBe(true);
    const expected = Array.from(new TextEncoder().encode(`${START}echo hi${END}`));
    expect(mockEmit).toHaveBeenCalledWith(terminalInputEvent('s1'), expected);
  });

  it('无匹配会话时不 emit 并返回 false', () => {
    expect(pasteToTerminal('missing', 'hi')).toBe(false);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('tabId 精确命中优先', () => {
    terminalCache.set('proj1:p1', { sessionId: 's-other' } as never);
    terminalCache.set('proj1:tabA:p1', { sessionId: 's-tab' } as never);
    expect(pasteToTerminal('proj1', 'hi', 'tabA')).toBe(true);
    expect(mockEmit).toHaveBeenCalledWith(terminalInputEvent('s-tab'), expect.anything());
  });

  it('多行 content 整段进入缓冲：不补回车，零行被执行', () => {
    terminalCache.set('proj1', { sessionId: 's1' } as never);
    pasteToTerminal('proj1', 'line1\nline2');
    const bytes: number[] = mockEmit.mock.calls[0][1] as number[];
    const text = new TextDecoder().decode(new Uint8Array(bytes));
    expect(text).toBe(`${START}line1\nline2${END}`);
    expect(text.endsWith('\r')).toBe(false);
  });
});
