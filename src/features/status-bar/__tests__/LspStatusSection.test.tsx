import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRestart = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockStop = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRestartAll = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockStopAll = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetInfo = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    version: '1.97.1',
    commit: '8bab26f4',
    buildDate: '2026-07-14',
    memoryMb: 19.2,
  }),
);
const mockOpenLspLogConsole = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSetSessionState = vi.hoisted(() => vi.fn());
const mockRemoveSession = vi.hoisted(() => vi.fn());

vi.mock('@/features/lsp/api/lspApi', () => ({
  lspRestartSession: (...args: unknown[]) => mockRestart(...args),
  lspStopSession: (...args: unknown[]) => mockStop(...args),
  lspRestartAllSessions: (...args: unknown[]) => mockRestartAll(...args),
  lspStopAllSessions: (...args: unknown[]) => mockStopAll(...args),
  lspGetServerInfo: (...args: unknown[]) => mockGetInfo(...args),
}));

const lspHookState = vi.hoisted(() => ({
  sessions: {
    '/tmp/neeko': {
      rust: { languageId: 'rust', serverName: 'rust-analyzer', status: 'ready' },
      typescript: { languageId: 'typescript', serverName: 'ts-server', status: 'ready' },
    },
  },
  profiles: {},
  extensionConflicts: [],
  progressTokens: {},
}));

vi.mock('@/features/lsp/store/lspStore', () => ({
  useLspStore: Object.assign((sel: (s: Record<string, unknown>) => unknown) => sel(lspHookState), {
    getState: () => ({
      setSessionState: mockSetSessionState,
      removeSession: mockRemoveSession,
    }),
  }),
}));

vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ activeProject: { id: 'p1', path: '/tmp/neeko', name: 'neeko' } }),
}));
vi.mock('@/shared/store/taskStore', () => ({
  useTaskStore: (sel: (s: { openLspLogConsole: typeof mockOpenLspLogConsole }) => unknown) =>
    sel({ openLspLogConsole: mockOpenLspLogConsole }),
}));

vi.mock('@/shared/store/notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({ addNotification: vi.fn() }),
  },
}));

import { LspStatusSection } from '../LspStatusSection';

describe('LspStatusSection', () => {
  beforeEach(() => {
    mockRestart.mockClear();
    mockStop.mockClear();
    mockRestartAll.mockClear();
    mockStopAll.mockClear();
    mockGetInfo.mockClear();
    mockOpenLspLogConsole.mockClear();
    mockSetSessionState.mockClear();
    mockRemoveSession.mockClear();
  });

  it('should_show_server_icon_for_multi_server_chip', () => {
    render(<LspStatusSection />);
    const chip = screen.getByTestId('lsp-status-chip');
    // Multi-server chip shows a hover tooltip with the count, not a server name.
    expect(chip).toHaveAttribute('title', '2 LSPs');
    expect(chip).not.toHaveTextContent('rust-analyzer');
  });

  it('should_render_main_menu_and_batch_actions', async () => {
    render(<LspStatusSection />);
    fireEvent.click(screen.getByTestId('lsp-status-chip'));
    expect(await screen.findByTestId('lsp-status-dropdown')).toBeInTheDocument();
    expect(screen.getByText('neeko')).toBeInTheDocument();
    expect(screen.getByTestId('lsp-restart-all')).toBeInTheDocument();
    expect(screen.getByTestId('lsp-stop-all')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('lsp-restart-all'));
    await waitFor(() => {
      expect(mockRestartAll).toHaveBeenCalledWith('/tmp/neeko');
    });
  });

  it('should_open_submenu_and_view_logs', async () => {
    render(<LspStatusSection />);
    fireEvent.click(screen.getByTestId('lsp-status-chip'));
    fireEvent.mouseEnter(await screen.findByTestId('lsp-server-row-rust'));
    expect(await screen.findByTestId('lsp-server-submenu')).toBeInTheDocument();
    await waitFor(() => expect(mockGetInfo).toHaveBeenCalledWith('/tmp/neeko', 'rust'));

    fireEvent.click(screen.getByTestId('lsp-view-logs'));
    await waitFor(() => {
      expect(mockOpenLspLogConsole).toHaveBeenCalledWith({
        projectId: 'p1',
        projectPath: '/tmp/neeko',
        languageId: 'rust',
        serverName: 'rust-analyzer',
      });
    });
  });

  it('should_stop_all_sessions', async () => {
    render(<LspStatusSection />);
    fireEvent.click(screen.getByTestId('lsp-status-chip'));
    fireEvent.click(await screen.findByTestId('lsp-stop-all'));
    await waitFor(() => {
      expect(mockStopAll).toHaveBeenCalledWith('/tmp/neeko');
    });
    expect(mockRemoveSession).toHaveBeenCalled();
  });
});

