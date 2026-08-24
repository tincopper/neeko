import { describe, expect, it } from 'vitest';

import { diffStats } from '../diffHighlight';

describe('diffStats', () => {
  it('counts added/removed lines from a unified diff', () => {
    const diff = [
      '@@ -12,3 +12,7 @@',
      ' pub trait AgentAdapter {',
      '-    /// Create a session bound to `ctx`.',
      '+    /// Create a session bound to `ctx`. Spawns or connects internally.',
      '+    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>, AppError>;',
      '+    fn capabilities(&self) -> Capabilities;',
      ' }',
    ].join('\n');
    expect(diffStats(diff)).toEqual({ add: 3, del: 1 });
  });

  it('ignores file header lines (---/+++)', () => {
    const diff = ['--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-old', '+new'].join('\n');
    expect(diffStats(diff)).toEqual({ add: 1, del: 1 });
  });

  it('returns zeros for empty or context-only diff', () => {
    expect(diffStats('')).toEqual({ add: 0, del: 0 });
    expect(diffStats('context line\nplain line')).toEqual({ add: 0, del: 0 });
  });
});
