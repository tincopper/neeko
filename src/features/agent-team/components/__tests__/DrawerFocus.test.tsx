import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMemberDetail,
  createMemberStatus,
  createTaskCard,
  createTaskDetail,
  createTeamList,
  createTeamSnapshot,
} from '@/testing/factories';
import { invoke } from '@/testing/tauriCore';

import { __resetTeamListStoreForTests } from '../../store/teamListStore';
import {
  __resetTeamGenerationForTests,
  __resetTeamPulseForTests,
  useTeamStore,
} from '../../store/teamStore';
import TeamPanel from '../TeamPanel';

/**
 * 两个抽屉的**焦点契约**（`useDrawerFocus` 一份实现，两处共用）。
 *
 * 判据（缺一条键盘用户就会被送到看不见的地方）：
 *
 * 1. 打开后焦点**进入**抽屉（不是留在背后被盖住的按钮上）；
 * 2. 抽屉是 `role="dialog"` + `aria-modal="true"` + 有可访问名；
 * 3. Esc 关闭；
 * 4. 关闭后焦点**回到触发按钮**（否则落到 `body`，Tab 从文档开头重新走）；
 * 5. Tab 陷阱：焦点不会跑回背后那层（`aria-modal` 只是宣告，拦不住 Tab）。
 *
 * 断言用 `toHaveFocus()`（Testing Library 的可访问判据），不碰 `document.activeElement`：
 * 「谁有焦点」是用户可见的事实，`activeElement` 只是它的一种读取方式。
 *
 * 修之前：两个抽屉都是裸的 `absolute … z-10` 覆盖层 —— 无 role、无 Esc、无移焦、无归还，
 * 而触发它们的行 / 卡片**还在 DOM 里**（只是被盖住）。
 */

const mockInvoke = vi.mocked(invoke);

const MEMBERS = [
  createMemberStatus({
    memberId: 'lead@tm_1',
    name: 'lead',
    role: 'lead',
    terminalId: 'term-lead',
  }),
  createMemberStatus({ memberId: 'w1@tm_1', name: 'frontend', terminalId: 'term-w1' }),
];

const TASK = createTaskCard({
  id: 't1',
  teamId: 'tm_1',
  title: '登录页骨架',
  state: 'in_progress',
});

function resetStores(): void {
  __resetTeamGenerationForTests();
  __resetTeamListStoreForTests();
  __resetTeamPulseForTests();
  useTeamStore.setState({
    teamId: 'tm_1',
    snapshot: createTeamSnapshot({ members: MEMBERS, tasks: [TASK] }),
    detail: null,
    loading: false,
    error: null,
    lastRev: 0,
  });
}

const snapshot = createTeamSnapshot({ members: MEMBERS, tasks: [TASK] });

function renderPanel(): void {
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd === 'team_snapshot') return snapshot;
    if (cmd === 'team_list') return createTeamList({ teams: [] });
    if (cmd === 'team_member_detail') return createMemberDetail({ member: MEMBERS[1] });
    if (cmd === 'team_task_detail') {
      return createTaskDetail({ id: 't1', title: '登录页骨架', body: '派活正文' });
    }
    return undefined;
  });
  render(<TeamPanel />);
}

/** 花名册一行里点「看详情」的按钮（可访问名是稳定钩子）。 */
function openMemberButton(): HTMLElement {
  return within(screen.getByRole('region', { name: 'Member roster' })).getByRole('button', {
    name: 'View member frontend details',
  });
}

/** 真实交互前先聚焦再点：`fireEvent.click` 不移动焦点，而「关闭后归还」依赖它。 */
function focusAndClick(element: HTMLElement): void {
  element.focus();
  fireEvent.click(element);
}

describe('抽屉焦点 — 成员详情', () => {
  beforeEach(() => {
    resetStores();
    mockInvoke.mockReset();
  });

  it('打开：焦点进入抽屉；role=dialog + aria-modal + 可访问名', async () => {
    renderPanel();
    focusAndClick(openMemberButton());

    const dialog = await screen.findByRole('dialog', { name: 'Member details: frontend' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // 焦点进入抽屉（第一个可聚焦元素 = 头部「关闭」）
    expect(within(dialog).getByRole('button', { name: 'Close member details' })).toHaveFocus();
  });

  it('Esc 关闭，且焦点回到触发它的那一行按钮', async () => {
    renderPanel();
    const trigger = openMemberButton();
    focusAndClick(trigger);
    await screen.findByRole('dialog', { name: 'Member details: frontend' });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Member details: frontend' }),
      ).not.toBeInTheDocument(),
    );
    // 归还焦点：不还的话 Tab 会从文档开头重新走（用户丢掉「我刚才在哪」）
    expect(trigger).toHaveFocus();
  });

  it('Tab 陷阱：焦点不会漏回背后那层', async () => {
    renderPanel();
    focusAndClick(openMemberButton());
    const dialog = await screen.findByRole('dialog', { name: 'Member details: frontend' });

    // 把焦点人为放到抽屉外（背后那一行），下一次 Tab 必须被拉回抽屉的第一个可聚焦元素
    const trigger = openMemberButton();
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(within(dialog).getByRole('button', { name: 'Close member details' })).toHaveFocus();
  });

  it('点「关闭」也走同一条路径（关闭后焦点仍回到触发按钮）', async () => {
    renderPanel();
    const trigger = openMemberButton();
    focusAndClick(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Member details: frontend' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close member details' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Member details: frontend' }),
      ).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
});
