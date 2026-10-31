import { useCallback, useEffect, useRef, useState } from 'react';

import { listAgentModels } from '@/features/agent/api/agentApi';
import type { ModelInfo } from '@/features/agent/api/agentApi';
import {
  getConversationMessages,
  listConversations,
} from '@/features/conversation/api/conversationApi';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { ConversationMeta } from '@/shared/types/session';
import type { AgentChatTabData } from '@/shared/types/tab';
import type { ProjectId, WorkspaceSession } from '@/shared/utils/workspaceRef';

import { resumeAgentChat } from '../api/agentChatApi';
import type { ChatMessage } from '../components/messageModel';
import { nextBlockId, nextMsgId } from '../components/messageModel';
import { supportsChatResume } from '../utils/chatResumeSupport';
import { convertHistory } from '../utils/historyConvert';
import { matchModel } from '../utils/historyRestore';

/**
 * 「从历史会话恢复」的一整组事实：可恢复列表、拉取、恢复执行、以及 Histor
 * 面板入口的一次性自动恢复。
 *
 * # 为什么整组抽出来
 *
 * 恢复与消息流只有**两个接触点**（写入 `messages`、设置 `sessionIdRef`），
 * 其余全是 conversation 域的数据操作。留在 `useAgentChat` 里让那个 hook 继续
 * 贴 ratchet 线，而且每次改恢复流程都要动主 hook。
 *
 * # 两个必须由调用方提供的回调
 *
 * `setMessages` / `setSelectedModel` 是**状态所有权**所在（它们属于消息流与
 * composer），恢复流程只写不读，所以以回调注入而不是把整个状态搬进来 ——
 * 依赖方向仍是「恢复 → 消息流」，单向。
 */
export interface ChatRestore {
  /** 可恢复的会话列表（历史入口）。 */
  resumableList: ConversationMeta[];
  /** 列表加载中。 */
  resumableLoading: boolean;
  /** 拉取最近可恢复会话（跨 agent）。 */
  loadResumableList: () => Promise<void>;
  /** 从一条历史会话恢复为活跃 chat（对齐 agent/模型 + 渲染历史 + 建续写通道）。 */
  restoreConversation: (meta: ConversationMeta) => Promise<void>;
}

