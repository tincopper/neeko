import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  McpRegistryGeneratedConfig,
  McpRegistryServerSummary,
} from '@/features/library/api/libraryApi';
import { useMcpStore } from '@/features/library/store/mcpStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { invoke } from '@/testing/tauriCore';

import McpInstallDialog from '../McpInstallDialog';

const mockInvoke = vi.mocked(invoke);

function makeSummary(): McpRegistryServerSummary {
  return {
    name: 'com.example/fs',
    title: 'Filesystem',
    description: 'Filesystem access over MCP',
    version: '1.2.0',
    transports: ['stdio'],
    repository: 'https://github.com/example/fs',
    stars: null,
    downloads: null,
    inputs: [],
    status: 'active',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeDraft(): McpRegistryGeneratedConfig {
  return {
    name: 'com.example/fs',
    description: 'Filesystem access over MCP',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    env: [
      { name: 'LOG_LEVEL', isSecret: false, isRequired: false, default: 'info' },
      { name: 'API_KEY', isSecret: true, isRequired: true, default: null },
    ],
    transport: 'stdio',
    url: null,
    inputs: [],
  };
}

function openStore() {
  const createMcpServer = vi.fn(async () => {});
  const closeMcpInstall = vi.fn();
  const setMcpView = vi.fn();
  useMcpStore.setState({
    installOpen: true,
    mcpDraft: makeDraft(),
    mcpInstallSummary: {
      name: makeSummary().name,
      title: makeSummary().title,
      version: makeSummary().version,
      repository: makeSummary().repository,
    },
    createMcpServer,
    closeMcpInstall,
    setMcpView,
    refreshMcpServers: vi.fn(async () => {}),
    mcpServers: [],
    mcpServersLoading: false,
  });
  return { createMcpServer, closeMcpInstall, setMcpView };
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValueOnce([]); // list_mcp_servers
  useProjectStore.setState({ activeProjectId: null });
});

describe('McpInstallDialog — 精简安装对话框', () => {
  it('关闭状态不渲染', () => {
    useMcpStore.setState({ installOpen: false });
    render(<McpInstallDialog />);
    expect(screen.queryByText(/Install from Marketplace/)).not.toBeInTheDocument();
  });

  it('展示只读摘要（标题 / 版本 / 来源 / command / transport / 描述）', () => {
    openStore();
    render(<McpInstallDialog />);

    expect(screen.getByText('Filesystem')).toBeInTheDocument();
    expect(screen.getByText(/1\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText(/com\.example\/fs/)).toBeInTheDocument();
    expect(screen.getByText('npx')).toBeInTheDocument();
    expect(screen.getByText('stdio')).toBeInTheDocument();
    expect(screen.getByText('Filesystem access over MCP')).toBeInTheDocument();
  });

  it('渲染 secret env 输入（非 secret 不展示输入）并合并默认值落库', async () => {
    const { createMcpServer } = openStore();
    render(<McpInstallDialog />);

    // secret env 需要填写
    const apiKeyInput = screen.getByLabelText(/API_KEY/);
    expect(apiKeyInput).toBeInTheDocument();
    expect(screen.queryByLabelText(/LOG_LEVEL/)).not.toBeInTheDocument();

    fireEvent.change(apiKeyInput, { target: { value: 'sk-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => {
      expect(createMcpServer).toHaveBeenCalledWith({
        name: 'com.example/fs',
        description: 'Filesystem access over MCP',
        command: 'npx',
        url: null,
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: { LOG_LEVEL: 'info', API_KEY: 'sk-123' },
        transport: 'stdio',
        scope: 'global',
        projectId: null,
        sourceRegistry: 'registry.modelcontextprotocol.io',
        sourceRef: 'com.example/fs',
        tags: [],
      });
    });
  });

  it('remote（http）transport 显示 URL 摘要、不显示 command', () => {
    useMcpStore.setState({
      installOpen: true,
      mcpDraft: {
        ...makeDraft(),
        command: '',
        transport: 'http',
        url: 'https://api.example.com/mcp',
      },
      mcpInstallSummary: {
        name: 'com.example/fs',
        title: 'Filesystem',
        version: '1.0.0',
        repository: null,
      },
      createMcpServer: vi.fn(async () => {}),
      closeMcpInstall: vi.fn(),
      setMcpView: vi.fn(),
      refreshMcpServers: vi.fn(async () => {}),
    });
    render(<McpInstallDialog />);

    expect(screen.getByText('https://api.example.com/mcp')).toBeInTheDocument();
    expect(screen.queryByText('npx')).not.toBeInTheDocument();
  });

  it('remote（http）transport 落库时传递 url 且 command 为空', async () => {
    const { createMcpServer } = openStore();
    useMcpStore.setState({
      mcpDraft: {
        ...makeDraft(),
        command: '',
        transport: 'http',
        url: 'https://api.example.com/mcp',
      },
    });
    render(<McpInstallDialog />);

    fireEvent.change(screen.getByLabelText(/API_KEY/), { target: { value: 'sk-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => {
      expect(createMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'com.example/fs',
          command: '',
          url: 'https://api.example.com/mcp',
          transport: 'http',
        }),
      );
    });
  });

  it('关闭按钮调用 closeMcpInstall 并清空 draft', () => {
    const { closeMcpInstall } = openStore();
    render(<McpInstallDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(closeMcpInstall).toHaveBeenCalled();
  });
});
