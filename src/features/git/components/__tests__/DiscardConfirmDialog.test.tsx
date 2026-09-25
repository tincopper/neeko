import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DiscardIntent } from '../../utils/discardIntent';
import DiscardConfirmDialog from '../DiscardConfirmDialog';

function renderDialog(intent: DiscardIntent | null, overrides: Record<string, unknown> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <DiscardConfirmDialog
      intent={intent}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

const TRACKED_GROUP: DiscardIntent = {
  paths: ['a.ts', 'b.ts'],
  scope: 'group',
  changeClass: 'tracked',
};

describe('DiscardConfirmDialog — 丢弃二次确认', () => {
  it('intent 为 null 时不渲染按钮', () => {
    renderDialog(null);

    expect(screen.queryByRole('button', { name: 'Discard All' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('tracked 整组：标题/描述/确认按钮文案随意图派生', () => {
    renderDialog(TRACKED_GROUP);

    expect(screen.getByText('Discard all changes?')).toBeInTheDocument();
    expect(screen.getByText(/This will discard all 2 changes\./)).toBeInTheDocument();
    // tracked 可复原：给出「恢复到最近提交状态」而非「永久删除」
    expect(screen.getByText(/restored to the last committed state/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard All' })).toBeInTheDocument();
  });

  it('unversioned：显式警示不可恢复，且名词用 unversioned file', () => {
    renderDialog({ paths: ['new.ts'], scope: 'group', changeClass: 'unversioned' });

    expect(screen.getByText('Discard all unversioned files?')).toBeInTheDocument();
    expect(screen.getByText(/all 1 unversioned file/)).toBeInTheDocument();
    expect(screen.getByText(/permanently deleted/)).toBeInTheDocument();
  });

  it('选中范围：文案说「选中」而非「全部」', () => {
    renderDialog({ paths: ['b.ts'], scope: 'selection', changeClass: 'tracked' });

    expect(screen.getByText('Discard selected changes?')).toBeInTheDocument();
    expect(screen.getByText(/1 selected change/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it('确认时回传原始意图（paths 不得被弹窗改写/扩围）', () => {
    const { onConfirm } = renderDialog(TRACKED_GROUP);

    fireEvent.click(screen.getByRole('button', { name: 'Discard All' }));

    expect(onConfirm).toHaveBeenCalledWith(TRACKED_GROUP);
    // 同一引用：确认文案描述的范围与执行集合是同一份数据
    expect(onConfirm.mock.calls[0]?.[0]).toBe(TRACKED_GROUP);
  });

  it('取消只回调 onCancel，不触发确认', () => {
    const { onConfirm, onCancel } = renderDialog(TRACKED_GROUP);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