describe('LspStatusSection busy chip', () => {
  it('starting 态 chip 显示加载状态文字', () => {
    lspHookState.sessions = {
      '/tmp/neeko': {
        rust: { languageId: 'rust', serverName: 'rust-analyzer', status: 'starting' },
      },
    };
    render(<LspStatusSection />);
    expect(screen.getByTestId('lsp-status-chip')).toHaveTextContent('rust-analyzer Starting');
  });

  it('indexing 态 chip 显示加载状态文字', () => {
    lspHookState.sessions = {
      '/tmp/neeko': {
        rust: { languageId: 'rust', serverName: 'rust-analyzer', status: 'indexing' },
      },
    };
    render(<LspStatusSection />);
    expect(screen.getByTestId('lsp-status-chip')).toHaveTextContent('rust-analyzer Indexing');
  });

  it('ready 态 chip 只显示服务器名', () => {
    lspHookState.sessions = {
      '/tmp/neeko': { rust: { languageId: 'rust', serverName: 'rust-analyzer', status: 'ready' } },
    };
    render(<LspStatusSection />);
    expect(screen.getByTestId('lsp-status-chip')).toHaveTextContent('rust-analyzer');
    expect(screen.getByTestId('lsp-status-chip')).not.toHaveTextContent('Starting');
  });
});

describe('LspStatusSection error state (M2 / AC2)', () => {
  beforeEach(() => {
    lspHookState.sessions = {
      '/tmp/neeko': {
        go: {
          languageId: 'go',
          serverName: 'gopls',
          status: 'error',
          statusMessage: 'gopls exited unexpectedly',
        },
      },
    };
    lspHookState.progressTokens = {};
  });

  it('error 态 chip 显示 message 而非只显示服务器名', () => {
    render(<LspStatusSection />);
    const chip = screen.getByTestId('lsp-status-chip');
    expect(chip).toHaveTextContent('gopls exited unexpectedly');
    // title 携带完整 message（hover 可读），不丢失崩溃文案
    expect(chip).toHaveAttribute('title', expect.stringContaining('gopls exited unexpectedly'));
  });

  it('error 态显示重试入口，点击复用 lspRestartSession 重启通道', async () => {
    render(<LspStatusSection />);
    const retry = screen.getByTestId('lsp-error-retry');
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => {
      expect(mockRestart).toHaveBeenCalledWith('/tmp/neeko', 'go');
    });
    // 重试触发乐观 starting 状态（lspStore.setSessionState）
    expect(mockSetSessionState).toHaveBeenCalledWith(
      '/tmp/neeko',
      'go',
      expect.objectContaining({ status: 'starting' }),
    );
  });

  it('ready 态不渲染重试按钮（仅 error 提供重试入口）', () => {
    lspHookState.sessions = {
      '/tmp/neeko': { go: { languageId: 'go', serverName: 'gopls', status: 'ready' } },
    };
    render(<LspStatusSection />);
    expect(screen.queryByTestId('lsp-error-retry')).not.toBeInTheDocument();
  });

  it('stopped 会话被过滤，不在状态栏显示', () => {
    lspHookState.sessions = {
      '/tmp/neeko': { go: { languageId: 'go', serverName: 'gopls', status: 'stopped' } },
    };
    const { container } = render(<LspStatusSection />);
    expect(screen.queryByTestId('lsp-status-chip')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('下拉行内也显示 error message（lsp-row-msg）', async () => {
    render(<LspStatusSection />);
    fireEvent.click(screen.getByTestId('lsp-status-chip'));
    const row = await screen.findByTestId('lsp-server-row-go');
    expect(row).toHaveTextContent('gopls');
    expect(screen.getByTestId('lsp-row-msg-go')).toHaveTextContent('gopls exited unexpectedly');
  });
});

describe('LspStatusSection progress tokens', () => {
  beforeEach(() => {
    lspHookState.progressTokens = {};
  });

  it('ready + open token 时 chip 显示 Indexing busy 态（不闪绿）', () => {
    lspHookState.sessions = {
      '/tmp/neeko': {
        java: { languageId: 'java', serverName: 'jdtls', status: 'ready' },
      },
    };
    lspHookState.progressTokens = { '/tmp/neeko': { java: ['import-1'] } };
    render(<LspStatusSection />);
    const chip = screen.getByTestId('lsp-status-chip');
    expect(chip).toHaveTextContent('jdtls Indexing');
    // busy 圆点：沿用 aggregate-busy/indexing 脉冲样式，不新增颜色语义
    // eslint-disable-next-line testing-library/no-node-access -- 圆点无 testid，只能查子元素类名
    expect(chip.querySelector('.bg-status-running')).not.toBeNull();
  });

  it('token 清空后 chip 回到 ready（只显示服务器名）', () => {
    lspHookState.sessions = {
      '/tmp/neeko': { java: { languageId: 'java', serverName: 'jdtls', status: 'ready' } },
    };
    lspHookState.progressTokens = { '/tmp/neeko': { java: [] } };
    render(<LspStatusSection />);
    const chip = screen.getByTestId('lsp-status-chip');
    expect(chip).toHaveTextContent('jdtls');
    expect(chip).not.toHaveTextContent('Indexing');
  });

  it('多会话聚合：任一会话 open token 非空即 aggregate-busy', () => {
    lspHookState.sessions = {
      '/tmp/neeko': {
        rust: { languageId: 'rust', serverName: 'rust-analyzer', status: 'ready' },
        java: { languageId: 'java', serverName: 'jdtls', status: 'ready' },
      },
    };
    lspHookState.progressTokens = { '/tmp/neeko': { java: ['import-1'] } };
    render(<LspStatusSection />);
    const chip = screen.getByTestId('lsp-status-chip');
    // eslint-disable-next-line testing-library/no-node-access -- 圆点无 testid，只能查子元素类名
    expect(chip.querySelector('.bg-status-running')).not.toBeNull();
    expect(chip).toHaveAttribute('title', '2 LSPs');
  });
});
