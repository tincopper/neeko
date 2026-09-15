import { describe, expect, it } from 'vitest';

import { discoverRunTargets } from '../../index';
import { sanitizeGoSubtestName } from '../table';

/** 走**公共发现路径**（`discoverRunTargets`）而非模块内部入口 —— 顺带覆盖接线：
    子测试与顶层用例由 `discoverGoTests` 的**单次遍历**共同产出。 */
const discover = (fileName: string, doc: string) =>
  discoverRunTargets(fileName, doc).tests.filter((c) => c.name.includes('/'));

/** 用户提供的表格驱动夹具（Fibonacci），位置式元素 + `t.Run(tt.name, …)`。 */
const FIB = [
  'package fibprobe', // L1
  '', // L2
  'import "testing"', // L3
  '', // L4
  'func Fib(n int) int { return n }', // L5
  '', // L6
  'func TestFib(t *testing.T) {', // L7
  '\ttests := []struct {', // L8
  '\t\tname     string', // L9
  '\t\tinput    int', // L10
  '\t\texpected int', // L11
  '\t}{', // L12
  '\t\t{"Negative input", -5, 0},', // L13
  '\t\t{"Zero input", 0, 0},', // L14
  '\t\t{"Base case 1", 1, 1},', // L15
  '\t\t{"Base case 2", 2, 1},', // L16
  '\t\t{"Small number", 5, 5},', // L17
  '\t\t{"Medium number", 10, 55},', // L18
  '\t}', // L19
  '', // L20
  '\tfor _, tt := range tests {', // L21
  '\t\tt.Run(tt.name, func(t *testing.T) {', // L22
  '\t\t\tactual := Fib(tt.input)', // L23
  '\t\t\t_ = actual', // L24
  '\t\t})', // L25
  '\t}', // L26
  '}', // L27
  '', // L28
].join('\n');

describe('sanitizeGoSubtestName（复刻 Go testing.rewrite 的空白规则）', () => {
  it('空白类 rune → `_`（1:1）；其余原样（含正则元字符）', () => {
    const cases: [string, string | null][] = [
      ['plain', 'plain'],
      ['two words', 'two_words'],
      ['a  b', 'a__b'], // 每个空白各换一个下划线
      ['tab\there', 'tab_here'],
      ['newline\nhere', 'newline_here'],
      ['nbsp\u00a0here', 'nbsp_here'], // NBSP 在 Go 的 isSpace 集合内
      ['unicode 测试', 'unicode_测试'],
      // 正则元字符保留 —— 故拼 `-run` 时必须 `\Q…\E` 引用（P3 已做）
      ['dot.1', 'dot.1'],
      ['plus+1', 'plus+1'],
      ['paren(1)', 'paren(1)'],
      ['hash#1', 'hash#1'],
      ['slash/x', 'slash/x'], // `/` 保留 → 成为新的层级
    ];
    expect(cases.map(([input]) => sanitizeGoSubtestName(input))).toEqual(
      cases.map(([, out]) => out),
    );
  });

  it('含不可打印字符 → null（放弃，不猜）', () => {
    expect(sanitizeGoSubtestName('a\u0000b')).toBeNull();
    expect(sanitizeGoSubtestName('bell\u0007')).toBeNull();
  });
});

