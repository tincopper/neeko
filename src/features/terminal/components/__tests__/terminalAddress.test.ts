// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import {
  TERMINAL_KEY_SEP,
  decodeTerminalKey,
  terminalAddress,
  terminalAddressPrefix,
  terminalAddressPrefixOfTab,
  terminalKeyLabel,
} from '../terminalAddress';
import {
  destroyTerminalsForSession,
  destroyTerminalsForTab,
  refreshTerminalForSession,
  resolveTerminalEntry,
  resolveTerminalEntryOfTab,
  terminalCache,
  wslTerminalCache,
} from '../terminalCache';

function makeEntry(sessionId: string | null): never {
  return {
    sessionId,
    term: { dispose: vi.fn() },
    unlisten: null,
    unlistenOutput: null,
    unlistenClosed: null,
    inputController: null,
  } as never;
}

afterEach(() => {
  terminalCache.clear();
  wslTerminalCache.clear();
  closeSessionMock.mockClear();
});

describe('terminalAddress (mint)', () => {
  it('golden：主仓 = <projectId>\\0 + SEP + tabId + SEP + paneId', () => {
    const session = WorkspaceSession.of('proj1', null);
    expect(terminalAddress(session, 'tabA')).toBe(
      `proj1\u0000${TERMINAL_KEY_SEP}tabA${TERMINAL_KEY_SEP}p1`,
    );
  });

  it('显式 paneId 生效；主仓与 worktree 键不同且稳定', () => {
    const main = WorkspaceSession.of('proj1', null);
    const wt = WorkspaceSession.of('proj1', '/wt/a');
    const a = terminalAddress(main, 'tabA', 'p2');
    const b = terminalAddress(wt, 'tabA', 'p2');
    expect(a).not.toBe(b);
    expect(terminalAddress(main, 'tabA', 'p2')).toBe(a);
  });

  it('前缀以整串 session.key + SEP 结尾（非分段匹配）', () => {
    const session = WorkspaceSession.of('proj1', '/wt/a');
    expect(terminalAddressPrefix(session)).toBe(`${session.key}${TERMINAL_KEY_SEP}`);
    expect(terminalAddressPrefixOfTab(session, 'tabA')).toBe(
      `${terminalAddressPrefix(session)}tabA${TERMINAL_KEY_SEP}`,
    );
  });
});

describe('decodeTerminalKey (唯一 codec)', () => {
  it('往返：分量逐字还原', () => {
    const session = WorkspaceSession.of('proj1', '/wt/a');
    const key = terminalAddress(session, 'proj:src/a.ts', 'p2');
    const decoded = decodeTerminalKey(key);
    expect(decoded).not.toBeNull();
    expect(decoded!.session.key).toBe(session.key);
    expect(decoded!.tabId).toBe('proj:src/a.ts');
    expect(decoded!.paneId).toBe('p2');
  });

  it('负例：WorkspaceSession.fromKey 不可复用（会把 tabId:paneId 当 worktreePath）', () => {
    const session = WorkspaceSession.of('proj1', null);
    const key = terminalAddress(session, 'tabA', 'p1');
    const forged = WorkspaceSession.fromKey(key);
    expect(forged).not.toBeNull();
    expect(forged!.worktreePath).not.toBeNull();
    expect(forged!.key).not.toBe(session.key);
  });

  it('非法键返回 null', () => {
    expect(decodeTerminalKey('proj1:p1')).toBeNull();
    expect(
      decodeTerminalKey(`${WorkspaceSession.of('p', null).key}${TERMINAL_KEY_SEP}`),
    ).toBeNull();
  });
});

describe('前缀精确性', () => {
  it('嵌套 worktree：/wt/a 的前缀不匹配 /wt/a-b 的键', () => {
    const a = WorkspaceSession.of('P', '/wt/a');
    const b = WorkspaceSession.of('P', '/wt/a-b');
    const prefixA = terminalAddressPrefix(a);
    expect(terminalAddress(b, 'tabA').startsWith(prefixA)).toBe(false);
    expect(terminalAddress(a, 'tabA').startsWith(prefixA)).toBe(true);
  });

  it('tab 前缀与含 `:` 的 tabId 不歧义', () => {
    const session = WorkspaceSession.of('P', null);
    const tabA = terminalAddressPrefixOfTab(session, 'A');
    expect(terminalAddress(session, 'A', 'p1').startsWith(tabA)).toBe(true);
    // tabId 本身是 `A:p1`、pane=p2 —— 不得被 `A` 的 tab 前缀误命中
    expect(terminalAddress(session, 'A:p1', 'p2').startsWith(tabA)).toBe(false);
  });
});

describe('terminalKeyLabel', () => {
  it('可读标签不含 NUL / SEP，且保留 tab 分量', () => {
    const session = WorkspaceSession.of('proj1', '/wt/a');
    const label = terminalKeyLabel(terminalAddress(session, 'tabA', 'p1'));
    expect(label).not.toContain('\u0000');
    expect(label).not.toContain(TERMINAL_KEY_SEP);
    expect(label).toContain('tabA');
    expect(label).toContain('/wt/a');
  });
});

/**
 * 精确键 resolve：`paneId` **必填**（无默认值）。曾经的默认值 `'p1'` 是 2026-11
 * 「拖文件到终端什么都没发生」事故的根因 —— paneId 是渲染方才有的知识，猜一个默认值在
 * 终端不在第一个 pane（右侧 dock / 分屏）时恒 miss，调用方只拿到一个静默的 false。
 */
