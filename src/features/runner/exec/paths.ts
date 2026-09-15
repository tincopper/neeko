/**
 * run 根相对路径工具（语言无关）。
 *
 * 各语言的模块/清单探测都是「从被编辑文件所在目录向上逐级拼 `${root}/${dir}` 探标记」
 * 同一形态 —— 前提是输入已被归一化为 **run 根相对**。本模块是那一步换算的单点：
 * 绝对路径未归一化时会拼成 `${root}//abs/…`，探测永不命中且回退产出 `./abs/…` 伪包路径。
 */
import { relativeToRoot } from '@/shared/utils/fileRef';

/** 绝对路径判定（POSIX `/` 或 Windows 盘符）；用于识别「无法表达为 cwd 相对」的输入。 */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * 被编辑文件路径 → run 根相对分段。
 *
 * 生产链路传入 `tab.filePath` —— 恒为 canonical 绝对路径；单测传入相对路径。
 * 归一化统一走 `relativeToRoot`（fileRef 是路径形态换算的唯一所有权模块）。
 */
export function runRootRelativeParts(filePath: string, runRoot: string): string[] {
  return relativeToRoot(runRoot, filePath).split('/');
}
