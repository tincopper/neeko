import { describe, expect, it } from 'vitest';

import { flattenFilePaths } from '../fileIndex';
import type { FileNode } from '@/shared/types';

describe('flattenFilePaths', () => {
  it('should_flatten_nested_files', () => {
    const tree: FileNode[] = [
      {
        name: 'src',
        path: 'src',
        is_dir: true,
        children: [
          { name: 'main.go', path: 'src/main.go', is_dir: false },
          {
            name: 'pkg',
            path: 'src/pkg',
            is_dir: true,
            children: [{ name: 'a.go', path: 'src/pkg/a.go', is_dir: false }],
          },
        ],
      },
      { name: 'README.md', path: 'README.md', is_dir: false },
    ];
    const paths = flattenFilePaths(tree);
    expect(paths).toContain('src/main.go');
    expect(paths).toContain('src/pkg/a.go');
    expect(paths).toContain('README.md');
    expect(paths).not.toContain('src');
  });
});
