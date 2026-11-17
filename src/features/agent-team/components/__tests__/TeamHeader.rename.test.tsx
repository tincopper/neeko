import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createTeamSnapshot } from '@/testing/factories';

import TeamHeader from '../TeamHeader';

/**
 * 面板头的行内改名（`team_rename` 的第二个入口）。
 *
 * 三条键路各钉一条 —— 它们共享同一份提交判据（`utils/renameDraft.ts`），而列表行与头部
 * 各写一遍时，「一个入口点两次写两条审计、另一个不会」只会在用久了之后显形：
 *
 * | 键路 | 期望 |
 * | --- | --- |
 * | Enter + 真的改了 | 回调收到**裁过**的新名字 |
 * | Enter + 没改 / 清空 | 零回调（空名在后端是 `InvalidInput`，没改只是白写一条审计）|
 * | Esc | 零回调，回到显示态（旧名字还在，界面不假装改过）|
 */
const SNAPSHOT = createTeamSnapshot();

function renderHeader(overrides: Partial<React.ComponentProps<typeof TeamHeader>> = {}) {
  const onRenameTeam = vi.fn();
  const props: React.ComponentProps<typeof TeamHeader> = {
    teamId: 'tm_1',
    snapshot: SNAPSHOT,
    closing: false,
    resuming: false,
    onRenameTeam,
    onRefresh: vi.fn(),
    onBack: vi.fn(),
    onRequestClose: vi.fn(),
    ...overrides,
  };
  render(<TeamHeader {...props} />);
  return { onRenameTeam };
}

/**
 * 开 `⋯` 菜单 → 点「改名」进编辑态（R1：低频入口收进菜单）。
 *
 * `await`：编辑态在菜单**卸载之后**才开（菜单的焦点陷阱会把输入框的焦点抢走 → blur → 关掉）。
 */
async function startEditing(): Promise<HTMLInputElement> {
  fireEvent.pointerDown(
    screen.getByRole('button', { name: `Team actions: ${SNAPSHOT.team.name}` }),
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  return (await screen.findByRole('textbox')) as HTMLInputElement;
}

describe('TeamHeader — 行内改名', () => {
  it('编辑态预填当前名字（改名不是重新起名）', async () => {
    renderHeader();
    expect(await startEditing()).toHaveValue(SNAPSHOT.team.name);
  });

  it('Enter 提交 ⇒ 回调收到裁过的新名字', async () => {
    const { onRenameTeam } = renderHeader();
    const input = await startEditing();

    fireEvent.change(input, { target: { value: '  求和小队  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameTeam).toHaveBeenCalledExactlyOnceWith('求和小队');
    // 提交后回到显示态（输入框卸了）
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('没改就 Enter ⇒ 零回调（白写一条审计没有意义）', async () => {
    const { onRenameTeam } = renderHeader();
    const input = await startEditing();

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameTeam).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('清空后 Enter ⇒ 零回调（空名不是名字，后端也会拒）', async () => {
    const { onRenameTeam } = renderHeader();
    const input = await startEditing();

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRenameTeam).not.toHaveBeenCalled();
  });

  it('Esc 取消 ⇒ 零回调，旧名字照旧显示', async () => {
    const { onRenameTeam } = renderHeader();
    const input = await startEditing();

    fireEvent.change(input, { target: { value: '改了但又反悔' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRenameTeam).not.toHaveBeenCalled();
    expect(screen.getByText(SNAPSHOT.team.name)).toBeInTheDocument();
  });

  it('双击名字也是入口（按钮仍是主入口：双击对键盘 / 读屏用户不存在）', () => {
    renderHeader();
    fireEvent.doubleClick(screen.getByText(SNAPSHOT.team.name));
    expect(screen.getByRole('textbox')).toHaveValue(SNAPSHOT.team.name);
  });

  it('宿主没注入回调 ⇒ 菜单里没有「改名」（而不是一个点了没反应的项）', () => {
    renderHeader({ onRenameTeam: undefined });
    fireEvent.pointerDown(
      screen.getByRole('button', { name: `Team actions: ${SNAPSHOT.team.name}` }),
    );
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
  });
});
