import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Tab } from '@/shared/types/tab';

import TabOverflowMenu from '../TabOverflowMenu';

const makeTab = (id: string, title: string): Tab => ({
  id,
  projectId: 'p1',
  title,
  order: 0,
  data: {
    kind: 'file',
    filePath: title,
    fileName: title,
    content: { path: title, content: '', size: 0, is_binary: false },
    isDirty: false,
  },
});

const makeRect = (top: number, bottom: number, right: number): DOMRect =>
  ({
    top,
    bottom,
    right,
    left: right - 24,
    width: 24,
    height: bottom - top,
    x: right - 24,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/** 可变的锚点矩形：模拟窗口缩放过程中 ⋯ 按钮位置变化 */
const anchorRect = { top: 24, bottom: 48, right: 140 };
const anchorEl = document.createElement('div');
document.body.appendChild(anchorEl);

vi.spyOn(anchorEl, 'getBoundingClientRect').mockImplementation(() =>
  makeRect(anchorRect.top, anchorRect.bottom, anchorRect.right),
);

afterEach(() => {
  anchorRect.top = 24;
  anchorRect.bottom = 48;
  anchorRect.right = 140;
  vi.restoreAllMocks();
  // restoreAllMocks 会清掉上面的 mockImplementation，重新打上
  vi.spyOn(anchorEl, 'getBoundingClientRect').mockImplementation(() =>
    makeRect(anchorRect.top, anchorRect.bottom, anchorRect.right),
  );
});

const renderMenu = () =>
  render(
    <TabOverflowMenu
      tabs={[makeTab('t1', 'a.ts'), makeTab('t2', 'b.ts')]}
      anchorEl={anchorEl}
      onActivateTab={vi.fn()}
      onCloseTab={vi.fn()}
      onClose={vi.fn()}
    />,
  );

describe('TabOverflowMenu — 定位跟随', () => {
  it('初始定位在锚点下方且右对齐锚点右缘', () => {
    renderMenu();
    const menu = screen.getByRole('menu');

    expect(menu).toHaveStyle({ top: '52px' }); // bottom(48) + gap(4)
    expect(menu).toHaveStyle({ right: `${window.innerWidth - 140}px` });
  });

  it('窗口 resize 后重新读取锚点位置（贴住按钮）', () => {
    renderMenu();
    const menu = screen.getByRole('menu');
    expect(menu).toHaveStyle({ top: '52px' });

    act(() => {
      anchorRect.top = 100;
      anchorRect.bottom = 124;
      anchorRect.right = 300;
      window.dispatchEvent(new Event('resize'));
    });

    expect(menu).toHaveStyle({ top: '128px' }); // 124 + 4
    expect(menu).toHaveStyle({ right: `${window.innerWidth - 300}px` });
  });
});
