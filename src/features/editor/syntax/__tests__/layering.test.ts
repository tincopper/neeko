import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * 分层护栏：`syntax/` 是**低层**（Lezer 工具 + 类型契约 + 各语言发现），`utils/` 是**上层**
 * （注册表与分发）。依赖必须**单向** `utils → syntax`。
 *
 * 背景：F3 审查发现 `syntax/*` 曾从 `utils/testCases`、`utils/mainEntries`、`utils/runLanguages`
 * 反向取类型 → 上下层互指（虽为 `import type`、运行时无环，但分层语义颠倒）。类型已下沉到
 * `syntax/contract.ts`，上层改为再导出。本护栏钉住该方向，防止回归。
 */
const SYNTAX_FILES = [
  'contract.ts',
  'lezer.ts',
  'parsers.ts',
  'ts.ts',
  'rust.ts',
  'go.ts',
  'goTable.ts',
  'java.ts',
] as const;

const read = (name: string): string => readFileSync(`src/features/editor/syntax/${name}`, 'utf8');

describe('分层护栏：syntax/ 不依赖 utils/', () => {
  it('syntax/ 下无任何 `../utils/` 导入（依赖方向单向 utils → syntax）', () => {
    const offenders = SYNTAX_FILES.filter((name) => /from '\.\.\/utils\//.test(read(name)));
    expect(offenders).toEqual([]);
  });

  it('契约类型由 syntax/contract.ts 定义（低层持有类型）', () => {
    const contract = read('contract.ts');
    expect(contract).toMatch(/export interface TestCaseInfo\b/);
    expect(contract).toMatch(/export interface MainEntry\b/);
    expect(contract).toMatch(/export type RunLang\b/);
  });

  it('上层 utils/ 以再导出衔接，但**不得存在纯垫片模块**', () => {
    const utilsDir = 'src/features/editor/utils';
    // `testCases.ts` 仍有真实内容（文件名谓词）→ 携带类型再导出是合理的
    expect(readFileSync(`${utilsDir}/testCases.ts`, 'utf8')).toContain(
      "export type { TestCaseInfo } from '../syntax/contract'",
    );
    // `mainEntries.ts` 曾是「零逻辑、只 re-export」的兼容垫片 → 已删除（消费方直导 contract）
    expect(existsSync(`${utilsDir}/mainEntries.ts`)).toBe(false);
  });
});
