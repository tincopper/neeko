import { describe, expect, it } from 'vitest';

import { deriveProjectName, isValidCloneUrl, sanitizeProjectName } from '../cloneFormUtils';

describe('deriveProjectName', () => {
  it('strips .git suffix', () => {
    expect(deriveProjectName('https://github.com/owner/repo.git')).toBe('repo');
  });

  it('handles trailing slash', () => {
    expect(deriveProjectName('https://github.com/owner/repo/')).toBe('repo');
    expect(deriveProjectName('https://github.com/owner/repo.git/')).toBe('repo');
  });

  it('handles scp-style git URLs', () => {
    expect(deriveProjectName('git@github.com:owner/repo.git')).toBe('repo');
    expect(deriveProjectName('git@github.com:repo')).toBe('repo');
  });

  it('handles nested paths', () => {
    expect(deriveProjectName('https://git.example.com/a/b/c.git')).toBe('c');
  });

  it('returns empty string for undeducible URLs', () => {
    expect(deriveProjectName('')).toBe('');
    expect(deriveProjectName('https://')).toBe('');
  });
});

describe('isValidCloneUrl', () => {
  it('accepts http/https/git@', () => {
    expect(isValidCloneUrl('https://github.com/owner/repo.git')).toBe(true);
    expect(isValidCloneUrl('http://example.com/repo.git')).toBe(true);
    expect(isValidCloneUrl('git@github.com:owner/repo.git')).toBe(true);
  });

  it('rejects unsupported or empty input', () => {
    expect(isValidCloneUrl('')).toBe(false);
    expect(isValidCloneUrl('ftp://example.com/repo')).toBe(false);
    expect(isValidCloneUrl('github.com/owner/repo')).toBe(false);
    expect(isValidCloneUrl('/local/path')).toBe(false);
  });
});

describe('sanitizeProjectName', () => {
  it('replaces disallowed characters with dashes', () => {
    expect(sanitizeProjectName('my repo!')).toBe('my-repo-');
    expect(sanitizeProjectName('  repo.name_x  ')).toBe('repo.name_x');
    expect(sanitizeProjectName('中文/项目')).toBe('-----');
  });
});
