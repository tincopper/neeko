import { describe, expect, it } from 'vitest';

import type { Project } from '@/shared/types';

import { buildLayoutId } from '../layoutId';

describe('buildLayoutId', () => {
  it('builds a local layout key', () => {
    const project = { id: 'p1', environment: { type: 'Local' } } as unknown as Project;
    expect(buildLayoutId(project, 'g1', 't1')).toBe('local:p1:g1:t1');
  });

  it('builds a wsl layout key with distro', () => {
    const project = {
      id: 'p1',
      environment: { type: 'Wsl', distro: 'Ubuntu' },
    } as unknown as Project;
    expect(buildLayoutId(project, 'g1', null)).toBe('wsl:Ubuntu:p1:g1:default');
  });

  it('builds a remote layout key with host', () => {
    const project = {
      id: 'p1',
      environment: { type: 'Remote', host: 'h1', port: 22, username: 'u' },
    } as unknown as Project;
    expect(buildLayoutId(project, 'g1', 't2')).toBe('remote:h1:p1:g1:t2');
  });

  it('falls back to none without a project', () => {
    expect(buildLayoutId(null, 'g1', 't1')).toBe('none:g1:t1');
  });
});
