import { describe, expect, it } from 'vitest';

import type { FileTreeViewNode } from '@/shared/types';
import { viewNodeFingerprint } from '@/shared/utils/fileTree';

import { compactJavaPackages, isJavaSourceRoot, isUnderJavaSourceRoot } from '../javaPackageTree';

describe('compactJavaPackages 包视图压行（方案A）', () => {
  const vdir = (
    name: string,
    path: string,
    children: FileTreeViewNode[] = [],
  ): FileTreeViewNode => ({
    name,
    path,
    is_dir: true,
    children,
    is_expanded: children.length > 0,
  });
  const vfile = (name: string, path: string): FileTreeViewNode => ({
    name,
    path,
    is_dir: false,
    children: [],
  });

  it('单子目录链压成点分包行（path 取叶子）', () => {
    const tree = [
      vdir('java', 'm/src/main/java', [
        vdir('com', 'm/src/main/java/com', [
          vdir('example', 'm/src/main/java/com/example', [
            vfile('App.java', 'm/src/main/java/com/example/App.java'),
          ]),
        ]),
      ]),
    ];
    const out = compactJavaPackages(tree);
    const merged = out[0].children[0];
    expect(merged.name).toBe('com.example');
    expect(merged.path).toBe('m/src/main/java/com/example');
    expect(merged.children.map((c) => c.name)).toEqual(['App.java']);
  });

  it('中间层含文件即断链（文件与子包并列）', () => {
    const tree = [
      vdir('java', 'm/src/main/java', [
        vdir('com', 'm/src/main/java/com', [
          vdir('foo', 'm/src/main/java/com/foo', [
            vfile('Bar.java', 'm/src/main/java/com/foo/Bar.java'),
            vdir('bar', 'm/src/main/java/com/foo/bar'),
          ]),
        ]),
      ]),
    ];
    const out = compactJavaPackages(tree);
    const merged = out[0].children[0];
    expect(merged.name).toBe('com.foo');
    expect(merged.children.map((c) => c.name).sort()).toEqual(['Bar.java', 'bar']);
  });

  it('多子目录不断链外不合并', () => {
    const tree = [
      vdir('java', 'm/src/main/java', [
        vdir('com', 'm/src/main/java/com', [
          vdir('a', 'm/src/main/java/com/a'),
          vdir('b', 'm/src/main/java/com/b'),
        ]),
      ]),
    ];
    const out = compactJavaPackages(tree);
    expect(out[0].children[0].name).toBe('com');
    expect(out[0].children[0].children.map((c) => c.name).sort()).toEqual(['a', 'b']);
  });

  it('非 java 源根链保持原样', () => {
    const tree = [
      vdir('src', 'src', [vdir('components', 'src/components', [vdir('a', 'src/components/a')])]),
    ];
    const out = compactJavaPackages(tree);
    expect(out[0].children[0].name).toBe('components');
  });

  it('未加载（children 为空）的目录不合并', () => {
    const tree = [vdir('java', 'm/src/main/java', [vdir('com', 'm/src/main/java/com')])];
    const out = compactJavaPackages(tree);
    expect(out[0].children[0].name).toBe('com');
  });

  it('合并节点打上子树指纹（memo 可判定更新）', () => {
    const tree = [
      vdir('java', 'm/src/main/java', [
        vdir('com', 'm/src/main/java/com', [
          vdir('example', 'm/src/main/java/com/example', [
            vfile('App.java', 'm/src/main/java/com/example/App.java'),
          ]),
        ]),
      ]),
    ];
    const merged = compactJavaPackages(tree)[0].children[0];
    expect(merged.name).toBe('com.example');
    expect(viewNodeFingerprint(merged)).not.toBe('');
  });
});

describe('isUnderJavaSourceRoot', () => {
  it('识别源根自身', () => {
    expect(isJavaSourceRoot('m/src/main/java')).toBe(true);
    expect(isJavaSourceRoot('m/src/test/java')).toBe(true);
    expect(isJavaSourceRoot('m/src/main/java/com')).toBe(false);
    expect(isJavaSourceRoot('src/main')).toBe(false);
  });

  it('识别 main/test 源根下路径（源根自身除外，包行挂其下）', () => {
    expect(isUnderJavaSourceRoot('m/src/main/java/com')).toBe(true);
    expect(isUnderJavaSourceRoot('m/src/test/java/com/example')).toBe(true);
    expect(isUnderJavaSourceRoot('m/src/main/java')).toBe(false);
  });

  it('拒绝非源根路径', () => {
    expect(isUnderJavaSourceRoot('m/src/main')).toBe(false);
    expect(isUnderJavaSourceRoot('src/components/a')).toBe(false);
    expect(isUnderJavaSourceRoot('')).toBe(false);
  });
});
