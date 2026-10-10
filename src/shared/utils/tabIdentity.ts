/**
 * Tab 空间身份 —— `TabScope` → store 键 / 身份投影的**唯一实现处**（tab 域）。
 *
 * **为什么独立成模块**：这些是 tab 域概念，此前寄居在身份模块 `workspaceRef.ts` 里，造成
 * `workspaceRef → types/tab → types/workspace → workspaceRef` 的**类型级循环**。独立后：
 * - `workspaceRef.ts` 只负责 Workspace 身份（值对象 + key），不再依赖 tab 模型 → 循环消除；
 * - tab 域的三个投影（键 / 项目粒度 / 地址值）集中在此，内聚于 tab 概念。
 *
 * 本模块**零运行时依赖**（只 import 类型），不会引入新的循环。
 */
import type { Tab, TabScope } from '@/shared/types/tab';
import type { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

/** App 节点（设置 / 全局面板）的 tab 空间键。字面量只允许出现在本文件（护栏判据 9）。
 * 模块私有：消费方一律经 `tabSpaceKeyOf({ kind: 'app' })`（键推导唯一实现）。 */
const APP_TAB_SPACE_KEY = '__app__';

/**
 * 键推导唯一实现（P3 构造律）：`'workspace'` → `session.key`；`'app'` → App 空间键。
 * editorStore.addTab 内部用它从 tab 自身推导 store 键 —— 调用方无权指定键，
 * 「键 A、tab 身份 B」的 bug 类别在构造上不存在。
 */
export function tabSpaceKeyOf(scope: TabScope): string {
  return scope.kind === 'workspace' ? scope.session.key : APP_TAB_SPACE_KEY;
}

/**
 * 消费方只需项目粒度时的投影读取（环境探测 / quick-open 记录等）。
 * App 空间 tab 无项目身份，返回 null。
 */
export function tabProjectId(tab: Tab): ProjectId | null {
  return tab.scope.kind === 'workspace' ? tab.scope.session.projectId : null;
}

/** 消费方需要 Workspace 地址（文件读写 / git 命令）时的投影读取；App 空间 tab 返回 null。 */
export function tabWorkspaceSession(tab: Tab): WorkspaceSession | null {
  return tab.scope.kind === 'workspace' ? tab.scope.session : null;
}

/**
 * **不变量收窄**：消费方确知该 tab 属某 Workspace（file / diff / browser 等 kind 只在
 * workspace 空间创建）时用它取 session；违反即抛（fail-fast），**绝不制造 `''` 伪身份**。
 * 单一实现，替代各消费点各自的 `session!` / `?? ''`。
 */
export function requireTabWorkspaceSession(tab: Tab): WorkspaceSession {
  const session = tabWorkspaceSession(tab);
  if (!session) {
    throw new Error(`[tabIdentity] tab ${tab.id} (${tab.data.kind}) has no workspace scope`);
  }
  return session;
}
