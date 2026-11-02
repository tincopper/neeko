import { useEditorStore } from '@/shared/store/editorStore';
import type { EditorGroupId } from '@/shared/types';
import type { AgentChatTabData } from '@/shared/types/tab';
import { generateTabId } from '@/shared/utils/tabIdentity';
import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * 打开一条 agent-chat tab —— **唯一入口**。
 *
 * 收敛此前四处的重复（侧栏「点回来」、Action Menu 新建、项目引导页、Histor 恢复）：
 * id 铸造、`scope` 构造、占位标题、`addTab` + `activateTab`。漏掉其中任何一步的症状
 * 都一样（「点了没反应」/「tab 落在别的单元」），而四份手抄不可能同时正确。
 *
 * 为什么放在本域的 `api/`：`AgentChatTabData` 的字段语义（`modelId` 持久化、`resume*`
 * 恢复目标、`composerDoc` 草稿）归 agent-chat 域所有；`api/` 是防火墙允许跨域直导的
 * 公开面，且不引入 UI 依赖（放进门面会把整张 chat UI 拖进只需建 tab 的调用点）。
 */

/** 调用方可写的 data 字段：`kind` 由本端口决定，不允许外部覆盖。 */
export type AgentChatTabDataPatch = Partial<Omit<AgentChatTabData, 'kind'>>;

export interface OpenChatTabOptions {
  /** 绑定的 agent；缺省 = 由用户在 tab 里选。 */
  agentId?: string;
  /** 占位标题（缺省 `Agent Chat`）。 */
  title?: string;
  /** 其余 data 字段（Histor 恢复目标等）。 */
  data?: AgentChatTabDataPatch;
  /** 落组（pinned pane 内创建要跟随发起 pane）。 */
  targetGroup?: EditorGroupId | 'pinned';
}

/**
 * 在指定单元里创建并激活一条 agent-chat tab。
 *
 * @returns 新 tab 的 id（调用方 / 测试据此断言）。
 */
export function openAgentChatTab(
  workspace: WorkspaceSession,
  opts: OpenChatTabOptions = {},
): string {
  const tabId = generateTabId();
  const state = useEditorStore.getState();
  state.addTab(
    {
      id: tabId,
      scope: { kind: 'workspace', session: workspace },
      title: opts.title ?? 'Agent Chat',
      // `data` 先展开、`kind` 后写：调用方即使带上 `kind` 也覆盖不了 tab 的类型。
      data: { ...opts.data, kind: 'agent-chat', agentId: opts.agentId },
    },
    opts.targetGroup,
  );
  state.activateTab(workspace.key, tabId);
  return tabId;
}
