import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import ChangeFileTree, { buildChangeTree } from '@/shared/components/ChangeFileTree';
import type { ChangeFileItem } from '@/shared/components/ChangeFileTree';

describe('buildChangeTree', () => {
  it('builds flat tree for a root-level file', () => {
    const files: ChangeFileItem[] = [
      { path: 'main.ts', status: 'modified', additions: 5, deletions: 3 },
    ];
    const tree = buildChangeTree(files);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('main.ts');
    expect(tree[0].isDir).toBe(false);
    expect(tree[0].file).toBeDefined();
  });

  it('groups files into directories', () => {
    const files: ChangeFileItem[] = [
      { path: 'src/main.ts', status: 'modified' },
      { path: 'src/utils/helper.ts', status: 'added' },
    ];
    const tree = buildChangeTree(files);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('src');
    expect(tree[0].isDir).toBe(true);
    expect(tree[0].children).toHaveLength(2);

    const childNames = tree[0].children.map((c) => c.name);
    expect(childNames).toContain('main.ts');
    expect(childNames).toContain('utils');
  });

  it('sorts directories before files', () => {
    const files: ChangeFileItem[] = [
      { path: 'main.ts', status: 'modified' },
      { path: 'src/helper.ts', status: 'added' },
    ];
    const tree = buildChangeTree(files);
    expect(tree).toHaveLength(2);
    expect(tree[0].isDir).toBe(true);
    expect(tree[0].name).toBe('src');
    expect(tree[1].isDir).toBe(false);
    expect(tree[1].name).toBe('main.ts');
  });

  it('sorts children alphabetically within same level', () => {
    const files: ChangeFileItem[] = [
      { path: 'zeta.ts', status: 'modified' },
      { path: 'alpha.ts', status: 'added' },
      { path: 'beta.ts', status: 'removed' },
    ];
    const tree = buildChangeTree(files);
    expect(tree).toHaveLength(3);
    expect(tree[0].name).toBe('alpha.ts');
    expect(tree[1].name).toBe('beta.ts');
    expect(tree[2].name).toBe('zeta.ts');
  });

  it('handles deep nested paths', () => {
    const files: ChangeFileItem[] = [
      { path: 'a/b/c/d/file.ts', status: 'modified' },
    ];
    const tree = buildChangeTree(files);
    expect(tree[0].name).toBe('a');
    expect(tree[0].children[0].name).toBe('b');
    expect(tree[0].children[0].children[0].name).toBe('c');
    expect(tree[0].children[0].children[0].children[0].name).toBe('d');
    expect(tree[0].children[0].children[0].children[0].children[0].name).toBe('file.ts');
  });

  it('handles Windows backslash paths', () => {
    const files: ChangeFileItem[] = [
      { path: 'src\\utils\\helper.ts', status: 'added' },
    ];
    const tree = buildChangeTree(files);
    expect(tree[0].name).toBe('src');
    expect(tree[0].children[0].name).toBe('utils');
    expect(tree[0].children[0].children[0].name).toBe('helper.ts');
  });

  it('returns empty array for empty input', () => {
    const tree = buildChangeTree([]);
    expect(tree).toEqual([]);
  });

  it('merges files into same directory', () => {
    const files: ChangeFileItem[] = [
      { path: 'src/foo.ts', status: 'modified' },
      { path: 'src/bar.ts', status: 'added' },
      { path: 'src/baz.ts', status: 'removed' },
    ];
    const tree = buildChangeTree(files);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(3);
  });
});

describe('ChangeFileTree rendering', () => {
  const files: ChangeFileItem[] = [
    { path: 'src/main.ts', status: 'modified', additions: 5, deletions: 3 },
    { path: 'src/utils/helper.ts', status: 'added', additions: 10, deletions: 0 },
  ];

  it('renders file names in the tree', () => {
    render(<ChangeFileTree files={files} />);
    expect(screen.getByText('main.ts')).toBeInTheDocument();
    expect(screen.getByText('helper.ts')).toBeInTheDocument();
  });

  it('renders directory names', () => {
    render(<ChangeFileTree files={files} />);
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('utils')).toBeInTheDocument();
  });

  it('renders status badges by default', () => {
    render(<ChangeFileTree files={files} />);
    expect(screen.getByText('M')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('hides badges when showBadge is false', () => {
    render(<ChangeFileTree files={files} showBadge={false} />);
    expect(screen.queryByText('M')).not.toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('renders "No files changed" for empty files', () => {
    render(<ChangeFileTree files={[]} />);
    expect(screen.getByText('No files changed')).toBeInTheDocument();
  });

  it('renders status dots by default', () => {
    const { container } = render(<ChangeFileTree files={[files[0]]} />);
    const dots = container.querySelectorAll('.w-1\\.5.h-1\\.5');
    expect(dots.length).toBeGreaterThan(0);
  });

  it('hides status dots when showStatusDot is false', () => {
    const { container } = render(<ChangeFileTree files={[files[0]]} showStatusDot={false} />);
    const dots = container.querySelectorAll('.w-1\\.5.h-1\\.5');
    expect(dots.length).toBe(0);
  });

  it('adds selected class for selected file', () => {
    const { container } = render(
      <ChangeFileTree files={files} selectedPath="src/main.ts" />,
    );
    const rows = container.querySelectorAll('.flex.items-center.gap-1\\.5');
    let found = false;
    rows.forEach((row) => {
      if (row.className.includes('bg-accent-blue/10')) {
        found = true;
      }
    });
    expect(found).toBe(true);
  });
});
