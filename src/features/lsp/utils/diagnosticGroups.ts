/**
 * Problems 面板的分组**纯投影**（无 React）：store 快照 → 有序的文件分组列表，
 * 以及组内行可能需要的排序 / 行身份。
 *
 * **为什么分组对象不在这里缓存（第一性原理）**：渲染代价 = 被 reconcile 的元素数 × 每个元素的
 * props 是否变化。分组列表的输入天然按 uri 切片（`patchDiagnosticsByProject` 每次 flush 只重建
 * 发生变化的 uri 数组，其余引用不变），所以「哪些分组需要重算」这件事**不需要**另造缓存 ——
 * 让每个分组成为 `React.memo` 组件、把该 uri 的数组当 prop，React 的浅比较就是那份缓存
 * （见 `components/DiagnosticGroup.tsx`）。本模块只留可单测的纯函数。
 */
import { relativeToRoot } from '@/shared/utils/fileRef';

import { fromFileUri } from '../api/languageMap';
import type { LspDiagnostic } from '../types';

/** 一个文件分组在列表里的定位信息（`diagnostics` 是 store 里的原引用，不做拷贝）。 */
export interface DiagnosticFileGroup {
  uri: string;
  /** 展示路径：file:// 解码；项目内相对化，项目外/非文件 uri 原样。 */
  label: string;
  diagnostics: LspDiagnostic[];
}

/** severity → 排序权重（errors 最先，null 与 hint 殿后）。 */
function severityRank(severity: number | null): number {
  if (severity === null || severity === undefined) return 3;
  return Math.min(4, Math.max(1, severity)) - 1;
}

/**
 * file:// uri → 展示路径：项目内相对化，项目外 / 非文件 uri 原样。
 *
 * 剥根判据**复用** `shared/utils/fileRef.relativeToRoot`（该模块是路径形态的唯一所有权处，
 * 其模块注释明文禁止调用方自拼 root、用 `startsWith` 做归一 —— 红线 12）。自写
 * `path.startsWith(root)` 已在三类输入上分叉（实测）：`/proj-x` 这种兄弟目录被当成项目内
 * （标签切成 `-x/a.ts`，既非相对路径也非绝对路径）、`path === root` 得到空标签、
 * root 与 path 的斜杠形态混用（Windows 形态 root）时完全不归一。
 *
 * **已知边界**：LSP `file://` uri 的形态自带前导斜杠（Windows 上解码为 `/c:/…`），它与 fs 形态
 * `C:\…` 的互换不在本层 —— 这类标签退化为绝对路径（与本次改动前行为一致，不是回归）。
 * 要做对必须在 `fileRef` 这一单一实现处处理，不在此处加特例。
 */
export function diagnosticGroupLabel(uri: string, projectPath: string): string {
  return relativeToRoot(projectPath, fromFileUri(uri));
}

/**
 * store 快照 → 有序文件分组列表（文件名字母序；空数组 = 清空语义，不产生分组）。
 *
 * 排序是 O(组数 log 组数) 的纯标签比较（不碰组内诊断），因此每次 flush 重跑它是可以接受的；
 * 真正贵的是「组内排序 + 渲染」，那部分被 `DiagnosticGroup` 的 memo 挡在未变分组之外。
 */
export function orderDiagnosticFileGroups(
  byUri: Record<string, LspDiagnostic[]> | undefined,
  projectPath: string,
): DiagnosticFileGroup[] {
  const groups: DiagnosticFileGroup[] = [];
  for (const [uri, diagnostics] of Object.entries(byUri ?? {})) {
    if (!Array.isArray(diagnostics) || diagnostics.length === 0) continue;
    groups.push({ uri, label: diagnosticGroupLabel(uri, projectPath), diagnostics });
  }
  return groups.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/** 组内排序：severity → 行 → 列（**不改写入参**，排序落在副本上）。 */
export function sortDiagnosticsForGroup(diagnostics: LspDiagnostic[]): LspDiagnostic[] {
  return [...diagnostics].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    const byLine = a.range.start.line - b.range.start.line;
    if (byLine !== 0) return byLine;
    return a.range.start.character - b.range.start.character;
  });
}

/**
 * 组内每行的 React key —— **唯一性由序号保证，稳定性由指纹保证**。
 *
 * 指纹（消息 + 行列 + severity）不足以唯一：同一 LS 可以在同一位置用两条规则报同一句话
 * （`code` 不同，而 `code` 不在指纹里），此时两条诊断同 key —— React 会告警，更新时该组可能
 * 错配或丢行。补一个「同指纹出现次序」后缀即可唯一。
 *
 * 反过来也不能只用序号：入参已是 `sortDiagnosticsForGroup` 的确定性结果，同一份内容每次产出
 * 同一组 key（跨 publish 稳定）；而纯序号会在文件头插入一条诊断时让整组 key 平移。
 */
export function diagnosticRowKeys(diagnostics: LspDiagnostic[]): string[] {
  const seen = new Map<string, number>();
  return diagnostics.map((diagnostic) => {
    const fingerprint = `${diagnostic.message}-${diagnostic.range.start.line}-${
      diagnostic.range.start.character
    }-${diagnostic.severity ?? 'none'}`;
    const occurrence = seen.get(fingerprint) ?? 0;
    seen.set(fingerprint, occurrence + 1);
    return `${fingerprint}#${occurrence}`;
  });
}
