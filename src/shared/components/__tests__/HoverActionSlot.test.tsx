import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import HoverActionSlot from '../HoverActionSlot';

describe('HoverActionSlot', () => {
  it('默认隐藏：行 hover 同色实底覆盖，不画浮块、不占 flex 宽度', () => {
    render(
      <HoverActionSlot testId="slot" group="session">
        <span>action</span>
      </HoverActionSlot>,
    );

    const slot = screen.getByTestId('slot');
    expect(slot).toHaveClass(
      'absolute',
      'right-1.5',
      'top-1/2',
      '-translate-y-1/2',
      'bg-bg-hover',
      'opacity-0',
      'pointer-events-none',
      'group-hover/session:opacity-100',
      'group-hover/session:pointer-events-auto',
      'focus-within:opacity-100',
      'focus-within:pointer-events-auto',
    );
    expect(slot).not.toHaveClass('bg-bg-tertiary');
    expect(slot).not.toHaveClass('rounded-md');
    expect(slot).not.toHaveClass('p-0.5');
    expect(slot).not.toHaveClass('shadow-sm');
    expect(slot).toContainElement(screen.getByText('action'));
    expect(slot).toHaveAttribute('data-no-drag');
    expect(slot).toHaveAttribute('role', 'presentation');
  });

  it('forceShow 时强制可见，不再保留隐藏态', () => {
    render(
      <HoverActionSlot testId="slot" group="session" forceShow>
        <span>action</span>
      </HoverActionSlot>,
    );

    const slot = screen.getByTestId('slot');
    expect(slot).toHaveClass('opacity-100', 'pointer-events-auto');
    expect(slot).not.toHaveClass('opacity-0');
    expect(slot).not.toHaveClass('pointer-events-none');
  });

  it('proj / plain 命名组各自生成对应 hover 变体', () => {
    const { unmount } = render(
      <HoverActionSlot testId="proj-slot" group="proj">
        <span>a</span>
      </HoverActionSlot>,
    );
    expect(screen.getByTestId('proj-slot')).toHaveClass(
      'group-hover/proj:opacity-100',
      'group-hover/proj:pointer-events-auto',
    );
    expect(screen.getByTestId('proj-slot')).not.toHaveClass('group-hover/session:opacity-100');
    unmount();

    render(
      <HoverActionSlot testId="plain-slot" group="plain">
        <span>b</span>
      </HoverActionSlot>,
    );
    expect(screen.getByTestId('plain-slot')).toHaveClass(
      'group-hover:opacity-100',
      'group-hover:pointer-events-auto',
    );
    expect(screen.getByTestId('plain-slot')).not.toHaveClass('group-hover/proj:opacity-100');
  });

  it('rightClassName / className 覆盖几何与附加样式', () => {
    render(
      <HoverActionSlot
        testId="slot"
        group="plain"
        rightClassName="right-7"
        className="z-10 gap-0.5"
      >
        <span>action</span>
      </HoverActionSlot>,
    );

    const slot = screen.getByTestId('slot');
    expect(slot).toHaveClass('right-7', 'z-10', 'gap-0.5');
    expect(slot).not.toHaveClass('right-1.5');
  });

  it('点击不冒泡到行级父容器，onFocus / onBlur 透传', () => {
    const onParentClick = vi.fn();
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    document.addEventListener('click', onParentClick);
    try {
      render(
        <HoverActionSlot testId="slot" group="session" onFocus={onFocus} onBlur={onBlur}>
          <span>action</span>
        </HoverActionSlot>,
      );

      const slot = screen.getByTestId('slot');
      fireEvent.click(slot);
      fireEvent.focusIn(slot);
      fireEvent.focusOut(slot);

      expect(onParentClick).not.toHaveBeenCalled();
      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(onBlur).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('click', onParentClick);
    }
  });
});
