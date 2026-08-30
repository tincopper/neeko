import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PINNED_DROP_PREFIX } from '../../dragDrop';
import PinDropZone from '../PinDropZone';

const useDroppableMock = vi.fn();

vi.mock('@dnd-kit/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDroppable: (args: unknown) => useDroppableMock(args),
}));

describe('PinDropZone — 无 pinned 面板时的动态 pin 目标', () => {
  beforeEach(() => {
    useDroppableMock.mockReset();
    useDroppableMock.mockReturnValue({ setNodeRef: undefined, isOver: false });
  });

  it('注册 pinned 面板同款 droppable id（复用既有 pin 判定）', () => {
    render(<PinDropZone tabKey="t1" />);

    expect(useDroppableMock).toHaveBeenCalledWith({ id: `${PINNED_DROP_PREFIX}:t1:pinned` });
  });

  it('渲染 Pin 提示与 testid', () => {
    render(<PinDropZone tabKey="t1" />);

    expect(screen.getByTestId('pin-drop-zone')).toHaveTextContent('Pin');
  });

  it('isOver 时显示 accent drop 高亮', () => {
    useDroppableMock.mockReturnValue({ setNodeRef: undefined, isOver: true });

    render(<PinDropZone tabKey="t1" />);

    expect(screen.getByTestId('pin-drop-zone')).toHaveClass('ring-accent/70');
  });

  it('非 over 态不带 accent 高亮', () => {
    render(<PinDropZone tabKey="t1" />);

    expect(screen.getByTestId('pin-drop-zone')).not.toHaveClass('ring-accent');
  });
});
