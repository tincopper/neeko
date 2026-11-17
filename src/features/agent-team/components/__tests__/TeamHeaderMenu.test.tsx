import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import TeamHeaderMenu from '../TeamHeaderMenu';

/**
 * `⋯` 菜单的**按能力渲染**与转发（R1）。
 *
 * 三条判据：
 *
 * 1. **不出现点了没反应的项**（与 `SessionRowMenu` 同一条纪律）：宿主没注入的连线不渲染。
 * 2. **能力成立才出现**：`恢复团队` 只在 `open + 有可恢复成员` 时成立（`sealed` 时恢复会
 *    撤销用户的决定）；`关闭团队…` 在 `sealed` 上不存在。
 * 3. **只转发**：每一项调的是宿主传进来的那个回调 —— 菜单里不调 API、不持 hook。
 */
const TEAM = 'refactor';

function mountMenu(overrides: Partial<React.ComponentProps<typeof TeamHeaderMenu>> = {}) {
  const props: React.ComponentProps<typeof TeamHeaderMenu> = {
    teamName: TEAM,
    state: 'open',
    resumable: false,
    closing: false,
    resuming: false,
    onRefresh: vi.fn(),
    onRequestClose: vi.fn(),
    ...overrides,
  };
  render(<TeamHeaderMenu {...props} />);
  /** Radix 的菜单在 jsdom 里靠 `pointerDown` 触发（同 `SessionRowMenu.test.tsx`）。 */
  fireEvent.pointerDown(screen.getByRole('button', { name: `团队操作：${TEAM}` }));
  return props;
}

describe('TeamHeaderMenu — 哪一项出现', () => {
  it('只提供了刷新（sealed + 无改名 + 无恢复）⇒ 菜单里只有「刷新快照」', () => {
    mountMenu({ state: 'sealed' });

    expect(screen.getByRole('menuitem', { name: '刷新快照' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '改名' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '恢复团队' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /关闭团队/ })).not.toBeInTheDocument();
  });

  it('sealed ⇒ 没有「关闭团队…」（只读快照没有可关的东西）', () => {
    mountMenu({ state: 'sealed' });
    expect(screen.queryByRole('menuitem', { name: /关闭团队/ })).not.toBeInTheDocument();
  });

  it('open + 有可恢复成员 ⇒ 有「恢复团队」；恢复在飞时置灰', () => {
    mountMenu({ state: 'open', resumable: true, onResumeTeam: vi.fn(), resuming: true });
    expect(screen.getByRole('menuitem', { name: '恢复团队' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('sealed ⇒ 没有「恢复团队」（即便存在可恢复成员）', () => {
    mountMenu({ state: 'sealed', resumable: true, onResumeTeam: vi.fn() });
    expect(screen.queryByRole('menuitem', { name: '恢复团队' })).not.toBeInTheDocument();
  });

  it('open 但没有可恢复成员 ⇒ 不渲染「恢复团队」（不宣传一个会恢复 0 个成员的动作）', () => {
    mountMenu({ state: 'open', resumable: false, onResumeTeam: vi.fn() });
    expect(screen.queryByRole('menuitem', { name: '恢复团队' })).not.toBeInTheDocument();
  });

  it('宿主没注入整队恢复 ⇒ 即便 open + 可恢复，也没有这一项', () => {
    mountMenu({ state: 'open', resumable: true, onResumeTeam: undefined });
    expect(screen.queryByRole('menuitem', { name: '恢复团队' })).not.toBeInTheDocument();
  });

  it('关闭在飞时「关闭团队…」置灰（避免连点出两次确认）', () => {
    mountMenu({ state: 'open', closing: true });
    expect(screen.getByRole('menuitem', { name: /关闭团队/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('TeamHeaderMenu — 只转发给宿主', () => {
  it('点「刷新快照」调 onRefresh', () => {
    const handlers = mountMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '刷新快照' }));
    expect(handlers.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('点「改名」调 onRename（同一个 handleStartRename，与双击入口一条路径）', async () => {
    const onRename = vi.fn();
    mountMenu({ onRename });
    fireEvent.click(screen.getByRole('menuitem', { name: '改名' }));
    // 编辑态在菜单**卸载之后**才开（否则菜单的焦点陷阱会把输入框的焦点抢走 → blur → 关掉）
    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(1));
  });

  it('点「恢复团队」调 onResumeTeam', () => {
    const onResumeTeam = vi.fn();
    mountMenu({ state: 'open', resumable: true, onResumeTeam });
    fireEvent.click(screen.getByRole('menuitem', { name: '恢复团队' }));
    expect(onResumeTeam).toHaveBeenCalledTimes(1);
  });

  it('点「关闭团队…」调 onRequestClose（走宿主的二次确认，不在这里直接关）', () => {
    const handlers = mountMenu({ state: 'open' });
    fireEvent.click(screen.getByRole('menuitem', { name: /关闭团队/ }));
    expect(handlers.onRequestClose).toHaveBeenCalledTimes(1);
  });
});
