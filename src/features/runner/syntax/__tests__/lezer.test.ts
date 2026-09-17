// @vitest-environment node
import { readFileSync } from 'node:fs';

import { goLanguage } from '@codemirror/lang-go';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  childOfType,
  childrenOfType,
  createLineLookup,
  rawText,
  stringValue,
  walk,
  type SyntaxNode,
  type SyntaxTree,
} from '../lezer';

const SRC = [
  'package main', // L1
  '', // L2
  'func main() {}', // L3
  '', // L4
  'func mainHelper() {}', // L5
  '', // L6
  '// func main() {}', // L7
  '', // L8
  'var s = "a, b"', // L9
  '', // L10
  'var r = `raw`', // L11
  '', // L12
].join('\n');

let tree: SyntaxTree;

beforeEach(() => {
  tree = goLanguage.parser.parse(SRC);
});

const funcs = (): SyntaxNode[] => childrenOfType(tree.topNode, 'FunctionDecl');

describe('createLineLookup（1-based；O(n) 建索引一次 + O(log n) 查询）', () => {
  it('首行 = 1；声明的行号正确', () => {
    const lineAt = createLineLookup(SRC);
    expect(lineAt(0)).toBe(1);
    expect(funcs().map((f) => lineAt(f.from))).toEqual([3, 5]);
  });

  it('边界：行首 / 行中 / 末字符 / 越界位置都落对行', () => {
    const lineAt = createLineLookup(SRC);
    const lineOf = (needle: string): number => lineAt(SRC.indexOf(needle));
    expect(lineOf('func main')).toBe(3);
    expect(lineOf('main() {}')).toBe(3); // 行中位置
    expect(lineOf('var r = `raw`')).toBe(11);
    expect(lineAt(SRC.length)).toBe(SRC.split('\n').length); // 文档末尾 → 最后一行
  });

  it('索引只建一次 → 多次查询不随位置退化（取代逐次 O(pos) 扫描，避免聚合二次方）', () => {
    const big = `${'x = 1\n'.repeat(20000)}func TestT(t *testing.T) {}\n`;
    const lineAt = createLineLookup(big);
    const positions = Array.from({ length: 2000 }, (_, i) => i * 50);
    // 正确性：所有查询都落在合法行号区间（性能由独立 bench 量化，不在单测里做时间断言）
    const lines = positions.map((pos) => lineAt(pos));
    expect(lines.every((line) => line >= 1 && line <= 20001)).toBe(true);
    expect(lineAt(big.lastIndexOf('func TestT'))).toBe(20001);
  });
});

describe('childOfType / childrenOfType', () => {
  it('按类型取子节点；不存在 → null / 空数组', () => {
    const func = funcs()[0];
    expect(childOfType(func, 'DefName')?.type.name).toBe('DefName');
    expect(childOfType(func, 'NoSuchNode')).toBeNull();
    expect(childrenOfType(func, 'NoSuchNode')).toEqual([]);
    expect(funcs()).toHaveLength(2);
  });

  it('只取直接子节点，不下钻', () => {
    const func = funcs()[0];
    expect(childrenOfType(func, 'PackageClause')).toEqual([]);
    // 但 PackageClause 确实是 SourceFile 的直接子节点
    expect(childrenOfType(tree.topNode, 'PackageClause')).toHaveLength(1);
  });
});

describe('AST 相对行正则的优势（注释不误命中）', () => {
  it('注释里的 // func main() 不是 FunctionDecl', () => {
    expect(funcs().map((f) => rawText(SRC, childOfType(f, 'DefName')!))).toEqual([
      'main',
      'mainHelper',
    ]);
  });
});

describe('rawText', () => {
  it('取源码切片', () => {
    const func = funcs()[0];
    expect(rawText(SRC, func)).toBe('func main() {}');
    expect(rawText(SRC, childOfType(func, 'DefName')!)).toBe('main');
  });
});

describe('stringValue（剥配对引号；非字面量 → null）', () => {
  it('双引号与反引号都能剥；内容原样（不做反转义）', () => {
    const strings = findDescendantsOfType(tree.topNode, 'String');
    // Go：双引号与反引号都是 String 节点（实测）
    expect(strings.map((s) => stringValue(SRC, s))).toEqual(['a, b', 'raw']);
  });

  it('非字面量节点 → null（不猜）', () => {
    expect(stringValue(SRC, funcs()[0])).toBeNull(); // `func main() {}`
    expect(stringValue(SRC, childOfType(funcs()[0], 'DefName')!)).toBeNull(); // `main`
  });
});

/** 测试内的小工具（生产不需要批量收集，故不进 lezer.ts）。 */
function findDescendantsOfType(root: SyntaxNode, typeName: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  walk(root, (n) => {
    if (n.type.name === typeName) out.push(n);
  });
  return out;
}

describe('walk（迭代式前序遍历）', () => {
  it('访问全部节点，含深处的节点', () => {
    const seen: string[] = [];
    walk(tree.topNode, (n) => {
      seen.push(n.type.name);
    });
    expect(seen[0]).toBe('SourceFile');
    expect(seen.filter((n) => n === 'FunctionDecl')).toHaveLength(2);
    expect(seen).toContain('DefName');
  });

  it('深嵌套文档不爆栈（迭代实现，非递归）', () => {
    const deep = `package main\n\nvar x = ${'('.repeat(2000)}1${')'.repeat(2000)}\n`;
    const deepTree = goLanguage.parser.parse(deep);
    let count = 0;
    expect(() =>
      walk(deepTree.topNode, () => {
        count += 1;
      }),
    ).not.toThrow();
    expect(count).toBeGreaterThan(100);
  });
});

describe('依赖护栏（不直接 import @lezer/* 传递依赖）', () => {
  it('lezer.ts 无 @lezer/* 直接 import（pnpm 严格模式下会解析失败）', () => {
    const src = readFileSync('src/features/runner/syntax/lezer.ts', 'utf8');
    // 只看真正的 import 语句（注释里会提到 '@lezer/common' 作为说明，不算违规）
    const bad = src
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^import\b/.test(line) && /['"]@lezer\//.test(line));
    expect(bad).toEqual([]);
  });
});