export function useChatRestore(params: {
  projectId: ProjectId;
  /** 执行地址（tab 所属工作区单元）：续写通道的 cwd 由它决定。 */
  workspace: WorkspaceSession;
  tabKey: string;
  tabId: string;
  /** 当前选中 agent（会话没有记录 agentId 时兜底）。 */
  fallbackAgentId: string;
  /** tab data 上的 Histor 恢复目标（一次性消费）。 */
  resumeConversationId: string | undefined;
  resumeNativeSessionId: string | undefined;
  /** 当前消息数：> 0 表示已有内容，不再自动恢复。 */
  messageCount: number;
  /** 写入消息流（所有权在调用方）。 */
  setMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  /** 设置选中模型（所有权在 composer）。 */
  setSelectedModel: (model: ModelInfo | null) => void;
  /** 恢复出的会话 id 写回（所有权在会话生命周期）。 */
  sessionIdRef: React.MutableRefObject<string | undefined>;
  /** 预置 agent 基线，使切换 effect 不清掉刚恢复的会话。 */
  primeAgentBaseline: (agentId: string) => void;
}): ChatRestore {
  const {
    projectId,
    workspace,
    tabKey,
    tabId,
    fallbackAgentId,
    resumeConversationId,
    resumeNativeSessionId,
    messageCount,
    setMessages,
    setSelectedModel,
    sessionIdRef,
    primeAgentBaseline,
  } = params;

  const projectPath = useProjectStore((s) => s.projects.find((p) => p.id === projectId)?.path);
  const [resumableList, setResumableList] = useState<ConversationMeta[]>([]);
  const [resumableLoading, setResumableLoading] = useState(false);

  /**
   * 拉取当前项目的最近可恢复会话列表（跨 agent，由条目自带 agentId）。
   *
   * 过滤条件是「有原生会话 id **且** 该 agent 支持 chat 恢复」：只按
   * `nativeSessionId` 过滤会列出 claude-code / codex 这类 CLI 能 `--resume`
   * 但 chat 侧没实现恢复的会话 —— 点击只会得到一句失败提示（死入口）。
   */
  const loadResumableList = useCallback(async () => {
    if (!projectPath) return;
    setResumableLoading(true);
    try {
      const page = await listConversations(projectPath, undefined, { limit: 20 });
      const candidates = page.items.filter((c) => c.nativeSessionId);
      const supported = await Promise.all(candidates.map((c) => supportsChatResume(c.agentId)));
      setResumableList(candidates.filter((_, i) => supported[i]));
    } catch {
      setResumableList([]);
    } finally {
      setResumableLoading(false);
    }
  }, [projectPath]);

  /**
   * 从历史会话恢复：切 agent/模型与该会话对齐 → 拉取消息渲染为只读流 →
   * 静默建立续写通道。之后用户输入经 agent_stream 的 sessionId 续写路径
   * 直达同一原生会话。
   */
  const restoreConversation = useCallback(
    async (meta: ConversationMeta) => {
      if (!meta.nativeSessionId) return;
      const targetAgentId = meta.agentId || fallbackAgentId;
      try {
        // 1. agent 与模型切换到会话所属配置（composer 选择器同步）。
        let targetModel: ModelInfo | undefined;
        if (meta.model) {
          try {
            const result = await listAgentModels(targetAgentId);
            // 只有拿到真实列表才能按 id 匹配；其余三种（会话内可选 / 不支持 / 失败）
            // 都没有可匹配的条目 → 回落 agent 默认模型。
            targetModel =
              result.kind === 'available' ? matchModel(result.models, meta.model) : undefined;
          } catch {
            /* 模型匹配失败 → 回落 agent 默认模型 */
          }
        }
        useEditorStore.getState().updateTab(tabKey, tabId, { agentId: targetAgentId });
        setSelectedModel(targetModel ?? null);
        // 预同步基线：agent 切换 effect 不得清空下面 resume 得到的
        // sessionId（否则恢复链路断裂）。模型不参与该判据。
        primeAgentBaseline(targetAgentId);

        // 2. 拉取历史渲染为只读流。
        try {
          const history = await getConversationMessages(meta.id);
          setMessages(() => convertHistory(history));
        } catch {
          // 历史渲染失败不回退整个恢复流程：续写通道仍可建立，仅丢失只读回放。
        }

        // 3. 静默建立续写通道。
        const sid = await resumeAgentChat(
          {
            agentId: targetAgentId,
            workspace,
            prompt: '',
            files: [],
            skills: [],
            mode: 'auto',
            modelId: targetModel?.id,
            topic: meta.userTitle || meta.title || undefined,
          },
          meta.nativeSessionId,
        );
        sessionIdRef.current = sid;
        useEditorStore.getState().updateTab(tabKey, tabId, { sessionId: sid });
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextMsgId(),
            role: 'system',
            blocks: [{ kind: 'text', id: nextBlockId(), text: `⚠ 恢复会话失败: ${String(err)}` }],
          },
        ]);
      }
    },
    [
      fallbackAgentId,
      projectId,
      workspace,
      tabKey,
      tabId,
      setSelectedModel,
      setMessages,
      sessionIdRef,
      primeAgentBaseline,
    ],
  );

  // ── Histor 面板入口恢复：tab data 携带 resume 目标时自动执行一次 ──────
  const doneRef = useRef(false);
  useEffect(() => {
    if (!resumeConversationId || !resumeNativeSessionId || doneRef.current || messageCount > 0) {
      return;
    }
    doneRef.current = true;
    void (async () => {
      try {
        if (await supportsChatResume(fallbackAgentId)) {
          await restoreConversation({
            id: resumeConversationId,
            nativeSessionId: resumeNativeSessionId,
          } as ConversationMeta);
        }
        // agent 不支持 chat resume → 跳过（入口本身已按支撑能力显隐）。
      } finally {
        // 一次性消费：清除 tab data 上的恢复标记，避免重挂载重复恢复。
        useEditorStore.getState().updateTab(tabKey, tabId, {
          resumeConversationId: undefined,
          resumeNativeSessionId: undefined,
        } as Partial<AgentChatTabData>);
      }
    })();
  }, [
    resumeConversationId,
    resumeNativeSessionId,
    fallbackAgentId,
    restoreConversation,
    messageCount,
    tabKey,
    tabId,
  ]);

  return { resumableList, resumableLoading, loadResumableList, restoreConversation };
}