describe('discoverGoTableSubtests（AST：表格 → 逐行子测试）', () => {
  it('用户的 TestFib 夹具 → 6 个子测试，名字与**元素行号**精确', () => {
    expect(discover('fib_test.go', FIB)).toEqual([
      { name: 'TestFib/Negative_input', line: 13, lang: 'go' },
      { name: 'TestFib/Zero_input', line: 14, lang: 'go' },
      { name: 'TestFib/Base_case_1', line: 15, lang: 'go' },
      { name: 'TestFib/Base_case_2', line: 16, lang: 'go' },
      { name: 'TestFib/Small_number', line: 17, lang: 'go' },
      { name: 'TestFib/Medium_number', line: 18, lang: 'go' },
    ]);
  });

  it('顶层用例与子测试由同一次发现共同产出（接线覆盖）', () => {
    expect(discoverRunTargets('fib_test.go', FIB).tests).toEqual([
      { name: 'TestFib', line: 7, lang: 'go' },
      { name: 'TestFib/Negative_input', line: 13, lang: 'go' },
      { name: 'TestFib/Zero_input', line: 14, lang: 'go' },
      { name: 'TestFib/Base_case_1', line: 15, lang: 'go' },
      { name: 'TestFib/Base_case_2', line: 16, lang: 'go' },
      { name: 'TestFib/Small_number', line: 17, lang: 'go' },
      { name: 'TestFib/Medium_number', line: 18, lang: 'go' },
    ]);
  });

  it('键式元素（`{name: "x", …}`）同样产出', () => {
    const doc = [
      'package p',
      '',
      'func TestKeyed(t *testing.T) {',
      '    cases := []struct {',
      '        name string',
      '        want int',
      '    }{',
      '        {name: "alpha", want: 1},',
      '        {name: "beta", want: 2},',
      '    }',
      '    for _, c := range cases {',
      '        t.Run(c.name, func(t *testing.T) {})',
      '    }',
      '}',
      '',
    ].join('\n');
    expect(discover('keyed_test.go', doc)).toEqual([
      { name: 'TestKeyed/alpha', line: 8, lang: 'go' },
      { name: 'TestKeyed/beta', line: 9, lang: 'go' },
    ]);
  });
});

describe('discoverGoTableSubtests — 本质限制（不产按钮，而非猜）', () => {
  const wrap = (body: string): string =>
    ['package p', '', 'func TestX(t *testing.T) {', body, '}', ''].join('\n');

  const table = (rows: string, nameField = 'name'): string =>
    wrap(
      [
        '    cases := []struct {',
        '        name string',
        '        want int',
        '    }{',
        rows,
        '    }',
        '    for _, c := range cases {',
        `        t.Run(c.${nameField}, func(t *testing.T) {})`,
        '    }',
      ].join('\n'),
    );

  it('净化后重名 → 整组不产（运行时去重后缀 #01 由碰撞顺序决定，静态不可预测）', () => {
    // "a b" 与 "a  b" 净化后分别是 a_b / a__b（不同）；构造真正同名者：
    expect(discover('dup_test.go', table('        {"same", 1},\n        {"same", 2},'))).toEqual(
      [],
    );
  });

  it('名字非字符串字面量（变量 / Sprintf）→ 不产', () => {
    expect(discover('var_test.go', table('        {nameVar, 1},'))).toEqual([]);
  });

  it('命名 struct 类型（非匿名 `[]struct{…}`）→ 不产', () => {
    const doc = [
      'package p',
      '',
      'type tc struct { name string; want int }',
      '',
      'func TestNamed(t *testing.T) {',
      '    cases := []tc{',
      '        {name: "a", want: 1},',
      '    }',
      '    for _, c := range cases {',
      '        t.Run(c.name, func(t *testing.T) {})',
      '    }',
      '}',
      '',
    ].join('\n');
    expect(discover('named_test.go', doc)).toEqual([]);
  });

  it('名字字面量含转义 → 该行不产（不做 Go 反转义）', () => {
    expect(discover('esc_test.go', table('        {"tab\\there", 1},'))).toEqual([]);
  });

  it('没有表格（只有 t.Run 循环）→ 不产', () => {
    const doc = [
      'package p',
      '',
      'func TestNoTable(t *testing.T) {',
      '    for _, n := range []string{"x", "y"} {',
      '        t.Run(n, func(t *testing.T) {})',
      '    }',
      '}',
      '',
    ].join('\n');
    // 内联 `[]string` 表是**另一种惯用法**，首期不覆盖（见 design §7.8.7）
    expect(discover('notable_test.go', doc)).toEqual([]);
  });

  it('表格存在但缺少 `t.Run(loopVar.field)` 绑定 → 不产', () => {
    const doc = wrap(
      [
        '    cases := []struct {',
        '        name string',
        '    }{',
        '        {"a"},',
        '    }',
        '    _ = cases',
      ].join('\n'),
    );
    expect(discover('nobind_test.go', doc)).toEqual([]);
  });
});
