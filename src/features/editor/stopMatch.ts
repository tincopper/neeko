/**
 * 停点匹配策略 —— **纯函数**，`debug` 域与 `editor` 域的唯一判定点。
 *
 * 黄线（持久标记）与光标跟随（`useDebugStopReveal`）必须用**同一套**「这个停点是否落在本
 * tab」的判定：两处各写一份，就会出现「黄线在、位置不在」这类分叉。放在独立模块而非某个
 * hook 文件里，也就不会有 hook → hook 的隐式依赖。
 *
 * **前置条件（调用方保证）**：两侧都已是**规范源身份** —— 由 `sourceIdentityOf` /
 * `canonicalFsPath` / `tabIdentityOf` 产出（tab 身份、`location.identity` 同一套归一）。
 * 因此这里**不做身份转换**：不拼项目根、不做 basename 猜测、不折叠 `..`。
 *
 * 保留的两条形态容忍（均为**既有事实**，不是身份转换）：
 * 1. 斜杠形态：`\` → `/`、去尾斜杠（Windows / WSL / SSH 路径）；
 * 2. 绝对 vs 相对：DAP 栈帧给绝对路径、而 tab 可能存项目相对形态，故允许「互为后缀」
 *    （`/repo/src/a.go` 与 `src/a.go`）。第 1 条之外**没有**别的兜底。
 *
 * 曾经还有一条「末段同名 + 裸后缀」兜底分支：穷举验证（251 个候选 / 63001 对输入）表明
 * 它只在**非规范输入**（重复/前导斜杠，如 `'////a/ab'` vs `'/ab'`）下可达，与上述前置条件
 * 矛盾且零覆盖 —— 已删除。对非规范输入的容忍应由**入口归一**承担，不在比较侧叠条件
 * （身份唯一化的后续收敛见任务 `09-16-debug-source-identity`）。
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Loose path equality for DAP abs paths vs editor relative/abs paths. */
export function debugPathsMatch(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.endsWith('/' + nb) || nb.endsWith('/' + na);
}

/**
 * 停点是否落在本 tab？是则返回要标记/跳转的行号（1-based），否则 null。
 *
 * 状态门是**软门**：后端在停点前后可能瞬时报告 `starting` / `running`，所以只有明确
 * 既非 `stopped` 也非 `starting` 时才判定为「不在停点上」。
 */
export function resolveDebugHighlightLine(
  absFilePath: string | null,
  tabFilePath: string | null,
  location: { identity: string; line: number } | null,
  sessionStatus: string | null | undefined,
): number | null {
  if (!location || location.line < 1) return null;
  if (sessionStatus && sessionStatus !== 'stopped' && sessionStatus !== 'starting') {
    return null;
  }
  if (absFilePath && debugPathsMatch(location.identity, absFilePath)) {
    return location.line;
  }
  if (tabFilePath && debugPathsMatch(location.identity, tabFilePath)) {
    return location.line;
  }
  return null;
}
