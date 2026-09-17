// @vitest-environment node
/**
 * shell 纯工具测试
 *
 * 语言无关的共享原语（与各语言模块无关）。
 */
import { describe, expect, it } from 'vitest';

import type { TestCaseInfo } from '../../syntax/contract';
import { buildTestConfigId, shellToken } from '../shell';

const tsCase: TestCaseInfo = { name: 'adds numbers', line: 2, lang: 'ts' };
const rustCase: TestCaseInfo = { name: 'parse_simple', line: 1, lang: 'rust' };

describe('buildTestConfigId', () => {
  it('should_build_stable_per_case_ids_distinguishing_run_and_debug', () => {
    const run = buildTestConfigId('run', tsCase, 'src/a.test.ts');
    const debug = buildTestConfigId('debug', rustCase, 'src/lib.rs');
    expect(debug).toBe('testcase:debug:rust:src/lib.rs:parse_simple');
    expect(run).not.toBe(debug);
  });
});

describe('shellToken', () => {
  it('shellToken：仅不安全 token 加引号（命令可读且可复制）', () => {
    expect(shellToken('--package')).toBe('--package');
    expect(shellToken('routes::sentiment::tests::test_x')).toBe('routes::sentiment::tests::test_x');
    expect(shellToken('/proj/crates/api')).toBe('/proj/crates/api');
    expect(shellToken('has space')).toBe("'has space'");
    expect(shellToken("it's")).toBe(`'it'\\''s'`);
    expect(shellToken('')).toBe("''");
  });
});
