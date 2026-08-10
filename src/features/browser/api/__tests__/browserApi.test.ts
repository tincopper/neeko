import { describe, expect, it, vi } from 'vitest';

import { invoke } from '@/testing/tauriCore';

import { openInDefaultBrowser } from '../browserApi';

const mockInvoke = vi.mocked(invoke);

describe('openInDefaultBrowser', () => {
  it('passes url and projectId for file URLs', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await openInDefaultBrowser('file:///tmp/project/index.html', 'p1');
    expect(mockInvoke).toHaveBeenCalledWith('open_in_default_browser', {
      url: 'file:///tmp/project/index.html',
      projectId: 'p1',
    });
  });

  it('omits projectId for plain http(s) URLs', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await openInDefaultBrowser('https://github.com');
    expect(mockInvoke).toHaveBeenCalledWith('open_in_default_browser', {
      url: 'https://github.com',
      projectId: undefined,
    });
  });
});
