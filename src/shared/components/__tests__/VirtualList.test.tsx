import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { VirtualList } from '../VirtualList';

const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

beforeAll(() => {
  // jsdom has no layout; virtualizer reads offsetHeight/Width from the scroll
  // element. Stub them so the windowing math works in tests.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 400,
  });
});

afterAll(() => {
  if (origH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origH);
  if (origW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origW);
});

function renderList(count = 200) {
  const items = Array.from({ length: count }, (_, i) => `item-${i}`);
  return render(
    <VirtualList
      items={items}
      getKey={(item) => item}
      renderItem={(item) => <div data-testid="row">{item}</div>}
      estimateSize={40}
      overscan={4}
      className="overflow-auto"
      initialRect={{ width: 400, height: 400 }}
    />,
  );
}

describe('VirtualList', () => {
  it('renders only a subset of items (virtualization)', async () => {
    renderList();
    const rows = await waitFor(() => {
      const found = screen.getAllByTestId('row');
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    expect(rows.length).toBeLessThan(200);
  });

  it('reports scroll range via onRangeChange', async () => {
    const onRangeChange = vi.fn();
    const items = Array.from({ length: 200 }, (_, i) => `item-${i}`);
    render(
      <VirtualList
        items={items}
        getKey={(item) => item}
        renderItem={(item) => <div data-testid="row">{item}</div>}
        estimateSize={40}
        overscan={0}
        onRangeChange={onRangeChange}
        className="overflow-auto"
        initialRect={{ width: 400, height: 400 }}
      />,
    );
    await waitFor(() => {
      expect(onRangeChange).toHaveBeenCalled();
    });
    const [start, end] = onRangeChange.mock.calls[onRangeChange.mock.calls.length - 1];
    expect(end - start).toBeLessThan(200);
  });

  it('renders no rows when empty', () => {
    render(
      <VirtualList
        items={[]}
        getKey={(item) => item}
        renderItem={(item) => <div data-testid="row">{item}</div>}
        className="overflow-auto"
        initialRect={{ width: 400, height: 400 }}
      />,
    );
    expect(screen.queryAllByTestId('row')).toHaveLength(0);
  });

  it('forwards scroll events', async () => {
    const onScroll = vi.fn();
    const items = Array.from({ length: 200 }, (_, i) => `item-${i}`);
    render(
      <VirtualList
        items={items}
        getKey={(item) => item}
        renderItem={(item) => <div data-testid="row">{item}</div>}
        estimateSize={40}
        onScroll={onScroll}
        className="overflow-auto"
        initialRect={{ width: 400, height: 400 }}
      />,
    );
    const el = screen.getByTestId('scroll-list');
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
    await waitFor(() => {
      expect(onScroll).toHaveBeenCalled();
    });
  });
});
