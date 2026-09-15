import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildJavaRunCommand, junitLauncherJarName } from '../commands';
import type { JavaRunEnv } from '../env';
import { containerPath, parseJavaSymbols } from '../symbols';

/**
 * 夹具 = 真机捕获的**扁平** `SymbolInformation[]`（jdt.ls，Neeko 现状能力下：
 * 未声明 `hierarchicalDocumentSymbolSupport`）。来源见
 * `research/jdtls-runnables-probe.md` §7.7.3.1 与 /tmp/jdtls-flat-probe 探针。
 *
 * 对应源码（1-based 行）：
 *   6  public class AppTest {
 *   7      @Test                      ← top 的注解行
 *   8      void top() {}
 *  11      class L1 {                 ← @Nested
 *  12          @Test                  ← mid 的注解行
 *  13          void mid() {}
 *  16          class L2 {             ← @Nested
 *  17              @Test              ← deep 的注解行
 *  18              void deep() {}
 */
const flatPayload = (): unknown => [
  {
    name: 'top()',
    kind: 6,
    location: { uri: 'file:///p/AppTest.java', range: { start: { line: 7 }, end: { line: 7 } } },
    containerName: 'AppTest',
  },
  {
    name: 'mid()',
    kind: 6,
    location: { uri: 'file:///p/AppTest.java', range: { start: { line: 12 }, end: { line: 12 } } },
    containerName: 'L1',
  },
  {
    name: 'deep()',
    kind: 6,
    location: { uri: 'file:///p/AppTest.java', range: { start: { line: 17 }, end: { line: 17 } } },
    containerName: 'L2',
  },
  {
    name: 'L2',
    kind: 5,
    location: { uri: 'file:///p/AppTest.java', range: { start: { line: 15 }, end: { line: 15 } } },
    containerName: 'L1',
  },
  {
    name: 'L1',
    kind: 5,
    location: { uri: 'file:///p/AppTest.java', range: { start: { line: 10 }, end: { line: 10 } } },
    containerName: 'AppTest',
  },
  {
    // 顶层类的 container 是「文件名」——链推导的天然终止条件
    name: 'AppTest',
    kind: 5,
    location: { uri: 'file:///p/AppTest.java', range: { start: { line: 5 }, end: { line: 5 } } },
    containerName: 'AppTest.java',
  },
];

/** 同一份文档的**层级**形状（客户端声明 capability 时）——解析器须归一到同一张表。 */
const hierarchicalPayload = (): unknown => [
  {
    name: 'com.example',
    kind: 4,
    range: { start: { line: 0 }, end: { line: 0 } },
    selectionRange: { start: { line: 0 }, end: { line: 0 } },
  },
  {
    name: 'AppTest',
    kind: 5,
    range: { start: { line: 5 }, end: { line: 20 } },
    selectionRange: { start: { line: 5 }, end: { line: 5 } },
    children: [
      {
        name: 'top()',
        kind: 6,
        range: { start: { line: 7 }, end: { line: 8 } },
        selectionRange: { start: { line: 7 }, end: { line: 10 } },
      },
      {
        name: 'L1',
        kind: 5,
        range: { start: { line: 10 }, end: { line: 19 } },
        selectionRange: { start: { line: 10 }, end: { line: 11 } },
        children: [
          {
            name: 'mid()',
            kind: 6,
            range: { start: { line: 12 }, end: { line: 12 } },
            selectionRange: { start: { line: 12 }, end: { line: 13 } },
          },
          {
            name: 'L2',
            kind: 5,
            range: { start: { line: 15 }, end: { line: 18 } },
            selectionRange: { start: { line: 15 }, end: { line: 15 } },
            children: [
              {
                name: 'deep()',
                kind: 6,
                range: { start: { line: 17 }, end: { line: 17 } },
                selectionRange: { start: { line: 17 }, end: { line: 18 } },
              },
            ],
          },
        ],
      },
    ],
  },
];

describe('parseJavaSymbols', () => {
  it('扁平 SymbolInformation[] → 归一化表（名字剥括号、行号转 1-based、保留 containerName）', () => {
    expect(parseJavaSymbols(flatPayload())).toEqual([
      { name: 'top', kind: 6, line: 8, containerName: 'AppTest' },
      { name: 'mid', kind: 6, line: 13, containerName: 'L1' },
      { name: 'deep', kind: 6, line: 18, containerName: 'L2' },
      { name: 'L2', kind: 5, line: 16, containerName: 'L1' },
      { name: 'L1', kind: 5, line: 11, containerName: 'AppTest' },
      { name: 'AppTest', kind: 5, line: 6, containerName: 'AppTest.java' },
    ]);
  });

  it('层级 DocumentSymbol[] → 同一张表（containerName 由嵌套推出；最深层方法行取 selectionRange）', () => {
    const flat = parseJavaSymbols(flatPayload());
    const hierarchical = parseJavaSymbols(hierarchicalPayload());
    // 层级形状不含顶层类的 container 线索（package 与顶层类同层）→ 顶层类 containerName 缺省，
    // 因此只比对「方法链推导所需」的部分：方法名/行/容器
    const methodsOf = (list: ReturnType<typeof parseJavaSymbols>) =>
      list
        .filter((s) => s.kind === 6)
        .map(({ name, kind, line, containerName }) => ({
          name,
          kind,
          line,
          containerName,
        }));
    expect(methodsOf(hierarchical)).toEqual(methodsOf(flat));
  });

  it('畸形载荷一律空表（不抛错、不猜）', () => {
    const cases: unknown[] = [
      null,
      undefined,
      'not-an-array',
      {},
      [null, 1, 'x'],
      [{ name: 'NoRange', kind: 6 }],
      [{ kind: 6, location: { range: { start: { line: 1 } } } }],
      [{ name: 'BadRange', kind: 6, location: {} }],
    ];
    expect(cases.map((c) => parseJavaSymbols(c))).toEqual(cases.map(() => []));
  });
});

