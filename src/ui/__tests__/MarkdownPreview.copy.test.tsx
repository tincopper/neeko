import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';
import { MarkdownPreview } from '@/ui/MarkdownPreview';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));
vi.mock('plantuml-encoder', () => ({ default: { encode: vi.fn(() => 'abc') } }));

const mockWriteText = vi.fn(async () => {});
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: (text: string) => mockWriteText(text),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MarkdownPreview 代码块复制', () => {
  it('fenced code block 渲染复制按钮', () => {
    render(<MarkdownPreview content={'```ts\nconst a = 1;\n```'} theme="dark" />, {
      wrapper: createAppProviderWrapper(),
    });
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('点击复制按钮写入源码内容', async () => {
    const user = userEvent.setup();
    render(<MarkdownPreview content={'```ts\nconst a = 1;\n```'} theme="dark" />, {
      wrapper: createAppProviderWrapper(),
    });

    await user.click(screen.getByRole('button', { name: /copy/i }));
    expect(mockWriteText).toHaveBeenCalledWith('const a = 1;');
  });

  it('复制后按钮短暂显示已复制状态', async () => {
    const user = userEvent.setup();
    render(<MarkdownPreview content={'```py\nprint(1)\n```'} theme="dark" />, {
      wrapper: createAppProviderWrapper(),
    });

    const btn = screen.getByRole('button', { name: /copy/i });
    await user.click(btn);
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('无语言标注的代码块不渲染复制按钮（inline code）', () => {
    render(<MarkdownPreview content={'use `inline` code here'} theme="dark" />, {
      wrapper: createAppProviderWrapper(),
    });
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  it('mermaid 等特殊代码块不渲染复制按钮', () => {
    render(<MarkdownPreview content={'```mermaid\ngraph TD;\n  A-->B;\n```'} theme="dark" />, {
      wrapper: createAppProviderWrapper(),
    });
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });
});
