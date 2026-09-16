/**
 * 停点匹配策略 —— **纯函数**，`debug` 域与 `editor` 域的唯一判定点。
 *
 * 黄线（持久标记）与光标跟随（`useDebugStopReveal`）必须用**同一套**「这个停点是否落在本
 * tab」的判定：两处各写一份，就会出现「黄线在、位置不在」这类分叉。放在独立模块而非某个
 * hook 文件里，也就不会有 hook → hook 的隐式依赖。
 *
 * **判定实现只有一处**：`fileRef.sameIdentity`（身份所有者）。本模块只声明**前置条件** ——
 * 两侧都必须是**规范源身份**（`sourceIdentityOf` / `tabIdentityOf` / `virtualSourceIdentity` 产出）。
 *
 * 演化记录（避免回退）：
 * - 曾有「末段同名 + 裸后缀」兜底分支 —— 穷举证明只对非规范输入可达，已删（切片 1+2）；
 * - 曾有「绝对 vs 相对互为后缀」容忍（`/repo/a.go` vs `a.go`）—— 那是**误命中源**（任意目录下的
 *   同名文件都会命中），且调用方两侧本就都是规范身份，已删（切片 3，R3）：相对/绝对混比属
 *   **边界解析**职责，不在身份比较里兜。
 */
import { sameIdentity } from '@/shared/utils/fileRef';

/** 两个源身份是否指向同一文件（实现委托身份所有者，见模块头注释的前置条件）。 */
export function debugPathsMatch(a: string, b: string): boolean {
  return sameIdentity(a, b);
}

/**
 * 停点是否落在本 tab？是则返回要标记/跳转的行号（1-based），否则 null。
 *
 * `absFilePath` 必须是**规范源身份** —— 由 `FileEditor` 用 `sourceIdentityOf` 算出，
 * 对 fs / jdt / 虚拟源码三种身份都成立（身份构造点幂等，见 `fileRef` 模块头）。
 * 因此判定只需一个参数：曾有的第二个参数（tab 原始路径）是为绕过「虚拟身份被拼根」
 * 而设的权宜，身份文法闭合后已删除。
 *
 * 状态门是**软门**：后端在停点前后可能瞬时报告 `starting` / `running`，所以只有明确
 * 既非 `stopped` 也非 `starting` 时才判定为「不在停点上」。
 */
export function resolveDebugHighlightLine(
  absFilePath: string | null,
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
  return null;
}
