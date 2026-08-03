import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { invoke } from '@/testing/tauriCore';

import McpMarketplaceContent from '../McpMarketplaceContent';

const mockInvoke = vi.mocked(invoke);

function makeServer(
  name: string,
  overrides: Partial<{ stars: number | null; downloads: number | null }> = {},
) {
  return {
    name,
    title: name.split('/').pop() ?? name,
    description: 'test server',
    version: '1.0.0',
    transports: ['stdio'],
    repository: null,
    stars: null,
    downloads: null,
    inputs: [],
    status: 'active',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makePage(servers: string[], nextCursor: string | null) {
  return { servers: servers.map(makeServer), nextCursor };
}

beforeEach(() => {
  useLibraryStore.setState({
    mcpView: 'marketplace',
    searchQuery: '',
    mcpMarketplaceCount: 0,
    mcpServers: [],
  });
  mockInvoke.mockReset();
});

describe('McpMarketplaceContent — 翻页', () => {
  it('renders page 1 then advances to page 2 on next click', async () => {
    mockInvoke
      .mockResolvedValueOnce(makePage(['com.example/fs'], 'cursor-2'))
      .mockResolvedValueOnce(makePage(['com.example/db'], null));

    render(<McpMarketplaceContent />);

    await waitFor(() => {
      expect(screen.getByText('fs')).toBeInTheDocument();
    });

    const nextButton = screen.getByTitle('Next page');
    expect(nextButton).toBeEnabled();
    // 新分页条：页码 + 数量（与 Skills 市场 Pagination 同构）
    expect(screen.getByText(/Page 1 · 1 server/)).toBeInTheDocument();

    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText('db')).toBeInTheDocument();
    });
    expect(screen.queryByText('fs')).not.toBeInTheDocument();
    expect(screen.getByText(/Page 2 · 1 server/)).toBeInTheDocument();

    // Verify cursor was passed to the backend
    expect(mockInvoke).toHaveBeenCalledWith(
      'search_mcp_registry_cmd',
      expect.objectContaining({ cursor: 'cursor-2' }),
    );
  });

  it('shows empty state when no results', async () => {
    mockInvoke.mockResolvedValueOnce(makePage([], null));

    render(<McpMarketplaceContent />);

    await waitFor(() => {
      expect(screen.getByText('No servers available')).toBeInTheDocument();
    });
  });

  it('perPage 选择切换后以新 limit 重新取第一页', async () => {
    mockInvoke
      .mockResolvedValueOnce(makePage(['com.example/a'], 'cursor-x'))
      .mockResolvedValueOnce(makePage(['com.example/b'], null));

    render(<McpMarketplaceContent />);

    await waitFor(() => {
      expect(screen.getByText('a')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTitle('Per page'), { target: { value: '40' } });

    await waitFor(() => {
      expect(screen.getByText('b')).toBeInTheDocument();
    });
    expect(mockInvoke).toHaveBeenLastCalledWith(
      'search_mcp_registry_cmd',
      expect.objectContaining({ limit: 40, cursor: null }),
    );
    expect(screen.getByText(/Page 1 · 1 server/)).toBeInTheDocument();
  });
});

describe('McpMarketplaceContent — 安装流程', () => {
  it('点击 Install 打开精简安装对话框（而非完整编辑器）', async () => {
    useLibraryStore.setState({ installOpen: false, editorOpen: false, mcpDraft: null });
    mockInvoke.mockResolvedValueOnce(makePage(['com.example/fs'], null)).mockResolvedValueOnce({
      summary: makeServer('com.example/fs'),
      generated: {
        name: 'com.example/fs',
        description: 'test server',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: [],
        transport: 'stdio',
        url: null,
        inputs: [],
      },
      raw: {},
    });

    render(<McpMarketplaceContent />);

    await waitFor(() => {
      expect(screen.getByText('fs')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => {
      expect(useLibraryStore.getState().installOpen).toBe(true);
      expect(useLibraryStore.getState().mcpDraft).not.toBeNull();
      expect(useLibraryStore.getState().mcpInstallSummary?.title).toBe('fs');
    });
    // 安装走独立对话框，不再打开完整编辑表单
    expect(useLibraryStore.getState().editorOpen).toBe(false);
  });
});
