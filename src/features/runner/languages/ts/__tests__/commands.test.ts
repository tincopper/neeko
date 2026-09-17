// @vitest-environment node
/**
 * ts 命令构造测试
 */
import { describe, expect, it } from 'vitest';

import { TestCaseInfo } from '../../../syntax/contract';
import { buildTsRunCommand, buildVitestReportPath } from '../commands';

const tsCase: TestCaseInfo = { name: 'adds numbers', line: 2, lang: 'ts' };

describe('buildTsRunCommand', () => {
  it('should_build_vitest_command_with_json_report_output_for_ts_cases', async () => {
    expect(buildTsRunCommand(tsCase, 'src/a.test.ts', '/tmp/proj')).toBe(
      "pnpm vitest run 'src/a.test.ts' -t 'adds numbers'" +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
  });

  it('should_fall_back_to_relative_report_path_without_run_root', async () => {
    expect(buildTsRunCommand(tsCase, 'src/a.test.ts', null)).toBe(
      "pnpm vitest run 'src/a.test.ts' -t 'adds numbers'" +
        " --reporter=default --reporter=json --outputFile.json='node_modules/.neeko/vitest-report.json'",
    );
  });

  it('should_single_quote_escape_names_with_quotes_and_spaces', async () => {
    expect(buildTsRunCommand({ ...tsCase, name: "it's fine" }, 'src/a.test.ts', '/tmp/proj')).toBe(
      `pnpm vitest run 'src/a.test.ts' -t 'it'\\''s fine'` +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
    expect(
      buildTsRunCommand({ ...tsCase, name: 'has "double" quotes' }, 'src/a.test.ts', '/tmp/proj'),
    ).toBe(
      `pnpm vitest run 'src/a.test.ts' -t 'has "double" quotes'` +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
  });

  it('should_quote_relative_paths_containing_spaces', async () => {
    expect(buildTsRunCommand(tsCase, 'src/my folder/a.test.ts', '/tmp/proj')).toBe(
      `pnpm vitest run 'src/my folder/a.test.ts' -t 'adds numbers'` +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
  });

  it('ts 报告路径纯由 runRoot 推导', () => {
    expect(buildTsRunCommand(tsCase, 'src/a.test.ts', '/tmp/proj')).toBe(
      "pnpm vitest run 'src/a.test.ts' -t 'adds numbers'" +
        " --reporter=default --reporter=json --outputFile.json='/tmp/proj/node_modules/.neeko/vitest-report.json'",
    );
  });
});

describe('buildVitestReportPath', () => {
  it('should_join_report_path_under_node_modules_neeko_of_project_root', () => {
    expect(buildVitestReportPath('/tmp/proj')).toBe(
      '/tmp/proj/node_modules/.neeko/vitest-report.json',
    );
    expect(buildVitestReportPath('/tmp/proj/')).toBe(
      '/tmp/proj/node_modules/.neeko/vitest-report.json',
    );
  });

  it('should_return_relative_path_for_empty_root', () => {
    expect(buildVitestReportPath('')).toBe('node_modules/.neeko/vitest-report.json');
  });
});