describe('containerPath（方法 → 内层类链，不含最外层类）', () => {
  const symbols = parseJavaSymbols(flatPayload());

  it('顶层方法 → 空链（最外层类由 deriveJavaFqcn 负责，不重复携带）', () => {
    expect(containerPath(symbols, 'top', 7)).toEqual([]);
  });

  it('一层 @Nested → ["L1"]', () => {
    expect(containerPath(symbols, 'mid', 12)).toEqual(['L1']);
  });

  it('两层 @Nested → ["L1","L2"]（外→内）', () => {
    expect(containerPath(symbols, 'deep', 17)).toEqual(['L1', 'L2']);
  });

  it('未知方法 → 空链（降级为现状表单）', () => {
    expect(containerPath(symbols, 'nope', 1)).toEqual([]);
  });

  it('同名方法：取「名字行 ≥ 注解行」的最近者，不串味', () => {
    // 两个类里都有 dup()：A 的名字行 10（1-based）、B 的名字行 20
    const dup = parseJavaSymbols([
      {
        name: 'Outer',
        kind: 5,
        location: { range: { start: { line: 0 }, end: { line: 0 } } },
        containerName: 'F.java',
      },
      {
        name: 'A',
        kind: 5,
        location: { range: { start: { line: 1 }, end: { line: 1 } } },
        containerName: 'Outer',
      },
      {
        name: 'B',
        kind: 5,
        location: { range: { start: { line: 11 }, end: { line: 11 } } },
        containerName: 'A',
      },
      {
        name: 'dup()',
        kind: 6,
        location: { range: { start: { line: 9 }, end: { line: 9 } } },
        containerName: 'A',
      },
      {
        name: 'dup()',
        kind: 6,
        location: { range: { start: { line: 19 }, end: { line: 19 } } },
        containerName: 'B',
      },
    ]);
    expect(containerPath(dup, 'dup', 9)).toEqual(['A']);
    expect(containerPath(dup, 'dup', 19)).toEqual(['A', 'B']);
  });
});

/**
 * 端到端：**真实 jdt.ls 载荷**（`fixtures/jdtls-document-symbol.json`，由本地 jdt.ls 在
 * **不声明** `documentSymbol` capability 时返回，与 Neeko 现状一致）→ 解析 → 链 → 完整命令选择器。
 *
 * 断言的选择器形态 `com.example.AppTest$InnerCases#testNested` 已由真机 Console Launcher
 * 1.14.4 验证「执行 1 个用例」（design §7.7.1）。本用例守的是**链路**：
 * 若 jdt.ls 改字段名/形状，或解析器/选择器漂移，这里立刻红。
 */
describe('e2e：真实 jdt.ls 载荷 → @Nested 选择器', () => {
  const realPayload: unknown = JSON.parse(
    readFileSync(resolve(__dirname, 'fixtures/jdtls-document-symbol.json'), 'utf8'),
  );
  const env: JavaRunEnv = {
    launcherPath: `/home/t/.neeko/${junitLauncherJarName()}`,
    readText: async () => null,
    classpathSeparator: ':',
  };

  it('testNested：链 = ["InnerCases"]，完整命令含真机可执行的 $ 选择器', async () => {
    const symbols = parseJavaSymbols(realPayload);
    // 夹具 src/com/example/AppTest.java 里 @Test 在第 12 行（1-based）——与 AST 发现产物同坐标系
    expect(containerPath(symbols, 'testNested', 12)).toEqual(['InnerCases']);

    const testCase = {
      name: 'testNested',
      line: 12,
      lang: 'java' as const,
      containerPath: ['InnerCases'],
    };
    const relPath = 'src/test/java/com/example/AppTest.java';
    // 环境事实（launcher / 分隔符）由语言模块解析后传入纯构造器；本用例只守选择器链路。
    const command = buildJavaRunCommand(testCase, relPath, '/proj', {
      deps: '',
      launcher: env.launcherPath ?? junitLauncherJarName(),
      separator: env.classpathSeparator,
    });

    expect(command).toContain("-m 'com.example.AppTest$InnerCases#testNested'");
  });

  it('testTop：顶层方法 → 空链，选择器无 $（与历史形态一致）', () => {
    const symbols = parseJavaSymbols(realPayload);
    expect(containerPath(symbols, 'testTop', 7)).toEqual([]);
  });
});
