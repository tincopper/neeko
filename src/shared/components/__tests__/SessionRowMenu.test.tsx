import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SessionRowMenu from '@/shared/components/SessionRowMenu';

/**
 * 菜单项**按能力渲染**，不按「有没有工具栏」渲染。
 *
 * 回归钉子：早先「有任一项就渲染整个菜单」，只传 `onDelete` 时「Rename」仍然出现在菜单里，
 * 点下去静默无反应（`onRename?.()` 把调用丢掉了）。「点了没反应」在构造上是可能的 ——
 * 现在菜单里只会出现调用方真的提供的那几项。
 */
describe('SessionRowMenu — 菜单项按能力渲染', () => {
  it('两项都提供 ⇒ 两项都在，且删除被分隔线压在最后', () => {
    render(<SessionRowMenu sessionTitle="修复登录竞态" onRename={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /Session actions/ }));

    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('只提供 onDelete ⇒ 菜单里没有 Rename（不出现点了没反应的项）', () => {
    render(<SessionRowMenu sessionTitle="A" onDelete={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /Session actions/ }));

    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('只提供 onRename ⇒ 菜单里没有 Delete', () => {
    render(<SessionRowMenu sessionTitle="A" onRename={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /Session actions/ }));

    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
