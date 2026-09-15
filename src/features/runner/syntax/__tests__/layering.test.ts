import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * 分层护栏：`syntax/` 是**低层**（Lezer 工具 + 类型契约），语言发现已迁到
 * `languages/<lang>/discover.ts`（`languages/` 侧只允许依赖 `syntax/`，反向禁止）。
 *
 * 背景：F3 审查发现 `syntax/*` 曾从 `utils/testCases`、`utils/mainEntries`、`utils/runLanguages`
 * 反向取类型 → 上下层互指（虽为 `import type`、运行时无环，但分层语义颠倒）。类型已下沉到
 * `syntax/contract.ts`，上层改为再导出。本护栏钉住该方向，防止回归。
 */
const SYNTAX_FILES = ['contract.ts', 'lezer.ts', 'parsers.ts'] as const;

/** 语言发现模块（`languages/<lang>/`）：同样只允许依赖 `syntax/` 工具箱与同语言私有模块。 */
const LANGUAGE_FILES = [
  'ts/discover.ts',
  'rust/discover.ts',
  'go/discover.ts',
  'go/table.ts',
  'java/discover.ts',
] as const;

const read = (name: string): string => readFileSync(`src/features/runner/syntax/${name}`, 'utf8');
const readLang = (name: string): string =>
  readFileSync(`src/features/runner/languages/${name}`, 'utf8');

describe('分层护栏：syntax/ 不依赖上层', () => {
  it('syntax/ 下无任何 `../utils/` 导入（依赖方向单向 utils → syntax）', () => {
    const offenders = SYNTAX_FILES.filter((name) => /from '\.\.\/utils\//.test(read(name)));
    expect(offenders).toEqual([]);
  });

  it('语言发现模块只依赖 syntax/ 工具箱与同语言私有模块', () => {
    // `utils/`、`exec/`、`store/`、components 等上层均不得被语言发现反向引用。
    const offenders = LANGUAGE_FILES.filter((name) =>
      /from '(\.\.\/)+(utils|exec|store|components|api|hooks)\//.test(readLang(name)),
    );
    expect(offenders).toEqual([]);
  });

  it('契约类型由 syntax/contract.ts 定义（低层持有类型）', () => {
    const contract = read('contract.ts');
    expect(contract).toMatch(/export interface TestCaseInfo\b/);
    expect(contract).toMatch(/export interface MainEntry\b/);
    expect(contract).toMatch(/export type RunLang\b/);
  });

  it('上层不再保留兼容垫片模块（消费方直导 contract / languages）', () => {
    const utilsDir = 'src/features/runner/utils';
    // `mainEntries.ts` 曾是「零逻辑、只 re-export」的兼容垫片；`testCases.ts` 的类型/谓词已
    // 分别下沉到 `syntax/contract.ts` 与 `languages/<lang>/`（方案 B）→ 两者都不该再存在。
    expect(existsSync(`${utilsDir}/mainEntries.ts`)).toBe(false);
    expect(existsSync(`${utilsDir}/testCases.ts`)).toBe(false);
    expect(existsSync(`${utilsDir}/runLanguages.ts`)).toBe(false);
  });
});
