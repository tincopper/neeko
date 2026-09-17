// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { javaSelectorProblem, type JavaSymbol } from '../symbols';

const METHOD = 6;
const CLASS = 5;

function symbols(): JavaSymbol[] {
  return [
    { name: 'CalcTest', kind: CLASS, line: 7, containerName: 'CalcTest.java' },
    { name: 'testAdd', kind: METHOD, line: 9, containerName: 'CalcTest' },
  ];
}

describe('javaSelectorProblem — launch 前存在性不变式', () => {
  it('方法存在 → 放行', () => {
    expect(javaSelectorProblem(symbols(), { name: 'testAdd' })).toBeNull();
  });

  it('方法不存在 → 阻断并给出可执行原因（静默错的源头）', () => {
    const problem = javaSelectorProblem(symbols(), { name: 'testMissing' });
    expect(problem).toContain('testMissing');
    expect(problem).toContain('breakpoints');
  });

  it('符号表为空 → 放行（无法判断不等于不存在，避免把 LSP 故障误报为用例缺失）', () => {
    expect(javaSelectorProblem([], { name: 'whatever' })).toBeNull();
  });

  it('同名类符号不算命中（只认方法）', () => {
    const onlyClass: JavaSymbol[] = [{ name: 'testAdd', kind: CLASS, line: 1 }];
    expect(javaSelectorProblem(onlyClass, { name: 'testAdd' })).not.toBeNull();
  });
});
