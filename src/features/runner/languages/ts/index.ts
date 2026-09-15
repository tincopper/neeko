/**
 * TS/JS 语言模块（`LanguageModule` 实现）。
 *
 * 本语言**无 main 概念、无 Debug 通道、无前置产物** —— 它是最小实现，也是「新增一门语言
 * 需要提供什么」的参照：`filePolicy` + `discover` + `capabilities` + 两个 plan 即可。
 *
 * 命令构造此刻仍来自通用层 `utils/testCommands`（方案 B 阶段 2 迁入本目录 `commands.ts`）；
 * 依赖方向是「语言 → 语言无关工具」，Stage 2 消除后本文件只剩语言自己的东西。
 */
import { buildTestConfigId } from '../../exec/shell';
import type { LanguageModule } from '../contract';
import { defaultLabels } from '../labels';

import { buildTsRunCommand } from './commands';
import { discoverTsTests } from './discover';
import { readTsResults } from './results';

/** TS/JS 测试文件命名：`*.test.*` / `*.spec.*`（本语言专属，不含其它语言后缀）。 */
export function isTsTestFile(fileName: string): boolean {
  return /\.(test|spec)\.[^./]+$/.test(fileName);
}

export const TS: LanguageModule = {
  id: 'ts',
  filePolicy: {
    // 必须用 TS 专属命名判定：跨语言谓词会把 `*Test.java` / `_test.go` 也判真，
    // 从而被本表项抢先吞掉，其它语言永远匹配不到（顺序查找）。
    match: isTsTestFile,
    isTestCaseFile: isTsTestFile,
    hasMain: false,
    // 注：用例标题含 `/` 极常见（`test('GET /users')`）却是平凡文本 —— 见能力位定义。
  },
  discover: (sd) => ({ tests: discoverTsTests(sd), mains: [] }),
  readResults: readTsResults,
  ui: { labels: defaultLabels },
  capabilities: { directRun: true, debug: null },

  async planTestRun({ ctx, testCase, runRoot }) {
    return {
      cwd: runRoot,
      command: buildTsRunCommand(testCase, ctx.filePath, runRoot),
      configId: buildTestConfigId('run', testCase, ctx.filePath),
    };
  },

  // 无 main 概念：gutter 不产 main 入口，此路径不可达（防御性显式返回）。
  planMainRun: async () => null,
};
