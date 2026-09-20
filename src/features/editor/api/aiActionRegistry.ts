import { fileRefFromLspUri, tabIdentityOf } from '@/shared/utils/fileRef';

/**
 * 编辑器 AI 动作的跨面板派发注册表 —— 镜像 `editorViews.ts` 的注册表模式。
 *
 * 存在的理由：诊断 UI 的 AI 动作（✨ Fix / ✨ Explain）发起方有两处（Problems 面板
 * 行内菜单 / 编辑器内 hover popup），它们只知道 **LSP document uri**；而"把诊断上下文
 * 派发给项目 agent"的能力（`buildCodeMessage` → `sendToAgent`）只活在各自
 * `useFileEditorState` 里。注册表按 `FileRef` 身份把两者接起来。
 *
 * 产出形态 = B1：AI agent 自己通过工具改文件（它本就有改盘能力），宿主只负责把它
 * 喊起来并传上下文 —— 不解析补丁、不走 `applyWorkspaceEdit`。
 *
 * 身份一律走 `FileRef`（红线 12）：登记侧 `tabIdentityOf(fileRefFromTabPath(...))`、
 * 解析侧 `fileRefFromLspUri(uri)` 收敛到同一身份，不自造字符串归一。
 */

export type AiEditorAction = 'fix' | 'explain';

/** 一次 AI 动作派发的上下文（诊断行范围 + 诊断消息）。 */
export interface AiActionRequest {
  action: AiEditorAction;
  /** 1-based 行号（诊断的 LSP 0-based range 由调用方换算）。 */
  startLine: number;
  endLine: number;
  /** 诊断消息 —— agent 需要知道要修/解释的具体问题。 */
  diagnosticMessage?: string;
}

/** 派发结果：false = 没有 agent 接收（调用方按"没落地"处理）。 */
export type AiActionHandler = (req: AiActionRequest) => boolean;

/**
 * 同文件多 tab 共用同一身份：后挂载覆盖先挂载是预期的（同一文件的派发入口语义相同），
 * 但卸载必须引用计数 —— 先卸载的 tab 不得删掉存活页的 handler（与 `editorViews`
 * 注册表同构，两处结构不漂移）。
 */
const handlers = new Map<string, { handler: AiActionHandler; count: number }>();

export function registerAiActionHandler(identity: string, handler: AiActionHandler): void {
  const cur = handlers.get(identity);
  if (cur) handlers.set(identity, { handler, count: cur.count + 1 });
  else handlers.set(identity, { handler, count: 1 });
}

export function unregisterAiActionHandler(identity: string): void {
  const cur = handlers.get(identity);
  if (!cur) return;
  if (cur.count <= 1) handlers.delete(identity);
  else handlers.set(identity, { handler: cur.handler, count: cur.count - 1 });
}

/**
 * LSP document uri → 已登记编辑器页的 AI 派发；未打开（或 uri 不是文件形态）返回 false。
 */
export function runAiActionForUri(uri: string, req: AiActionRequest): boolean {
  const ref = fileRefFromLspUri(uri);
  if (!ref) return false;
  const entry = handlers.get(tabIdentityOf(ref));
  return entry ? entry.handler(req) : false;
}
