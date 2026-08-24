import { emit } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReportFrontendError = vi.hoisted(() => vi.fn());

vi.mock('@/shared/utils/errorReporting', () => ({
  reportFrontendError: mockReportFrontendError,
}));

import { terminalInputEvent } from '@/shared/utils/terminalEvents';

import { formatTaskExit, formatTaskHeader, writeTaskInput } from '../taskRunner';

describe('writeTaskInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit UTF-8 bytes to the task terminal-input event', () => {
    writeTaskInput('pty-1', 'y\r');

    expect(emit).toHaveBeenCalledWith(terminalInputEvent('pty-1'), [121, 13]);
  });

  it('should encode unicode task input as UTF-8 bytes', () => {
    writeTaskInput('pty-1', '是');

    expect(emit).toHaveBeenCalledWith(terminalInputEvent('pty-1'), [230, 152, 175]);
  });

  it('should report input emit failures', async () => {
    vi.mocked(emit).mockRejectedValueOnce(new Error('emit failed'));

    writeTaskInput('pty-1', 'y\r');

    await vi.waitFor(() => {
      expect(mockReportFrontendError).toHaveBeenCalledWith(
        'task.writeTaskInput',
        expect.any(Error),
      );
    });
  });
});

describe('formatTaskHeader', () => {
  it('should_include_command_and_cwd', () => {
    const text = formatTaskHeader('pnpm test', '/tmp/proj');
    expect(text).toContain('pnpm test');
    expect(text).toContain('/tmp/proj');
    expect(text).toContain('>');
  });

  it('should_omit_cwd_line_when_empty', () => {
    const text = formatTaskHeader('echo hi', '');
    expect(text).toContain('echo hi');
    expect(text).not.toContain('cwd:');
  });
});

describe('formatTaskExit', () => {
  it('should_mark_success_exit', () => {
    expect(formatTaskExit(0)).toContain('code 0');
  });

  it('should_mark_failure_exit', () => {
    expect(formatTaskExit(1)).toContain('code 1');
  });
});
