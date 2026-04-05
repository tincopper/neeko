import { describe, it, expect } from 'vitest';
import { buildTree } from '../FileTree';
import type { FileChange } from '../../../types';

function makeFile(path: string, status: "Added" | "Modified" | "Deleted" = "Modified"): FileChange {
  return {
    path,
    status,
    additions: 0,
    deletions: 0,
  };
}

describe('buildTree', () => {
  it('should return empty array for empty input', () => {
    const result = buildTree([]);
    expect(result).toEqual([]);
  });

  it('should create a single file node', () => {
    const result = buildTree([makeFile('src/main.rs')]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('src');
    expect(result[0].isDir).toBe(true);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].name).toBe('main.rs');
    expect(result[0].children[0].isDir).toBe(false);
  });

  it('should sort directories before files', () => {
    const result = buildTree([
      makeFile('z_file.txt'),
      makeFile('a_dir/file.txt'),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('a_dir');
    expect(result[0].isDir).toBe(true);
    expect(result[1].name).toBe('z_file.txt');
    expect(result[1].isDir).toBe(false);
  });

  it('should sort alphabetically within same type', () => {
    const result = buildTree([
      makeFile('z_file.rs'),
      makeFile('a_file.rs'),
      makeFile('m_file.rs'),
    ]);
    expect(result[0].name).toBe('a_file.rs');
    expect(result[1].name).toBe('m_file.rs');
    expect(result[2].name).toBe('z_file.rs');
  });

  it('should handle nested paths', () => {
    const result = buildTree([
      makeFile('src/components/Button.tsx'),
      makeFile('src/utils/helpers.ts'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('src');
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children[0].name).toBe('components');
    expect(result[0].children[1].name).toBe('utils');
  });

  it('should compact single-child directory chains', () => {
    const result = buildTree([
      makeFile('com/example/app/Main.java'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('com');
    expect(result[0].compactName).toBe('com.example.app');
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].name).toBe('Main.java');
  });

  it('should compact top level when only one child dir exists', () => {
    const result = buildTree([
      makeFile('com/example/app/Main.java'),
      makeFile('com/example/util/Helper.java'),
    ]);
    // com has only 1 child (example), so com.example gets compacted
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('com');
    expect(result[0].compactName).toBe('com.example');
    // example has 2 children, so no further compaction
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children[0].name).toBe('app');
    expect(result[0].children[1].name).toBe('util');
  });

  it('should handle Windows-style backslash paths', () => {
    const result = buildTree([makeFile('src\\components\\Button.tsx')]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('src');
    // src has only 1 child chain, so it gets compacted
    expect(result[0].compactName).toBe('src.components');
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].name).toBe('Button.tsx');
  });

  it('should preserve file metadata', () => {
    const file = makeFile('src/main.rs', 'Added');
    const result = buildTree([file]);
    const leaf = result[0].children[0];
    expect(leaf.file).toBe(file);
    expect(leaf.file?.status).toBe('Added');
  });

  it('should handle multiple files at root level', () => {
    const result = buildTree([
      makeFile('README.md'),
      makeFile('Cargo.toml'),
      makeFile('src/main.rs'),
    ]);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('src');
    expect(result[1].name).toBe('Cargo.toml');
    expect(result[2].name).toBe('README.md');
  });

  it('should set correct path for nested files (with compaction)', () => {
    const result = buildTree([makeFile('src/utils/helpers.ts')]);
    // Single-child chain gets compacted
    expect(result[0].name).toBe('src');
    expect(result[0].compactName).toBe('src.utils');
    // Path points to the leaf after compaction
    expect(result[0].path).toBe('src/utils');
    expect(result[0].children[0].path).toBe('src/utils/helpers.ts');
  });

  it('should handle files with same directory prefix', () => {
    const result = buildTree([
      makeFile('src/main.rs'),
      makeFile('src/lib.rs'),
      makeFile('src/utils/mod.rs'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('src');
    expect(result[0].children).toHaveLength(3);
    expect(result[0].children[0].name).toBe('utils');
    expect(result[0].children[1].name).toBe('lib.rs');
    expect(result[0].children[2].name).toBe('main.rs');
  });
});
