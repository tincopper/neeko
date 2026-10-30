import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { confirmAction, setConfirmHostMounted, useConfirmStore } from '@/shared/store/confirmStore';

import ConfirmHost from '../ConfirmHost';

const REQUEST = {
  title: 'Proceed?',
  message: 'body text',
  confirmLabel: 'Proceed',
};

describe('ConfirmHost — 通用确认宿主（store ↔ UI 的唯一连接点）', () => {
  beforeEach(() => {
    useConfirmStore.setState({ pending: null });
    setConfirmHostMounted(false);
  });

  it('挂载后把请求渲染成对话框', async () => {
    render(<ConfirmHost />);

    let answer!: Promise<boolean>;
    act(() => {
      answer = confirmAction(REQUEST);
    });
    expect(await screen.findByText('Proceed?')).toBeInTheDocument();
    expect(screen.getByText('body text')).toBeInTheDocument();

    // 结算以免留下挂起请求。
    act(() => useConfirmStore.getState().resolve(false));
    await expect(answer).resolves.toBe(false);
  });

  /**
   * **不悬挂守卫**：宿主在请求挂起期间被卸载时，必须把请求按"取消"结算。
   *
   * `request` 只在"请求发起时无宿主"这条路径上立即结算；若宿主随后消失而无人结算，
   * `await confirmAction(...)` 的调用方（runner / store action）会永久挂起。
   */
  it('卸载时结算在途请求（await 方不得永久挂起）', async () => {
    const { unmount } = render(<ConfirmHost />);

    let answer!: Promise<boolean>;
    act(() => {
      answer = confirmAction(REQUEST);
    });
    expect(useConfirmStore.getState().pending?.title).toBe('Proceed?');

    unmount();

    await expect(answer).resolves.toBe(false);
    expect(useConfirmStore.getState().pending).toBeNull();
  });

  /**
   * **点「确认」必须真的确认**（2026-10-30 实测缺陷）。
   *
   * `ConfirmDialog` 的确认按钮曾先调 `onOpenChange(false)` 再 `onConfirm()`：
   * 前者把在途请求按取消结算（`resolve(false)` 已清掉 resolver），后者的
   * `resolve(true)` 成为空操作 ⇒ `await confirmAction(...)` **恒为 false**，
   * 调用方静默不动作（历史会话删除表现为「点了没反应」）。
   *
   * 变异验证：把 `onOpenChange(false)` 加回确认按钮 → 本用例红。
   */
  it('点确认时把请求结算为 true（不是取消）', async () => {
    render(<ConfirmHost />);

    let answer!: Promise<boolean>;
    act(() => {
      answer = confirmAction(REQUEST);
    });
    const confirmButton = await screen.findByRole('button', { name: /proceed/i });

    fireEvent.click(confirmButton);

    await expect(answer).resolves.toBe(true);
    expect(useConfirmStore.getState().pending).toBeNull();
  });

  it('点取消时结算为 false', async () => {
    render(<ConfirmHost />);

    let answer!: Promise<boolean>;
    act(() => {
      answer = confirmAction(REQUEST);
    });
    const cancelButton = await screen.findByRole('button', { name: /cancel/i });

    fireEvent.click(cancelButton);

    await expect(answer).resolves.toBe(false);
  });
});
