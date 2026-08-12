import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkdownPreview } from '@/ui/MarkdownPreview';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));
vi.mock('plantuml-encoder', () => ({ default: { encode: vi.fn(() => 'abc') } }));

// notificationStore 兜底：断言无 handler 时提示
const mockAddNotification = vi.fn();
vi.mock('@/shared/store/notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({ addNotification: mockAddNotification }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MarkdownPreview 链接点击行为', () => {
  it('内部相对链接点击：preventDefault 且触发 onInternalLinkClick（resolve 为绝对路径）', async () => {
    const user = userEvent.setup();
    const onInternalLinkClick = vi.fn();
    render(
      <MarkdownPreview
        content="[guide](./guide.md)"
        theme="dark"
        basePath="/ws/proj/docs"
        onInternalLinkClick={onInternalLinkClick}
      />,
    );

    const link = screen.getByRole('link', { name: 'guide' });
    await user.click(link);
    expect(onInternalLinkClick).toHaveBeenCalledWith('/ws/proj/docs/guide.md');
  });

  it('外部 http 链接点击：不调用 onInternalLinkClick', async () => {
    const user = userEvent.setup();
    const onInternalLinkClick = vi.fn();
    render(
      <MarkdownPreview
        content="[site](https://example.com)"
        theme="dark"
        onInternalLinkClick={onInternalLinkClick}
      />,
    );

    const link = screen.getByRole('link', { name: 'site' });
    await user.click(link);
    expect(onInternalLinkClick).not.toHaveBeenCalled();
  });

  it('无 handler 且无 basePath：不崩溃并给出 toast 提示', async () => {
    const user = userEvent.setup();
    render(<MarkdownPreview content="[x](./a.md)" theme="dark" />);

    const link = screen.getByRole('link', { name: 'x' });
    await user.click(link);
    expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('外链 target=_blank（不回归）', () => {
    render(<MarkdownPreview content="[site](https://example.com)" theme="dark" />);
    const link = screen.getByRole('link', { name: 'site' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('内部链接点击时调用 preventDefault（阻断 webview 导航）', async () => {
    const user = userEvent.setup();
    const onInternalLinkClick = vi.fn();
    render(
      <MarkdownPreview
        content="[guide](./guide.md)"
        theme="dark"
        basePath="/ws/proj/docs"
        onInternalLinkClick={onInternalLinkClick}
      />,
    );

    const link = screen.getByRole('link', { name: 'guide' });
    // document 级监听在 React 根容器之后触发，此时 defaultPrevented 已是最终状态
    const docSpy = vi.fn();
    document.addEventListener('click', (e) => docSpy(e.defaultPrevented), { once: true });
    await user.click(link);
    expect(docSpy).toHaveBeenCalledWith(true);
    expect(onInternalLinkClick).toHaveBeenCalled();
  });

  it('外链点击时不调用 preventDefault（保持默认新窗口行为）', async () => {
    const user = userEvent.setup();
    const onInternalLinkClick = vi.fn();
    render(
      <MarkdownPreview
        content="[site](https://example.com)"
        theme="dark"
        onInternalLinkClick={onInternalLinkClick}
      />,
    );

    const link = screen.getByRole('link', { name: 'site' });
    const docSpy = vi.fn();
    document.addEventListener('click', (e) => docSpy(e.defaultPrevented), { once: true });
    await user.click(link);
    expect(docSpy).toHaveBeenCalledWith(false);
    expect(onInternalLinkClick).not.toHaveBeenCalled();
  });

  it('mailto 链接点击：不触发 onInternalLinkClick 也不 toast（保持默认行为）', async () => {
    const user = userEvent.setup();
    const onInternalLinkClick = vi.fn();
    render(
      <MarkdownPreview
        content="[mail](mailto:a@b.com)"
        theme="dark"
        onInternalLinkClick={onInternalLinkClick}
      />,
    );

    const link = screen.getByRole('link', { name: 'mail' });
    await user.click(link);
    expect(onInternalLinkClick).not.toHaveBeenCalled();
    expect(mockAddNotification).not.toHaveBeenCalled();
  });

  it('同页纯锚点 #section 点击：不 toast、不触发 onInternalLinkClick（放行默认滚动）', async () => {
    const user = userEvent.setup();
    const onInternalLinkClick = vi.fn();
    render(
      <MarkdownPreview
        content="[jump](#section)"
        theme="dark"
        onInternalLinkClick={onInternalLinkClick}
      />,
    );

    const link = screen.getByRole('link', { name: 'jump' });
    await user.click(link);
    expect(onInternalLinkClick).not.toHaveBeenCalled();
    expect(mockAddNotification).not.toHaveBeenCalled();
  });
});
