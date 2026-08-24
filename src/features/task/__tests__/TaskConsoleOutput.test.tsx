import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWriteTaskInput = vi.hoisted(() => vi.fn());

const appConfigRef = vi.hoisted(() => ({
  value: {
    terminalFontSize: 14,
    fontFamily: 'monospace',
  },
}));

const terminalMocks = vi.hoisted(() => {
  const instances: Array<{
    options: Record<string, unknown>;
    emitData: (data: string) => void;
  }> = [];

  class MockTerminal {
    readonly textarea = document.createElement('textarea');
    element: HTMLElement | null = null;
    cols = 80;
    rows = 24;
    private dataHandler: ((data: string) => void) | null = null;

    constructor(options: Record<string, unknown>) {
      instances.push({
        options,
        emitData: (data: string) => {
          this.dataHandler?.(data);
        },
      });
    }

    loadAddon() {}

    open(element: HTMLElement) {
      this.element = element;
    }

    write() {}

    reset() {}

    scrollToBottom() {}

    focus() {}

    dispose() {}

    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
      return {
        dispose: () => {
          this.dataHandler = null;
        },
      };
    }

    attachCustomKeyEventHandler() {}

    registerLinkProvider() {}
  }

  class MockFitAddon {
    fit() {}
  }

  class MockWebLinksAddon {}

  return { instances, MockTerminal, MockFitAddon, MockWebLinksAddon };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: terminalMocks.MockTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: terminalMocks.MockFitAddon,
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: terminalMocks.MockWebLinksAddon,
}));

vi.mock('../taskRunner', () => ({
  writeTaskInput: (...args: unknown[]) => mockWriteTaskInput(...args),
}));

vi.mock('@/shared/contexts/AppContext', () => ({
  useAppContext: () => ({ config: appConfigRef.value }),
}));

import type { TaskRun } from '@/shared/types/task';

import TaskConsoleOutput from '../components/TaskConsoleOutput';

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: 'run-1',
    projectId: 'proj-1',
    projectPath: '/tmp/proj',
    configId: 'cfg-1',
    name: 'build',
    command: 'pnpm build',
    status: 'running',
    processId: 'pty-1',
    output: '> pnpm build\r\n',
    exitCode: null,
    startedAt: 1,
    endedAt: null,
    source: 'task',
    ...overrides,
  };
}

describe('TaskConsoleOutput', () => {
  beforeEach(() => {
    terminalMocks.instances.length = 0;
    appConfigRef.value = {
      terminalFontSize: 14,
      fontFamily: 'monospace',
    };
    mockWriteTaskInput.mockClear();
  });

  it('should enable stdin and forward confirm input for a running task', () => {
    render(<TaskConsoleOutput run={makeRun()} active />);

    const terminal = terminalMocks.instances[0];
    expect(terminal.options.disableStdin).toBe(false);

    act(() => terminal.emitData('y\r'));

    expect(mockWriteTaskInput).toHaveBeenCalledWith('pty-1', 'y\r');
  });

  it('should attach input after the backend process id arrives', () => {
    const run = makeRun({ processId: null });
    const { rerender } = render(<TaskConsoleOutput run={run} active />);
    const terminal = terminalMocks.instances[0];

    act(() => terminal.emitData('y\r'));
    expect(mockWriteTaskInput).not.toHaveBeenCalled();

    rerender(<TaskConsoleOutput run={{ ...run, processId: 'pty-2' }} active />);

    act(() => terminal.emitData('n\r'));
    expect(mockWriteTaskInput).toHaveBeenCalledWith('pty-2', 'n\r');
  });

  it('should reattach input after font config changes recreate the terminal', () => {
    const run = makeRun();
    const { rerender } = render(<TaskConsoleOutput run={run} active />);
    const initialTerminal = terminalMocks.instances[0];

    act(() => initialTerminal.emitData('y\r'));
    expect(mockWriteTaskInput).toHaveBeenCalledWith('pty-1', 'y\r');

    appConfigRef.value = {
      terminalFontSize: 18,
      fontFamily: 'monospace',
    };
    rerender(<TaskConsoleOutput run={{ ...run, output: `${run.output}next\r\n` }} active />);

    expect(terminalMocks.instances).toHaveLength(2);
    const recreatedTerminal = terminalMocks.instances[1];
    act(() => recreatedTerminal.emitData('n\r'));

    expect(mockWriteTaskInput).toHaveBeenCalledWith('pty-1', 'n\r');
  });

  it('should keep an lsp log tab read-only', () => {
    render(
      <TaskConsoleOutput
        run={makeRun({ source: 'lsp', processId: null, status: 'running' })}
        active
      />,
    );

    const terminal = terminalMocks.instances[0];
    expect(terminal.options.disableStdin).toBe(true);

    act(() => terminal.emitData('y\r'));
    expect(mockWriteTaskInput).not.toHaveBeenCalled();
  });

  it('should keep a finished task read-only', () => {
    render(
      <TaskConsoleOutput run={makeRun({ status: 'idle', processId: null, endedAt: 2 })} active />,
    );

    const terminal = terminalMocks.instances[0];
    expect(terminal.options.disableStdin).toBe(true);

    act(() => terminal.emitData('y\r'));
    expect(mockWriteTaskInput).not.toHaveBeenCalled();
  });

  it('should stop forwarding input when a task enters stopping', () => {
    const run = makeRun();
    const { rerender } = render(<TaskConsoleOutput run={run} active />);
    const terminal = terminalMocks.instances[0];

    act(() => terminal.emitData('y\r'));
    expect(mockWriteTaskInput).toHaveBeenCalledTimes(1);

    rerender(
      <TaskConsoleOutput
        run={{ ...run, status: 'stopping', processId: null, endedAt: 2 }}
        active
      />,
    );

    act(() => terminal.emitData('n\r'));
    expect(mockWriteTaskInput).toHaveBeenCalledTimes(1);
  });
});
