import { render } from '@testing-library/react';
import mermaid from 'mermaid';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';
import { MarkdownPreview } from '@/ui/MarkdownPreview';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg></svg>' })),
  },
}));
vi.mock('plantuml-encoder', () => ({ default: { encode: vi.fn(() => 'abc') } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MermaidBlock 渲染 ID', () => {
  // 回归：React useId() 产出 ":r5i:" 这类含冒号的 ID，
  // mermaid 内部 querySelector('#<id>') 会报 "is not a valid selector"
  it('render id 必须是合法 CSS 选择器（不含冒号等非法字符）', async () => {
    render(<MarkdownPreview content={'```mermaid\ngraph TD;\n  A-->B;\n```'} theme="dark" />, {
      wrapper: createAppProviderWrapper(),
    });

    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    const id = vi.mocked(mermaid.render).mock.calls[0][0] as string;
    expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
  });
});
