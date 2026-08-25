import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BrowserToolbar from '../BrowserToolbar';

function makeProps(overrides: Partial<Parameters<typeof BrowserToolbar>[0]> = {}) {
  return {
    url: 'https://example.com',
    title: '',
    favicon: '',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    onNavigate: vi.fn(),
    onRefresh: vi.fn(),
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    onOpenExternal: vi.fn(),
    onOpenDevTools: vi.fn(),
    onClosePage: vi.fn(),
    isPicking: false,
    onTogglePicker: vi.fn(),
    ...overrides,
  };
}

function getInput() {
  return screen.getByPlaceholderText('Enter URL...') as HTMLInputElement;
}

describe('BrowserToolbar — 地址栏可编辑', () => {
  it('用户聚焦地址栏后可以输入任意文本', () => {
    render(<BrowserToolbar {...makeProps()} />);

    fireEvent.focus(getInput());
    fireEvent.change(getInput(), { target: { value: 'github.com' } });

    expect(getInput().value).toBe('github.com');
  });

  it('输入过程中不再被 URL prop 回退（连续输入多个字符）', () => {
    render(<BrowserToolbar {...makeProps()} />);

    fireEvent.focus(getInput());
    // 聚焦全选后逐字符替换输入（类真实地址栏输入流）
    let typed = '';
    for (const ch of ['g', 'i', 't', 'h', 'u', 'b']) {
      typed += ch;
      fireEvent.change(getInput(), { target: { value: typed } });
    }

    expect(getInput().value).toBe('github');
  });

  it('按 Enter 提交规范化 URL', () => {
    const onNavigate = vi.fn();
    render(<BrowserToolbar {...makeProps({ onNavigate })} />);

    fireEvent.focus(getInput());
    fireEvent.change(getInput(), { target: { value: 'github.com' } });
    fireEvent.keyDown(getInput(), { key: 'Enter' });

    expect(onNavigate).toHaveBeenCalledWith('https://github.com');
  });

  it('页面有标题时地址栏降级显示标题（非编辑态）', () => {
    render(<BrowserToolbar {...makeProps({ title: 'GitHub' })} />);
    expect(getInput().value).toBe('GitHub');
  });

  it('聚焦编辑时显示 URL 而非标题', () => {
    render(<BrowserToolbar {...makeProps({ title: 'GitHub' })} />);

    fireEvent.focus(getInput());

    expect(getInput().value).toBe('https://example.com');
  });

  it('URL prop 变化时非编辑态输入值跟随同步', () => {
    const { rerender } = render(<BrowserToolbar {...makeProps()} />);

    rerender(<BrowserToolbar {...makeProps({ url: 'https://a.com' })} />);

    expect(getInput().value).toBe('https://a.com');
  });
});

describe('BrowserToolbar — 关闭页面按钮', () => {
  it('有 URL 时点击关闭按钮触发 onClosePage', () => {
    const onClosePage = vi.fn();
    render(<BrowserToolbar {...makeProps({ onClosePage })} />);

    fireEvent.click(screen.getByTitle('Close page'));

    expect(onClosePage).toHaveBeenCalledTimes(1);
  });

  it('无 URL 时关闭按钮禁用（无页面可关）', () => {
    const onClosePage = vi.fn();
    render(<BrowserToolbar {...makeProps({ url: '', onClosePage })} />);

    const btn = screen.getByTitle('Close page') as HTMLButtonElement;
    expect(btn).toBeDisabled();

    fireEvent.click(btn);
    expect(onClosePage).not.toHaveBeenCalled();
  });
});
