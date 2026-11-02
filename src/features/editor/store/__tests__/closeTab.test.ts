// @vitest-environment node
/**
 * tab 关闭的**决策矩阵**（「会话还在跑」那一半）。
 *
 * 这里只断言**编排的结论**（弹不弹框、最终怎么调用关闭）；「后台运行」在终端层到底
 * 做了什么（每个 pane 切分离态、不结束进程）由 `terminalTabCleanup.test.ts` 覆盖 ——
 * 两层的判据不同，混在一起测就没人说得清失败的是决策还是执行。
 *
 * 判据与文件 tab 的未保存确认**共用**同一个宿主与 resolver 槽位，所以这里也顺带覆盖
 * 「两种请求不能互相串线」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { closeEditorTabMock } = vi.hoisted(() => ({ closeEditorTabMock: vi.fn() }));

// 关闭动作的作用面（拆终端 + 改 store）在 terminal/editor 域内自有测试；这里只要它被
// **按正确的参数**调用一次。
vi.mock('@/features/terminal', () => ({ closeEditorTab: closeEditorTabMock }));

import { useEditorStore } from '@/shared/store/editorStore';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';
import { useOverlayStore } from '@/shared/store/overlayStore';
import type { SessionState, SessionView } from '@/shared/types/liveSessions';
import type { Tab } from '@/shared/types/tab';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { setCloseConfirmHostMounted, useCloseConfirmStore } from '../closeConfirmStore';
import { closeTabWithConfirmation } from '../closeTab';

const WS = WorkspaceSession.of('p1', '/proj-wt');
const KEY = WS.key;

function terminalTab(id: string, ptySessionId?: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: WS },
    title: 'Claude Code',
    data: { kind: 'terminal', agentId: 'claude-code', ptySessionId },
  };
}

function session(state: SessionState, ptySessionId = 'pty-1'): SessionView {
  return {
    sessionId: ptySessionId,
    kind: 'terminal',
    agentId: 'claude-code',
    workspaceKey: KEY,
    title: '修复登录竞态',
    titleSource: 'prompt',
    state,
    startedAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    turnCount: 1,
    hasUserInput: true,
  };
}

function seed(...sessions: SessionView[]): void {
  useLiveSessionsStore.setState({ version: 1, sessions, hydratedAt: Date.now() });
}

beforeEach(() => {
  closeEditorTabMock.mockClear();
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useLiveSessionsStore.setState({ version: 0, sessions: [], hydratedAt: null });
  useOverlayStore.getState().reset();
  useCloseConfirmStore.setState({ pending: null });
  setCloseConfirmHostMounted(true);
});

describe('closeTabWithConfirmation — 会话还在跑', () => {
  it('会话还活着 ⇒ 弹「后台运行 / 退出 / 取消」而不是直接关', async () => {
    useEditorStore.getState().addTab(terminalTab('tab-1', 'pty-1'));
    seed(session('running'));

    const closing = closeTabWithConfirmation(KEY, 'tab-1');

    expect(useCloseConfirmStore.getState().pending).toEqual({
      kind: 'running-terminal',
      title: 'Claude Code',
    });

    useCloseConfirmStore.getState().resolve('cancel');
    await expect(closing).resolves.toBe(false);
    expect(closeEditorTabMock).not.toHaveBeenCalled();
  });

  it('后台运行 ⇒ 收起 tab 且**保留会话**（keepSession）', async () => {
    useEditorStore.getState().addTab(terminalTab('tab-1', 'pty-1'));
    seed(session('running'));

    const closing = closeTabWithConfirmation(KEY, 'tab-1');
    useCloseConfirmStore.getState().resolve('background');
    await expect(closing).resolves.toBe(true);

    expect(closeEditorTabMock).toHaveBeenCalledWith(KEY, 'tab-1', { keepSession: true });
    // 会话本身仍在注册表里（侧栏继续监控它的状态），没有被标成停止。
    expect(useLiveSessionsStore.getState().sessions[0].state).toBe('running');
  });

  it('退出进程 ⇒ 普通关闭（不带 keepSession，进程随 tab 结束）', async () => {
    useEditorStore.getState().addTab(terminalTab('tab-1', 'pty-1'));
    seed(session('running'));

    const closing = closeTabWithConfirmation(KEY, 'tab-1');
    useCloseConfirmStore.getState().resolve('exit');
    await expect(closing).resolves.toBe(true);

    expect(closeEditorTabMock).toHaveBeenCalledWith(KEY, 'tab-1');
    expect(closeEditorTabMock).toHaveBeenCalledTimes(1);
  });

  it('会话在等审批 ⇒ 仍然弹框（那一轮还没完，丢掉就是丢了未完成的工作）', () => {
    useEditorStore.getState().addTab(terminalTab('tab-1', 'pty-1'));
    seed(session('awaitingApproval'));

    void closeTabWithConfirmation(KEY, 'tab-1');
    expect(useCloseConfirmStore.getState().pending).toEqual({
      kind: 'running-terminal',
      title: 'Claude Code',
    });
  });

  it('agent 已经干完（ready，进程还在）⇒ 不弹框，直接按「退出进程」关', async () => {
    useEditorStore.getState().addTab(terminalTab('tab-1', 'pty-1'));
    seed(session('ready'));

    await expect(closeTabWithConfirmation(KEY, 'tab-1')).resolves.toBe(true);
    expect(useCloseConfirmStore.getState().pending).toBeNull();
    // 走的是正常关闭（不切分离态）：这一轮已经结束，没有可后台继续的活。
    expect(closeEditorTabMock).toHaveBeenCalledWith(KEY, 'tab-1');
  });

  it('会话已结束 ⇒ 不弹框，直接关（关 tab 不该问已经不在跑的东西）', async () => {
    useEditorStore.getState().addTab(terminalTab('tab-1', 'pty-1'));
    seed(session('stopped'));

    await expect(closeTabWithConfirmation(KEY, 'tab-1')).resolves.toBe(true);
    expect(useCloseConfirmStore.getState().pending).toBeNull();
    expect(closeEditorTabMock).toHaveBeenCalledWith(KEY, 'tab-1');
  });

  it('注册表里没有这条会话（进程已退出）⇒ 不弹框', async () => {
    useEditorStore.getState().addTab(terminalTab('tab-1', 'pty-1'));
    seed();

    await expect(closeTabWithConfirmation(KEY, 'tab-1')).resolves.toBe(true);
    expect(useCloseConfirmStore.getState().pending).toBeNull();
    expect(closeEditorTabMock).toHaveBeenCalledWith(KEY, 'tab-1');
  });

  it('tab 已不存在（并发关闭）⇒ 当成关掉了，不弹框也不挂起', async () => {
    await expect(closeTabWithConfirmation(KEY, 'tab-1')).resolves.toBe(true);
    expect(closeEditorTabMock).toHaveBeenCalledWith(KEY, 'tab-1');
  });
});
