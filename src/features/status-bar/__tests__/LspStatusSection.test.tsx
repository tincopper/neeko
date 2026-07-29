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

vi.mock('@/shared/store/lspStore', () => ({
  useLspStore: {
    getState: () => ({
      setSessionState: mockSetSessionState,
      removeSession: mockRemoveSession,
    }),
  },
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

import type { LspSessionState } from '@/shared/store/lspStore';

import { LspStatusSection } from '../LspStatusSection';

const sessions: LspSessionState[] = [
  {
    languageId: 'rust',
    serverName: 'rust-analyzer',
    status: 'ready',
  },
  {
    languageId: 'typescript',
    serverName: 'ts-server',
    status: 'ready',
  },
];

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
    render(
      <LspStatusSection
        activeProjectPath="/tmp/neeko"
        activeProjectId="p1"
        projectName="neeko"
        sessionEntries={sessions}
      />,
    );
    const chip = screen.getByTestId('lsp-status-chip');
    // Multi-server chip shows a hover tooltip with the count, not a server name.
    expect(chip).toHaveAttribute('title', '2 LSPs');
    expect(chip).not.toHaveTextContent('rust-analyzer');
  });

  it('should_render_main_menu_and_batch_actions', async () => {
    render(
      <LspStatusSection
        activeProjectPath="/tmp/neeko"
        activeProjectId="p1"
        projectName="neeko"
        sessionEntries={sessions}
      />,
    );
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
    render(
      <LspStatusSection
        activeProjectPath="/tmp/neeko"
        activeProjectId="p1"
        projectName="neeko"
        sessionEntries={sessions}
      />,
    );
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
    render(
      <LspStatusSection
        activeProjectPath="/tmp/neeko"
        activeProjectId="p1"
        projectName="neeko"
        sessionEntries={sessions}
      />,
    );
    fireEvent.click(screen.getByTestId('lsp-status-chip'));
    fireEvent.click(await screen.findByTestId('lsp-stop-all'));
    await waitFor(() => {
      expect(mockStopAll).toHaveBeenCalledWith('/tmp/neeko');
    });
    expect(mockRemoveSession).toHaveBeenCalled();
  });
});
