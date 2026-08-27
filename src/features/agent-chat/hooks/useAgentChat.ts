import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listChatAgents, listAgentModels } from '@/features/agent/api/agentApi';
import type { ModelInfo } from '@/features/agent/api/agentApi';
import {
  getConversationMessages,
  listConversations,
} from '@/features/conversation/api/conversationApi';
import { AGENT_IDS } from '@/shared/constants/agentIds';
import { AGENT_CHAT_EVENT } from '@/shared/events';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { AgentConfig } from '@/shared/types/agent';
import type { SequencedEvent } from '@/shared/types/agentChat';
import type { ConversationMeta } from '@/shared/types/session';
import type { AgentChatTabData } from '@/shared/types/tab';

import {
  approveAgentCall,
  cancelAgentStream,
  resumeAgentChat,
  sendAgentInput,
  startAgentChat,
  supportsAgentChatResume,
} from '../api/agentChatApi';
import { loadCachedMessages, saveCachedMessages } from '../components/messageCache';
import {
  appendDelta,
  nextBlockId,
  nextMsgId,
  type Attachment,
  type ChatMessage,
  type PendingUserInput,
} from '../components/messageModel';
import type { PendingApproval, ToolCard, WorkedSummary } from '../types';
import { formatChatTime } from '../utils/chatFormat';
import { convertHistory } from '../utils/historyConvert';
import { matchModel } from '../utils/historyRestore';
import { normalizeToolName } from '../utils/toolNames';

import { appendBlock, appendCommandBlock, attachFileDiff, findToolBlock } from './streamReducers';
import { useDeltaBatcher, type PendingDelta } from './useDeltaBatcher';
import { useMockEventSchedule } from './useMockEventSchedule';

/** 单个 tool 输出字符上限：超过后保留尾部窗口，防无界拼接（内存治理 P2）。 */
const MAX_TOOL_OUTPUT_CHARS = 128 * 1024;
/** tool 输出截断标记。 */
const TOOL_OUTPUT_TRUNCATED_MARK = '\n[output truncated - showing tail]\n';

/** 追加 tool 输出并限制上限：超限后滑动保留尾部窗口，标记仅注入一次。 */
function clipToolOutput(existing: string | undefined, delta: string): string {
  const next = (existing ?? '') + delta;
  if (next.length <= MAX_TOOL_OUTPUT_CHARS) return next;
  const tail = next.slice(-MAX_TOOL_OUTPUT_CHARS);
  const alreadyMarked = (existing ?? '').includes(TOOL_OUTPUT_TRUNCATED_MARK);
  return (alreadyMarked ? '' : TOOL_OUTPUT_TRUNCATED_MARK) + tail;
}

export interface UseAgentChatParams {
  tabKey: string;
  tabId: string;
  projectId: string;
  data: AgentChatTabData;
  /** 是否启用 mock 模式（开发/演示用）。 */
  mockMode: boolean;
}

/**
 * Agent Chat 数据流域 hook —— 会话状态、事件流处理与后端交互的唯一入口。
 * 组件层（AgentChatTabView）只保留 DOM refs、滚动跟随与 JSX 布局。
 */
