import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * P4-4 收口护栏：钉住「**发现路径只有 AST 一种机制**」。
 *
 * 背景（design §7.9）：四语言原本各有一份逐行正则，声明形态集中在 `languageSyntax.ts`。
 * 该类实现有两类固有缺陷 —— 副本漂移（`#[tokio::main] async fn main()` 漏识别那个线上 bug
 * 就是补丁）与能力天花板（表格子测试等结构性目标无法安全处理）。迁移到 Lezer AST 后：
 * - `languageSyntax.ts` 退役（结构来自语法树，不再需要「声明形态的唯一落点」）；
 * - 各语言模块不得再用正则定位声明（否则机制分叉，本护栏即失败）。
 */
const SYNTAX_DIR = 'src/features/editor/syntax';

/** 发现路径的全部模块（语言实现 + 共享工具 + 契约）。 */
const DISCOVERY_MODULES = [
  'go.ts',
  'goTable.ts',
  'rust.ts',
  'java.ts',
  'ts.ts',
  'lezer.ts',
  'parsers.ts',
  'contract.ts',
] as const;

const read = (path: string): string => readFileSync(path, 'utf8');

describe('P4-4 收口护栏：发现路径单一机制（AST）', () => {
  it('languageSyntax.ts 已退役（声明形态不再有第二处落点）', () => {
    expect(existsSync('src/features/editor/utils/languageSyntax.ts')).toBe(false);
  });

  it('发现模块不含「用正则匹配源码」的实现（`new RegExp` / `.exec(` / `.match(`）', () => {
    // 说明：`ts.ts` 里的 `String.replace(/…/)` 是**值反转义**（历史行为保持），不是结构匹配，
    // 故不在禁止之列 —— 本护栏针对的是「靠正则定位声明」这一机制。
    const offenders = DISCOVERY_MODULES.map((file) => ({
      file,
      hits: /new RegExp|\.exec\(|\.match\(/.test(read(`${SYNTAX_DIR}/${file}`)),
    })).filter((entry) => entry.hits);
    expect(offenders).toEqual([]);
  });

  it('行号查询只有「建索引一次」的形态（API 层杜绝聚合二次方）', () => {
    // 背景：曾提供 `nodeLine(docText, pos)` = 从 0 数 `\n` 到 pos（单次 O(pos)）。发现过程按每个
    // 目标求行号 → 聚合 O(文件大小 × 目标数) = 二次方。实测 179 KB Go 文件因此耗时 426ms，
    // 其中近一半是行号查询；改为 `createLineLookup`（O(n) 建索引 + O(log n) 查询）后降至 52ms。
    // 本护栏钉住「不再提供逐次扫描版本」，防止回归。
    const src = read(`${SYNTAX_DIR}/lezer.ts`);
    expect(src).toContain('export function createLineLookup');
    expect(src).not.toMatch(/export function (nodeLine|lineAt|lineOf)/);
  });

  it('注册表不再有语言实现文本（正则）发现入口', () => {
    // 字段本身已从 `RunLanguage` 接口删除；此处再从源码层确认没有任何表项把它加回来
    const src = read('src/features/editor/utils/runLanguages.ts');
    const offenders = src
      .split('\n')
      .filter((line) => /^\s*(parseTestCases|parseMainEntries)\s*[:(]/.test(line));
    expect(offenders).toEqual([]);
  });

  it('四个语言都提供 AST 发现入口（`discoverTests` / `discoverMains`）', () => {
    const registry = read('src/features/editor/utils/runLanguages.ts');
    // 每个语言表项都应出现这两个 hook（键名唯一，直接计数）
    const discoverTestsCount = (registry.match(/^\s*discoverTests:/gm) ?? []).length;
    const discoverMainsCount = (registry.match(/^\s*discoverMains:/gm) ?? []).length;
    expect([discoverTestsCount, discoverMainsCount]).toEqual([4, 4]);
  });
});
