import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks for API layer ────────────────────────────────────────────

const hoisted = vi.hoisted(() => {
  const sampleConfigs: TaskConfig[] = [
    { id: 'cfg-dev', name: 'dev', command: 'pnpm dev', scope: 'project', project_id: 'proj-1' },
    {
      id: 'cfg-build',
      name: 'build',
      command: 'pnpm build',
      scope: 'project',
      project_id: 'proj-1',
    },
  ];
  const mockLoadConfigs = vi.fn().mockResolvedValue(sampleConfigs);
  const mockLoadDiscovered = vi.fn().mockResolvedValue([]);
  const mockStartTaskProcess = vi.fn().mockResolvedValue({ processId: 'pty-1', dispose: vi.fn() });
  const mockStopTaskProcess = vi.fn().mockResolvedValue(undefined);
  return {
    sampleConfigs,
    mockLoadConfigs,
    mockLoadDiscovered,
    mockStartTaskProcess,
    mockStopTaskProcess,
  };
});

const {
  sampleConfigs,
  mockLoadConfigs,
  mockLoadDiscovered,
  mockStartTaskProcess,
  mockStopTaskProcess,
} = hoisted;

vi.mock('../api/taskApi', () => ({
  getTaskConfigs: (...args: unknown[]) => mockLoadConfigs(...args),
  discoverTaskConfigs: (...args: unknown[]) => mockLoadDiscovered(...args),
  importDiscoveredTask: vi.fn().mockResolvedValue({}),
  saveTaskConfig: vi.fn().mockResolvedValue(undefined),
  deleteTaskConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../taskRunner', () => ({
  startTaskProcess: (...args: unknown[]) => mockStartTaskProcess(...args),
  stopTaskProcess: (...args: unknown[]) => mockStopTaskProcess(...args),
  formatTaskHeader: (cmd: string) => `> ${cmd}\n`,
  formatTaskExit: (code: number) => `[exit ${code}]\n`,
}));

vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      activeProject: { id: 'proj-1', path: '/tmp/proj', name: 'proj' },
      projects: [{ id: 'proj-1', path: '/tmp/proj', name: 'proj' }],
      activeProjectId: 'proj-1',
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/shared/utils/bottomPanelExclusive', () => ({
  exclusiveOpenTaskConsole: vi.fn(),
  registerTaskConsoleCloser: vi.fn(),
}));

// ── SUT ────────────────────────────────────────────────────────────────────

import { useTaskStore } from '@/shared/store/taskStore';
import type { TaskConfig, TaskRun } from '@/shared/types/task';

import TaskRunButton from '../components/TaskRunButton';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRunningSession(configId: string, status: 'running' | 'stopping' = 'running'): TaskRun {
  return {
    id: `run-${configId}`,
    projectId: 'proj-1',
    projectPath: '/tmp/proj',
    configId,
    name: 'task',
    command: 'cmd',
    status,
    processId: status === 'running' ? 'pty-1' : null,
    output: '',
    exitCode: null,
    startedAt: Date.now(),
    endedAt: status === 'stopping' ? Date.now() : null,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TaskRunButton — dropdown status icon', () => {
  beforeEach(() => {
    mockLoadConfigs.mockClear().mockResolvedValue(sampleConfigs);
    mockLoadDiscovered.mockClear().mockResolvedValue([]);
    mockStartTaskProcess.mockClear().mockResolvedValue({ processId: 'pty-1', dispose: vi.fn() });
    mockStopTaskProcess.mockClear().mockResolvedValue(undefined);

    useTaskStore.setState({
      configs: sampleConfigs,
      discovered: [],
      discovering: false,
      selectedConfigId: 'cfg-dev',
      consoleSessions: [],
      consolePanelOpen: false,
      activeConsoleId: null,
    });
  });

  // Helper: open dropdown and find the row containing the given text.
  // Uses getAllByRole + filter to avoid direct DOM node access (.closest).
  async function openDropdown() {
    fireEvent.click(screen.getByTitle('Task list'));
    await screen.findByText('Saved');
  }

  function findRowByText(text: string): HTMLElement {
    const rows = screen.getAllByRole('option');
    const row = rows.find((r) => within(r).queryByText(text));
    if (!row) throw new Error(`Row containing "${text}" not found`);
    return row;
  }

  it('should show green play icon for idle task in dropdown', async () => {
    render(<TaskRunButton />);
    await waitFor(() => expect(mockLoadConfigs).toHaveBeenCalled());

    await openDropdown();
    const buildRow = findRowByText('build');
    const playIcon = within(buildRow).getByTestId('status-icon-play');
    expect(playIcon).toHaveClass('text-accent-green');
  });

  it('should show red square icon for running task in dropdown', async () => {
    useTaskStore.setState({
      consoleSessions: [makeRunningSession('cfg-dev', 'running')],
    });

    render(<TaskRunButton />);
    await waitFor(() => expect(mockLoadConfigs).toHaveBeenCalled());

    await openDropdown();
    const devRow = findRowByText('dev');
    const squareIcon = within(devRow).getByTestId('status-icon-square');
    expect(squareIcon).toHaveClass('text-accent-red');
  });

  it('should show spinning loader for stopping task in dropdown', async () => {
    useTaskStore.setState({
      consoleSessions: [makeRunningSession('cfg-dev', 'stopping')],
    });

    render(<TaskRunButton />);
    await waitFor(() => expect(mockLoadConfigs).toHaveBeenCalled());

    await openDropdown();
    const devRow = findRowByText('dev');
    const loaderIcon = within(devRow).getByTestId('status-icon-loader');
    expect(loaderIcon).toHaveClass('text-accent-yellow');
    expect(loaderIcon).toHaveClass('animate-spin');
  });

  it('should show mixed status icons for multiple tasks', async () => {
    useTaskStore.setState({
      consoleSessions: [makeRunningSession('cfg-dev', 'running')],
    });

    render(<TaskRunButton />);
    await waitFor(() => expect(mockLoadConfigs).toHaveBeenCalled());

    await openDropdown();

    // dev = running → Square
    const devRow = findRowByText('dev');
    expect(within(devRow).getByTestId('status-icon-square')).toHaveClass('text-accent-red');

    // build = idle → Play
    const buildRow = findRowByText('build');
    expect(within(buildRow).getByTestId('status-icon-play')).toHaveClass('text-accent-green');
  });

  it('should transition icon from square to loader when task enters stopping', async () => {
    useTaskStore.setState({
      consoleSessions: [makeRunningSession('cfg-dev', 'running')],
    });

    render(<TaskRunButton />);
    await waitFor(() => expect(mockLoadConfigs).toHaveBeenCalled());

    await openDropdown();
    const devRow = findRowByText('dev');

    // Initially running → Square
    expect(within(devRow).getByTestId('status-icon-square')).toHaveClass('text-accent-red');

    // Simulate user clicking stop → status becomes 'stopping'.
    act(() => {
      useTaskStore.setState({
        consoleSessions: [makeRunningSession('cfg-dev', 'stopping')],
      });
    });

    // Now should show the spinning loader.
    expect(within(devRow).getByTestId('status-icon-loader')).toHaveClass('animate-spin');
  });
});
