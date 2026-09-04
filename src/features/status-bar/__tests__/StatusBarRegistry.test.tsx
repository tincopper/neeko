import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { STATUS_BAR_ITEMS } from '../registry';
import { StatusBarCluster } from '../StatusBarCluster';
import type { StatusBarItemDef } from '../types';

function meta() {
  return STATUS_BAR_ITEMS.map((d) => ({
    id: d.id,
    side: d.side,
    order: d.order,
  }));
}

describe('statusBarRegistry', () => {
  it('快照：side/order 保持稳定', () => {
    expect(meta()).toMatchSnapshot();
  });

  it('左簇：branch、lsp 槽位、conflicts；右簇 5 项', () => {
    const byId: Record<string, StatusBarItemDef | undefined> = Object.fromEntries(
      STATUS_BAR_ITEMS.map((d) => [d.id, d]),
    );
    expect(byId['branch']?.side).toBe('left');
    expect(byId['lsp']?.side).toBe('left');
    expect(byId['conflicts']?.side).toBe('left');
    for (const id of ['console', 'debug', 'cursor', 'prompts', 'notifications']) {
      expect(byId[id]?.side).toBe('right');
    }
    expect(STATUS_BAR_ITEMS).toHaveLength(8);
  });
  it('order 稀疏递增且同 order 时按 id 确定性兜底', () => {
    for (const side of ['left', 'right'] as const) {
      const items = STATUS_BAR_ITEMS.filter((d) => d.side === side);
      const sorted = [...items].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
      expect(sorted.map((d) => d.id)).toEqual(items.map((d) => d.id));
      const orders = items.map((d) => d.order);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it('全渲染：无自守卫的项全部出现', () => {
    const items: StatusBarItemDef[] = [
      { id: 'a', side: 'right', order: 10, component: () => <span>one</span> },
      { id: 'b', side: 'right', order: 20, component: () => <span>two</span> },
    ];
    render(<StatusBarCluster side="right" items={items} />);
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
  });
});