export function useAgentChat({ tabKey, tabId, projectId, data, mockMode }: UseAgentChatParams) {
  const { agentId, sessionId: initialSessionId } = data;
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadCachedMessages(tabId) ?? []);

  // 流式增量 rAF 批处理：text/reasoning delta 合并为一个动画帧 flush，避免逐 token 全量 setState
  const { push: pushDelta, flush: flushDeltas } = useDeltaBatcher(
    useCallback((deltas: PendingDelta[]) => {
      setMessages((prev) => {
        let next = prev;
        for (const d of deltas) {
          next = appendDelta(next, d.kind, d.delta);
        }
        return next;
      });
    }, []),
  );
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [agentMode, setAgentMode] = useState('build');
  const [thinkingLevel, setThinkingLevel] = useState('high');
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingUserInput, setPendingUserInput] = useState<PendingUserInput | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [chatAgents, setChatAgents] = useState<AgentConfig[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [ctxInfo, setCtxInfo] = useState<{
    projectName: string;
    env: string;
    /** 工作目录（后端 AgentContext.project_id 即项目绝对路径/cwd）。 */
    projectPath?: string;
  } | null>(null);
  const [proposedPlan, setProposedPlan] = useState<string | null>(null);
  const [contextWindow, setContextWindow] = useState<{
    used: number;
    total: number;
    model: string;
  } | null>(null);

  // 切换 agent 或模型时清空 sessionId：会话与「agent + model」绑定，复用旧会话
  // 会把新 agent/模型的请求路由到旧会话（旧模型）——日志实证：agent 切到
  // opencode 后 agent_stream 仍继续了 mockAgent 的旧会话。
  const prevAgentModelRef = useRef<string>('');
  const sessionIdRef = useRef<string | undefined>(initialSessionId);
  useEffect(() => {
    const key = `${agentId ?? ''}:${selectedModel?.id ?? ''}`;
    const prevKey = prevAgentModelRef.current;
    prevAgentModelRef.current = key;
    // 首次挂载不清空（key 从空串起步，等价于"尚无会话上下文"）；
    // 仅当 agent 或模型真正变化时清空。
    if (prevKey !== '' && prevKey !== key) {
      sessionIdRef.current = undefined;
      useEditorStore.getState().updateTab(tabKey, tabId, { sessionId: undefined });
    }
  }, [agentId, selectedModel?.id, tabKey, tabId]);

  // 消息变更时同步写入缓存（解决切换 tab 后消息丢失问题）
  useEffect(() => {
    saveCachedMessages(tabId, messages);
  }, [tabId, messages]);

  const pendingEventsRef = useRef<SequencedEvent[]>([]);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const turnStartRef = useRef<number | null>(null);
  const turnCountsRef = useRef({ ran: 0, edited: 0, searched: 0 });
  const turnToolsRef = useRef<ToolCard[]>([]);
  const approvalSeqRef = useRef(0);
  const autoApproveToolsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let disposed = false;
    void listChatAgents()
      .then((agents) => {
        if (!disposed) setChatAgents(agents);
      })
      .catch(() => {
        if (!disposed) setChatAgents([]);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!agentId) return;
    let disposed = false;
    void listAgentModels(agentId)
      .then((modelList) => {
        if (!disposed) {
          setModels(modelList);
          // Auto-select the first model or the one with default reasoning effort.
          if (modelList.length > 0) {
            const defaultModel = modelList.find((m) => m.default_reasoning_effort) ?? modelList[0];
            setSelectedModel(defaultModel);
          }
        }
      })
      .catch(() => {
        if (!disposed) {
          setModels([]);
        }
      });
    return () => {
      disposed = true;
    };
  }, [agentId]);

  const selectedAgent = useMemo(() => {
    const found = agentId ? chatAgents.find((a) => a.id === agentId) : undefined;
    if (found) {
      return { id: found.id, name: found.name, icon: found.icon };
    }
    const fallback = agentId ?? AGENT_IDS.mockAgent;
    return { id: fallback, name: fallback, icon: null };
  }, [chatAgents, agentId]);

  const fileCount = attachments.filter((a) => a.type === 'FILE').length;
  const skillCount = attachments.filter((a) => a.type === 'SKILL').length;

  const applyEvent = useCallback(
    (seqEv: SequencedEvent) => {
      const ev = seqEv;
      switch (ev.type) {
        case 'session_start':
          // Session started - context will be set via context_init
          break;
        case 'context_init':
          setCtxInfo({
            projectName: ev.project_name,
            env: ev.env,
            projectPath: ev.project_id,
          });
          break;
        case 'turn_start':
          flushDeltas();
          turnStartRef.current = Date.now();
          turnCountsRef.current = { ran: 0, edited: 0, searched: 0 };
          turnToolsRef.current = [];
          break;
        case 'text_delta':
          // 累积到 rAF 批处理 buffer，动画帧内一次性 flush
          pushDelta('text', ev.delta);
          break;
        case 'reasoning_delta':
          pushDelta('reasoning', ev.delta);
          break;
        case 'tool_start': {
          // 先冲刷滞留在 rAF 批处理 buffer 中的文本增量，再追加工具块：
          // 保持「先输出意图 → 再执行工具」的流式时序（后端一次 burst 连发时，
          // 文本 delta 尚未到动画帧 flush，若不冲刷会出现「工具在前、文本在后」）。
          flushDeltas();
          // 去重：同一 callId 可能因后端重复 ToolStart（如 opencode serve 的
          // pending + running）而到达两次。话轮内已记工具（turnToolsRef）已含该
          // callId 即视为重复，忽略本次，避免同一任务渲染成两行。
          const alreadySeen = turnToolsRef.current.some((t) => t.callId === ev.call_id);
          if (alreadySeen) {
            break;
          }
          // 工具名归一化：opencode 等框架的原始名（edit/read/exec_command…）
          // 对齐标准名，保证 WorkRows 卡片分派与话轮计数在 live 流和历史
          // 恢复（historyConvert）两条链路行为一致。
          const normName = normalizeToolName(ev.name);
          const tool: ToolCard = {
            callId: ev.call_id,
            name: normName,
            title: ev.title,
            status: 'running',
          };
          if (normName === 'read_file' || normName === 'search' || normName === 'grep') {
            turnCountsRef.current.searched += 1;
          } else if (normName === 'edit_file' || normName === 'write_file') {
            turnCountsRef.current.edited += 1;
          } else {
            turnCountsRef.current.ran += 1;
          }
          turnToolsRef.current.push(tool);
          // 按时序追加 tool block：末尾消息是 assistant 则追加，否则新建消息
          setMessages((prev) =>
            appendBlock(prev, {
              kind: 'tool',
              id: nextBlockId(),
              tool,
            }),
          );
          break;
        }
        case 'tool_output':
          // 跨消息查找对应 tool block 并累积 output
          setMessages((prev) => {
            const found = findToolBlock(prev, ev.call_id);
            if (!found) return prev;
            return prev.map((m, i) =>
              i === found.msgIndex
                ? {
                    ...m,
                    blocks: m.blocks.map((b, j) =>
                      j === found.blockIndex && b.kind === 'tool'
                        ? {
                            ...b,
                            tool: { ...b.tool, output: clipToolOutput(b.tool.output, ev.output) },
                          }
                        : b,
                    ),
                  }
                : m,
            );
          });
          break;
        case 'tool_end':
          // 跨消息查找对应 tool block 并更新 status
          setMessages((prev) => {
            const found = findToolBlock(prev, ev.call_id);
            if (!found) return prev;
            return prev.map((m, i) =>
              i === found.msgIndex
                ? {
                    ...m,
                    blocks: m.blocks.map((b, j) =>
                      j === found.blockIndex && b.kind === 'tool'
                        ? {
                            ...b,
                            tool: {
                              ...b.tool,
                              status: ev.status === 'failed' ? 'failed' : 'done',
                            },
                          }
                        : b,
                    ),
                  }
                : m,
            );
          });
          break;
        case 'command_run':
          // 同 tool_start：先冲刷文本增量，保证命令前的说明文本渲染在其卡片之前。
          flushDeltas();
          turnCountsRef.current.ran += 1;
          turnToolsRef.current.push({
            callId: ev.call_id,
            name: 'run_command',
            title: ev.cmd,
            status: 'running',
          });
          // 按时序追加 command tool block
          setMessages((prev) =>
            appendCommandBlock(prev, {
              kind: 'tool',
              id: nextBlockId(),
              tool: {
                callId: ev.call_id,
                name: 'run_command',
                title: ev.cmd,
                status: 'running',
              },
            }),
          );
          break;
        case 'todo_updated':
          // 保持时序：追加非文本块前先冲刷文本增量。
          flushDeltas();
          // 按时序追加 todos block
          setMessages((prev) =>
            appendBlock(prev, {
              kind: 'todos',
              id: nextBlockId(),
              todos: ev.todos,
            }),
          );
          break;
        case 'file_diff':
          // 保持时序：追加 diff 块前先冲刷文本增量。
          flushDeltas();
          setMessages((prev) => attachFileDiff(prev, ev.path, ev.diff));
          break;
        case 'request_approval':
          approvalSeqRef.current += 1;
          if (autoApproveToolsRef.current.has(ev.tool)) {
            void (async () => {
              const sid = sessionIdRef.current;
              if (!sid) return;
              try {
                await approveAgentCall(sid, ev.call_id, true);
              } catch {
                /* auto-approve failed; ignore */
              }
            })();
            break;
          }
          setPendingApproval({
            callId: ev.call_id,
            tool: ev.tool,
            title: ev.title,
            prompt: ev.prompt,
            diff: ev.diff,
            cmd: ev.cmd,
            index: approvalSeqRef.current,
            total: approvalSeqRef.current,
          });
          break;
        case 'user_input':
          setPendingUserInput({ turnId: ev.turn_id, prompt: ev.prompt, options: ev.options });
          break;
        case 'proposed_plan':
          setProposedPlan(ev.plan);
          break;
        case 'meta':
          if (ev.usage) {
            setContextWindow({
              used: ev.usage.input_tokens ?? 0,
              total: (ev.usage.input_tokens ?? 0) + (ev.usage.output_tokens ?? 0),
              model: ev.model ?? 'unknown',
            });
          }
          break;
        case 'turn_end':
          flushDeltas();
          setStreaming(false);
          // 把所有 running 状态的 tool block 标记为 done
          setMessages((prev) =>
            prev.map((m) => ({
              ...m,
              blocks: m.blocks.map((b) =>
                b.kind === 'tool' && b.tool.status === 'running'
                  ? { ...b, tool: { ...b.tool, status: 'done' } }
                  : b,
              ),
            })),
          );
          if (turnStartRef.current != null) {
            const durationMs = Date.now() - turnStartRef.current;
            const summary: WorkedSummary = {
              durationMs,
              ran: turnCountsRef.current.ran,
              edited: turnCountsRef.current.edited,
              searched: turnCountsRef.current.searched,
              tools: turnToolsRef.current.map((t) => ({
                ...t,
                status: t.status === 'failed' ? 'failed' : 'done',
              })),
            };
            turnStartRef.current = null;
            if (summary.tools.length > 0) {
              // 按时序追加 worked block
              setMessages((prev) =>
                appendBlock(prev, {
                  kind: 'worked',
                  id: nextBlockId(),
                  worked: summary,
                }),
              );
            }
          }
          break;
        case 'session_done':
          flushDeltas();
          setStreaming(false);
          setMessages((prev) => [
            ...prev,
            {
              id: nextMsgId(),
              role: 'system',
              blocks: [{ kind: 'text', id: nextBlockId(), text: `会话已结束（${ev.reason}）` }],
            },
          ]);
          break;
        case 'error':
          flushDeltas();
          setStreaming(false);
          setMessages((prev) => [
            ...prev,
            {
              id: nextMsgId(),
              role: 'system',
              blocks: [{ kind: 'text', id: nextBlockId(), text: `⚠ ${ev.message} (${ev.code})` }],
            },
          ]);
          break;
        default:
          break;
      }
    },
    [flushDeltas, pushDelta],
  );

  useEffect(() => {
    let disposed = false;
    void (async () => {
      // 方案 B1（合帧）：Rust 侧 bridge 按 16ms 窗口聚合 emit 数组（一次事件
      // = 一次 evaluateJavaScript，macOS 上 Tauri 事件送达即 eval），payload
      // 可能为 SequencedEvent[]（合帧）或单条 SequencedEvent（错误/边界），
      // 这里统一归一为数组顺序应用（reducer 按 seq 幂等，顺序即正确时序）。
      const unlisten = await listen<SequencedEvent[] | SequencedEvent>(
        AGENT_CHAT_EVENT,
        (event) => {
          const evs = Array.isArray(event.payload) ? event.payload : [event.payload];
          for (const seqEv of evs) {
            const sid = sessionIdRef.current;
            if (sid) {
              if (seqEv.session_id === sid) applyEvent(seqEv);
            } else {
              pendingEventsRef.current.push(seqEv);
            }
          }
        },
      );
      if (disposed) {
        unlisten();
      } else {
        unlistenRef.current = unlisten;
      }
    })();
    return () => {
      disposed = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [applyEvent]);

  // Mock 模式：模拟 agent loop 的事件序列（开发/演示用）
  // 真实 agent 中文本和工具调用是穿插进行的：
  //   思考 → 输出文本 → 调用工具A → 处理结果 → 继续输出 → 调用工具B → ...
  // Mock 模式启动时标记 streaming
  useEffect(() => {
    if (mockMode) setStreaming(true);
  }, [mockMode]);

  // Mock 模式：开发/演示用事件序列（与真实流共用 applyEvent reducer）
  useMockEventSchedule({
    mockMode,
    sessionId: data.sessionId,
    projectId,
    applyEvent,
    sessionIdRef,
    turnStartRef,
    turnCountsRef,
    turnToolsRef,
  });

  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid) {
        void cancelAgentStream(sid).catch(() => undefined);
      }
    };
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setMessages((prev) => [
      ...prev,
      {
        id: nextMsgId(),
        role: 'user',
        blocks: [{ kind: 'text' as const, id: nextBlockId(), text }],
        ts: formatChatTime(new Date()),
      },
    ]);
    setInput('');
    setStreaming(true);
    turnStartRef.current = Date.now();
    turnCountsRef.current = { ran: 0, edited: 0, searched: 0 };
    turnToolsRef.current = [];
    try {
      const sid = await startAgentChat({
        agentId: selectedAgent.id,
        projectId,
        prompt: text,
        files: attachments.filter((a) => a.type === 'FILE').map((a) => a.name),
        skills: attachments.filter((a) => a.type === 'SKILL').map((a) => a.name),
        mode: 'auto',
        sessionId: sessionIdRef.current,
        modelId: selectedModel?.id,
      });
      sessionIdRef.current = sid;
      useEditorStore.getState().updateTab(tabKey, tabId, { sessionId: sid });
      const buffered = pendingEventsRef.current;
      pendingEventsRef.current = [];
      buffered.filter((seqEv) => seqEv.session_id === sid).forEach(applyEvent);
    } catch (err) {
      setStreaming(false);
      setMessages((prev) => [
        ...prev,
        {
          id: nextMsgId(),
          role: 'system',
          blocks: [
            {
              kind: 'text' as const,
              id: nextBlockId(),
              text: `⚠ 启动会话失败: ${String(err)}`,
            },
          ],
        },
      ]);
    }
  }, [
    input,
    streaming,
    selectedAgent.id,
    projectId,
    attachments,
    tabKey,
    tabId,
    applyEvent,
    selectedModel,
  ]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleApproval = useCallback(
    async (allow: boolean) => {
      const pending = pendingApproval;
      if (!pending) return;
      setPendingApproval(null);
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        await approveAgentCall(sid, pending.callId, allow);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextMsgId(),
            role: 'system',
            blocks: [
              {
                kind: 'text' as const,
                id: nextBlockId(),
                text: `⚠ 审批失败: ${String(err)}`,
              },
            ],
          },
        ]);
      }
    },
    [pendingApproval],
  );

  const handleAllowSession = useCallback(() => {
    const pending = pendingApproval;
    if (!pending) return;
    autoApproveToolsRef.current.add(pending.tool);
    setPendingApproval(null);
    void handleApproval(true);
  }, [pendingApproval, handleApproval]);

  const handleCancelTurn = useCallback(() => {
    setPendingApproval(null);
    setPendingUserInput(null);
    setStreaming(false);
    const sid = sessionIdRef.current;
    if (sid) {
      void cancelAgentStream(sid).catch(() => undefined);
    }
  }, []);

  const handleUserInput = useCallback(
    async (text: string) => {
      const pending = pendingUserInput;
      if (!pending) return;
      setPendingUserInput(null);
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        await sendAgentInput(sid, pending.turnId, text);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextMsgId(),
            role: 'system',
            blocks: [
              {
                kind: 'text' as const,
                id: nextBlockId(),
                text: `⚠ 发送澄清失败: ${String(err)}`,
              },
            ],
          },
        ]);
      }
    },
    [pendingUserInput],
  );

  const handleStop = useCallback(() => {
    const sid = sessionIdRef.current;
    if (sid) {
      void cancelAgentStream(sid).catch(() => undefined);
      setStreaming(false);
    }
  }, []);

  // ── 会话恢复（方案 C+：复用 conversation 域数据源，跨 agent 列表） ──────
  const projectPath = useProjectStore((s) => s.projects.find((p) => p.id === projectId)?.path);
  const [resumableList, setResumableList] = useState<ConversationMeta[]>([]);
  const [resumableLoading, setResumableLoading] = useState(false);

  /** 拉取当前项目的最近可恢复会话列表（跨 agent，由条目自带 agentId）。 */
  const loadResumableList = useCallback(async () => {
    if (!projectPath) return;
    setResumableLoading(true);
    try {
      const page = await listConversations(projectPath, undefined, { limit: 20 });
      // 仅列出有原生会话 id 的条目（resume 依赖 nativeSessionId）。
      setResumableList(page.items.filter((c) => c.nativeSessionId));
    } catch (err) {
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
      const targetAgentId = meta.agentId || selectedAgent.id;
      try {
        // 1. agent 与模型切换到会话所属配置（composer 选择器同步）。
        let targetModel: ModelInfo | undefined;
        if (meta.model) {
          try {
            const models = await listAgentModels(targetAgentId);
            targetModel = matchModel(models, meta.model);
          } catch {
            /* 模型匹配失败 → 回落 agent 默认模型 */
          }
        }
        useEditorStore.getState().updateTab(tabKey, tabId, { agentId: targetAgentId });
        setSelectedModel(targetModel ?? null);
        // 预同步 prevAgentModel 基线：agent/model 切换 effect 不得清空
        // 下面 resume 得到的 sessionId（否则恢复链路断裂）。
        prevAgentModelRef.current = `${targetAgentId}:${targetModel?.id ?? ''}`;

        // 2. 拉取历史渲染为只读流。
        try {
          const history = await getConversationMessages(meta.id);
          setMessages(convertHistory(history));
        } catch {
          // 历史渲染失败不回退整个恢复流程：续写通道仍可建立，仅丢失只读回放。
        }

        // 3. 静默建立续写通道。
        const sid = await resumeAgentChat(
          {
            agentId: targetAgentId,
            projectId,
            prompt: '',
            files: [],
            skills: [],
            mode: 'auto',
            modelId: targetModel?.id,
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
    [selectedAgent.id, projectId, tabKey, tabId],
  );

  // ── Histor 面板入口恢复：tab data 携带 resume 目标时自动执行一次 ──────
  const { resumeConversationId, resumeNativeSessionId } = data;
  const historResumeDoneRef = useRef(false);
  useEffect(() => {
    if (
      !resumeConversationId ||
      !resumeNativeSessionId ||
      historResumeDoneRef.current ||
      messages.length > 0
    ) {
      return;
    }
    historResumeDoneRef.current = true;
    void (async () => {
      try {
        if (await supportsAgentChatResume(selectedAgent.id)) {
          await restoreConversation({
            id: resumeConversationId,
            nativeSessionId: resumeNativeSessionId,
          } as ConversationMeta);
        } else {
          // agent does not support chat resume, skipping histor restore
        }
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
    selectedAgent.id,
    restoreConversation,
    messages.length,
    tabKey,
    tabId,
  ]);

  return {
    // 会话状态
    messages,
    streaming,
    pendingApproval,
    pendingUserInput,
    proposedPlan,
    contextWindow,
    ctxInfo,
    // composer 态
    input,
    setInput,
    attachments,
    removeAttachment,
    agentMode,
    setAgentMode,
    thinkingLevel,
    setThinkingLevel,
    fileCount,
    skillCount,
    // agent/model 选择态
    chatAgents,
    models,
    selectedModel,
    setSelectedModel,
    selectedAgent,
    // actions
    handleSend,
    handleApproval,
    handleAllowSession,
    handleCancelTurn,
    handleUserInput,
    handleStop,
    // 会话恢复（方案 C+）
    resumableList,
    resumableLoading,
    loadResumableList,
    restoreConversation,
  };
}
