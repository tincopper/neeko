/**
 * Go 的同步 overlay 载荷：**静态子测试索引**（父用例 → 逐层登记的 `<父>/<层级>` 全名）。
 *
 * 从通用 `languages/index.ts::staticSubtestsForFile` 迁入（Neeko Check F6）：该索引只服务 Go
 * （`/` 只在 `t.Run` 语义下表示层级），留在通用层意味着「共享类型挂着一个只有 Go 填的字段」。
 *
 * 用途：菜单据此与运行时动态发现求差，使两条路线互补 —— 静态只覆盖字符串字面量表格，动态补
 * `Sprintf` / 变量 / 净化后重名的组。**对每一层祖先都登记**（`t.Run` 可再嵌），故 `T/a/b` 必须
 * 同时进 `T` 与 `T/a` 的桶；无子测试的用例不建键（调用方以「键是否存在」判定有无静态按钮）。
 */
import type { LanguageOverlay, TestCaseInfo } from '../contract';

/** Go 载荷结构（本模块私有：通用层只透传，不解释）。 */
interface GoCaseOverlay {
  subtests: string[];
}

export function goCaseOverlays(tests: readonly TestCaseInfo[]): Map<string, LanguageOverlay> {
  const index = new Map<string, string[]>();
  for (const { name } of tests) {
    for (let slash = name.indexOf('/'); slash !== -1; slash = name.indexOf('/', slash + 1)) {
      const parent = name.slice(0, slash);
      const children = index.get(parent);
      if (children) children.push(name);
      else index.set(parent, [name]);
    }
  }
  return new Map(
    [...index].map(([name, subtests]) => [name, { subtests } satisfies GoCaseOverlay]),
  );
}

/** 从目标上取回 Go 载荷（收窄 + 缺省空数组，调用方无需再判空）。 */
export function goSubtestsOf(overlay: unknown): string[] {
  return (overlay as GoCaseOverlay | undefined)?.subtests ?? [];
}