describe('resolveTerminalEntry（精确键，paneId 必填）', () => {
  const session = WorkspaceSession.of('proj1', null);

  it('精确命中；miss 返回 null', () => {
    terminalCache.set(terminalAddress(session, 'tabA', 'p1'), makeEntry('s1'));
    expect(resolveTerminalEntry(session, 'tabA', 'p1')?.sessionId).toBe('s1');
    expect(resolveTerminalEntry(session, 'missing', 'p1')).toBeNull();
  });

  it('地址层不读 projectStore：项目不在 store 也能按键命中物理 Map', () => {
    terminalCache.set(terminalAddress(session, 'tabA', 'p1'), makeEntry('s1'));
    expect(resolveTerminalEntry(session, 'tabA', 'p1')?.sessionId).toBe('s1');
  });

  it('跨 session 不可见（worktree 键不被主仓 resolve）', () => {
    const wt = WorkspaceSession.of('proj1', '/wt/a');
    terminalCache.set(terminalAddress(wt, 'tabA', 'p1'), makeEntry('s-wt'));
    expect(resolveTerminalEntry(session, 'tabA', 'p1')).toBeNull();
    expect(resolveTerminalEntry(wt, 'tabA', 'p1')?.sessionId).toBe('s-wt');
  });

  it('键在物理 Map 中唯一命中（Wsl map）', () => {
    wslTerminalCache.set(terminalAddress(session, 'tabA', 'p1'), makeEntry('s-wsl') as never);
    expect(resolveTerminalEntry(session, 'tabA', 'p1')?.sessionId).toBe('s-wsl');
    // 不落在 local Map
    expect(terminalCache.size).toBe(0);
  });
});

/**
 * **pane 无关的 tab 级 resolve**（R1）：写侧调用方只持有 tab 身份，不知道 pane。
 * 旧实现按 `paneId='p1'` 猜 ⇒ 只有 `:p2` 存活时恒 miss（本任务事故的根因）。
 */
describe('resolveTerminalEntryOfTab（pane 无关）', () => {
  const session = WorkspaceSession.of('proj1', null);

  it('非首个 pane 的存活 PTY 也能命中（旧实现在本用例上必红）', () => {
    terminalCache.set(terminalAddress(session, 'tabA', 'p2'), makeEntry('s-p2'));
    expect(resolveTerminalEntryOfTab(session, 'tabA')?.sessionId).toBe('s-p2');
  });

  it('多 pane 并存时按 paneId 升序取首个存活条目（确定性，不靠 Map 插入序）', () => {
    terminalCache.set(terminalAddress(session, 'tabA', 'p3'), makeEntry('s-p3'));
    terminalCache.set(terminalAddress(session, 'tabA', 'p1'), makeEntry(null));
    terminalCache.set(terminalAddress(session, 'tabA', 'p2'), makeEntry('s-p2'));
    // p1 的 PTY 未就绪 → 跳过，取 p2（不是插入序更早的 p3）
    expect(resolveTerminalEntryOfTab(session, 'tabA')?.sessionId).toBe('s-p2');
  });

  it('只扫本 tab 的前缀：别的 tab / 别的 session 的条目不得混淆', () => {
    const wt = WorkspaceSession.of('proj1', '/wt/a');
    terminalCache.set(terminalAddress(session, 'tabB', 'p1'), makeEntry('s-other-tab'));
    terminalCache.set(terminalAddress(wt, 'tabA', 'p1'), makeEntry('s-wt'));
    expect(resolveTerminalEntryOfTab(session, 'tabA')).toBeNull();
  });
});

describe('③ 面：销毁 / 刷新（session 前缀扫描）', () => {
  const session = WorkspaceSession.of('proj1', null);
  const wt = WorkspaceSession.of('proj1', '/wt/a');

  it('destroyTerminalsForSession 只销毁该 session 的键', () => {
    terminalCache.set(terminalAddress(session, 'tabA'), makeEntry('s1'));
    terminalCache.set(terminalAddress(wt, 'tabA'), makeEntry('s2'));
    destroyTerminalsForSession(session);
    expect(terminalCache.has(terminalAddress(session, 'tabA'))).toBe(false);
    expect(terminalCache.has(terminalAddress(wt, 'tabA'))).toBe(true);
  });

  it('destroyTerminalsForTab 只销毁该 tab 的键（含多个 pane）', () => {
    terminalCache.set(terminalAddress(session, 'tabA', 'p1'), makeEntry('s1'));
    terminalCache.set(terminalAddress(session, 'tabA', 'p2'), makeEntry('s2'));
    terminalCache.set(terminalAddress(session, 'tabB'), makeEntry('s3'));
    destroyTerminalsForTab(session, 'tabA');
    expect(terminalCache.has(terminalAddress(session, 'tabA', 'p1'))).toBe(false);
    expect(terminalCache.has(terminalAddress(session, 'tabA', 'p2'))).toBe(false);
    expect(terminalCache.has(terminalAddress(session, 'tabB'))).toBe(true);
  });

  it('refreshTerminalForSession(tabId) 命中并回收该键', () => {
    const key = terminalAddress(session, 'tabA');
    terminalCache.set(key, makeEntry('s1'));
    refreshTerminalForSession(session, 'tabA');
    expect(terminalCache.has(key)).toBe(false);
    expect(closeSessionMock).toHaveBeenCalledWith('s1');
  });
});
