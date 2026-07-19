import { describe, expect, it } from 'vitest';

import { resolveDebugHighlightLine } from '../hooks/useCurrentLineHighlight';

describe('resolveDebugHighlightLine', () => {
  it('should_return_null_when_no_stoppedAt', () => {
    expect(resolveDebugHighlightLine('/p/a.go', 'a.go', null, 'stopped')).toBeNull();
  });

  it('should_highlight_when_paths_match_and_stopped', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { filePath: '/Users/me/proj/main.go', line: 7 },
        'stopped',
      ),
    ).toBe(7);
  });

  it('should_not_highlight_when_session_running', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { filePath: '/Users/me/proj/main.go', line: 7 },
        'running',
      ),
    ).toBeNull();
  });

  it('should_not_highlight_when_terminated', () => {
    expect(
      resolveDebugHighlightLine(
        '/Users/me/proj/main.go',
        'main.go',
        { filePath: '/Users/me/proj/main.go', line: 7 },
        'terminated',
      ),
    ).toBeNull();
  });
});
