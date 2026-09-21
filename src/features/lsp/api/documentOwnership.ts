/**
 * 编辑器**文档所有权**：视图挂载即声明、卸载即释放，供后端判断"能不能代开"。
 *
 * 为什么需要（2026-09-21 实测）：后端代开只能读**磁盘**文本，而编辑器手里可能是
 * 未保存缓冲区。代开后服务器按旧文本计算诊断，位置与编辑器文本整体错位
 * （用户看到的现象：编辑后波浪线偏移、与代码对不上）。持有期间后端不再代开，
 * didOpen 完全由编辑器负责 —— 单一所有权：**谁有真实文本，谁负责打开**。
 *
 * 为什么在这里做引用计数：同一文件可能同时被多个视图挂载（分屏 / 重挂竞态），
 * 直接一对一 claim/release 会因顺序不确定把所有权状态抖掉。只有 0→1 才发 claim、
 * 1→0 才发 release，跨 IPC 的乱序窗口随之消失。
 */
import { lspClaimDocument, lspReleaseDocument } from './lspOwnershipApi';

const refCounts = new Map<string, number>();

function ownershipKey(projectPath: string, languageId: string, uri: string): string {
  return `${projectPath}\u0000${languageId}\u0000${uri}`;
}

/** 视图挂载：首个子视图声明所有权（异步 IPC，失败仅记录，不阻塞编辑器）。 */
export function claimDocumentOwnership(projectPath: string, languageId: string, uri: string): void {
  const key = ownershipKey(projectPath, languageId, uri);
  const next = (refCounts.get(key) ?? 0) + 1;
  refCounts.set(key, next);
  if (next > 1) return;
  void lspClaimDocument(projectPath, languageId, uri).catch((e: unknown) => {
    console.warn('[LSP] claim document failed', e);
  });
}

/** 视图卸载：最后一个子视图消失才释放所有权。 */
export function releaseDocumentOwnership(
  projectPath: string,
  languageId: string,
  uri: string,
): void {
  const key = ownershipKey(projectPath, languageId, uri);
  const current = refCounts.get(key) ?? 0;
  if (current <= 1) {
    refCounts.delete(key);
    void lspReleaseDocument(projectPath, languageId, uri).catch((e: unknown) => {
      console.warn('[LSP] release document failed', e);
    });
    return;
  }
  refCounts.set(key, current - 1);
}

/** @internal 测试钩子：清空本地计数（不影响后端状态）。 */
export function __resetDocumentOwnershipForTests(): void {
  refCounts.clear();
}
