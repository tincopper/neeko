import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OutputScroll, {
  OUTPUT_COLLAPSE_THRESHOLD,
  OUTPUT_VIRTUALIZE_THRESHOLD,
} from '../OutputScroll';

// jsdom 未实现 ResizeObserver；@tanstack/react-virtual 测量容器时依赖它。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  // virtual-core 挂载时同步测量 scrollRect（用 offsetWidth/offsetHeight，jsdom 恒为 0），
  // mock 非零尺寸让虚拟化渲染视口内行。
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(320);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OutputScroll', () => {
  it('小文本直接渲染为 <pre>（不虚拟化、不折叠）', () => {
    render(<OutputScroll text={'a\nb\nc'} testId="out" />);

    const pre = screen.getByTestId('out');
    expect(pre.tagName).toBe('PRE');
    expect(pre).toHaveTextContent('a');
    expect(pre).toHaveTextContent('b');
    expect(pre).toHaveTextContent('c');
    expect(screen.queryAllByTestId('output-line')).toHaveLength(0);
  });

  it(`介于 ${OUTPUT_VIRTUALIZE_THRESHOLD} 与 ${OUTPUT_COLLAPSE_THRESHOLD} 行之间自动虚拟化（不折叠）`, () => {
    const text = Array.from(
      { length: OUTPUT_VIRTUALIZE_THRESHOLD + 300 },
      (_, i) => `line-${i}`,
    ).join('\n');
    render(<OutputScroll text={text} testId="out" />);

    const rows = screen.queryAllByTestId('output-line');
    expect(rows.length).toBeGreaterThan(0);
    // 仅视口内行（fixed 20px 行高 + overscan），远小于全量
    expect(rows.length).toBeLessThan(200);
  });

  it('超过折叠阈值默认折叠，点击展开后虚拟化渲染', () => {
    const lineCount = OUTPUT_COLLAPSE_THRESHOLD + 4000;
    const text = Array.from({ length: lineCount }, (_, i) => `line-${i}`).join('\n');
    render(<OutputScroll text={text} testId="out" />);

    // 默认折叠：显示「已折叠 N 行」提示与展开按钮，不渲染任何输出行
    expect(screen.getByText(`已折叠 ${lineCount} 行`)).toBeInTheDocument();
    expect(screen.queryAllByTestId('output-line')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    const rows = screen.queryAllByTestId('output-line');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(200);
  });

  it('虚拟化渲染保留首尾行内容（首行可见）', () => {
    const lineCount = OUTPUT_VIRTUALIZE_THRESHOLD + 100;
    const text = Array.from({ length: lineCount }, (_, i) => `line-${i}`).join('\n');
    render(<OutputScroll text={text} testId="out" />);

    expect(screen.getByText('line-0')).toBeInTheDocument();
  });

  it(`阈值边界：${OUTPUT_VIRTUALIZE_THRESHOLD - 1} 行直接渲染，${OUTPUT_VIRTUALIZE_THRESHOLD} 行起虚拟化`, () => {
    const below = Array.from(
      { length: OUTPUT_VIRTUALIZE_THRESHOLD - 1 },
      (_, i) => `line-${i}`,
    ).join('\n');
    const { unmount } = render(<OutputScroll text={below} testId="below" />);
    expect(screen.getByTestId('below').tagName).toBe('PRE');
    expect(screen.queryAllByTestId('output-line')).toHaveLength(0);
    unmount();

    const at = Array.from({ length: OUTPUT_VIRTUALIZE_THRESHOLD }, (_, i) => `line-${i}`).join(
      '\n',
    );
    render(<OutputScroll text={at} testId="at" />);
    expect(screen.getByTestId('at').tagName).not.toBe('PRE');
    expect(screen.queryAllByTestId('output-line').length).toBeGreaterThan(0);
  });

  it(`阈值边界：${OUTPUT_COLLAPSE_THRESHOLD - 1} 行不折叠，${OUTPUT_COLLAPSE_THRESHOLD} 行起默认折叠`, () => {
    const below = Array.from({ length: OUTPUT_COLLAPSE_THRESHOLD - 1 }, (_, i) => `line-${i}`).join(
      '\n',
    );
    const { unmount } = render(<OutputScroll text={below} testId="below" />);
    expect(screen.queryByText(/已折叠/)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('output-line').length).toBeGreaterThan(0);
    unmount();

    const at = Array.from({ length: OUTPUT_COLLAPSE_THRESHOLD }, (_, i) => `line-${i}`).join('\n');
    render(<OutputScroll text={at} testId="at" />);
    expect(screen.getByText(`已折叠 ${OUTPUT_COLLAPSE_THRESHOLD} 行`)).toBeInTheDocument();
  });
});
