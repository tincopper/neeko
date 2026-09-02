import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useEditorContext } from '@/shared/contexts';
import { agentCapabilities } from '@/shared/types/agent';
import { isMarkdownFile } from '@/shared/utils/codemirror';
import { isHtmlFile, isTxtFile } from '@/shared/utils/fileTree';

import { splitHtmlBlocks, splitMarkdownBlocks, splitTextBlocks } from './blocks';
import {
  ensureTranslationTabCleanupRegistered,
  registerAbortController,
  translationKeyFor,
  unregisterAbortController,
} from './cleanup';
import { planBatchesAndTranslate } from './pipeline';
import { useTranslationStore } from './store';
import { createTauriTurn } from './tauriTurn';

/** 批次 token 预算（约一次请求 3-5 个中等段落） */
const TOKEN_BUDGET = 2000;

export const DEFAULT_TARGET_LANGUAGE = '简体中文';

/** 按文件类型切分文档块（md AST / HTML DOM / txt 空行） */
export function splitDocumentBlocks(filePath: string, content: string) {
  if (isMarkdownFile(filePath)) return splitMarkdownBlocks(content);
  if (isHtmlFile(filePath)) return splitHtmlBlocks(content);
  if (isTxtFile(filePath)) return splitTextBlocks(content);
  return [];
}

export function isTranslatableFile(filePath: string): boolean {
  return isMarkdownFile(filePath) || isHtmlFile(filePath) || isTxtFile(filePath);
}

export interface UseDocumentTranslationParams {
  filePath: string;
  content: string;
  projectId: string;
  /** 设置中的默认项（AppConfig.translation） */
  defaultAgentId?: string;
  defaultModelId?: string;
  defaultTargetLanguage?: string;
  /** 仅在「Translate」视图激活时驱动 */
  enabled: boolean;
}

/**
 * 译文视图控制器。
 *
 * 交互契约：进入视图只初始化选择器（不翻译），用户确认语言 / Agent / 模型后
 * 点击「Translate」才发起；选择器状态持久于 store，视图切换往返不丢。
 * 翻译状态按文件（projectId + filePath）键控——不同文件互不串扰；
 * 关闭文件 tab 时由 tab cleanup 回收状态并中止进行中的翻译。
 */
export function useDocumentTranslation({
  filePath,
  content,
  projectId,
  defaultAgentId,
  defaultModelId,
  defaultTargetLanguage,
  enabled,
}: UseDocumentTranslationParams) {
  const { agents } = useEditorContext();
  // 按文件键控（项目 tabKey 是项目级的，跨文件共享会导致内容串扰）
  const tabKey = useMemo(() => translationKeyFor(projectId, filePath), [projectId, filePath]);
  ensureTranslationTabCleanupRegistered();
  const snapshot = useTranslationStore((s) => s.byTab[tabKey]);
  const initSelectors = useTranslationStore((s) => s.initSelectors);
  const setSelectors = useTranslationStore((s) => s.setSelectors);
  const startInStore = useTranslationStore((s) => s.start);
  const setTranslations = useTranslationStore((s) => s.setTranslations);
  const setFailed = useTranslationStore((s) => s.setFailed);
  const setPhase = useTranslationStore((s) => s.setPhase);
  const markStale = useTranslationStore((s) => s.markStale);

  // 翻译走 AgentAdapter 抽象（adapter_for），仅 CHAT 能力的 agent 可选
  const chatAgents = useMemo(
    () => agents.filter((a) => a.enabled && agentCapabilities(a).chat),
    [agents],
  );

  const [bilingual, setBilingual] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // 进入视图：初始化选择器（已有条目则原样保留，不覆盖用户选择）
  useEffect(() => {
    if (!enabled) return;
    // 设置默认值不是 chat agent（或未配置）时回退到第一个 chat agent
    const validAgentId = chatAgents.some((a) => a.id === defaultAgentId)
      ? (defaultAgentId as string)
      : chatAgents[0]?.id || 'opencode';
    initSelectors(tabKey, {
      targetLanguage: defaultTargetLanguage || DEFAULT_TARGET_LANGUAGE,
      agentId: validAgentId,
      modelId: defaultModelId || null,
    });
    // defaults 与 chatAgents 变化不覆盖已初始化的选择器，故不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tabKey]);

  // 底层文件内容变更 → 已有译文标记过期（不自动重译，共识 Q9）
  useEffect(() => {
    if (!enabled || !snapshot?.source) return;
    if (snapshot.source !== content && snapshot.phase !== 'stale') {
      markStale(tabKey);
    }
  }, [content, enabled, snapshot, tabKey, markStale]);

  const start = useCallback(() => {
    const current = useTranslationStore.getState().byTab[tabKey];
    if (!current) return;
    const blocks = splitDocumentBlocks(filePath, content);
    if (blocks.length === 0) return;

    // 存储的选择器可能因 agent 能力变化而失效 → 发起前再校验一次
    const agentId = chatAgents.some((a) => a.id === current.agentId)
      ? current.agentId
      : chatAgents[0]?.id || current.agentId;

    startInStore(tabKey, { source: content, blocks });
    const controller = new AbortController();
    abortRef.current = controller;
    registerAbortController(tabKey, controller);
    const turn = createTauriTurn({
      agentId,
      projectId,
      modelId: current.modelId,
      onError: (message) => console.error('[translation]', message),
    });
    planBatchesAndTranslate(blocks, {
      targetLanguage: current.targetLanguage,
      tokenBudget: TOKEN_BUDGET,
      turn,
      signal: controller.signal,
      onBlockDone: (map) => setTranslations(tabKey, map),
      onBlockFail: (ids) => setFailed(tabKey, ids),
    })
      .finally(() => unregisterAbortController(tabKey, controller))
      .then((result) => setPhase(tabKey, result.aborted ? 'aborted' : 'done'))
      .catch(() => setPhase(tabKey, 'aborted'));
  }, [
    chatAgents,
    content,
    filePath,
    projectId,
    setFailed,
    setPhase,
    setTranslations,
    startInStore,
    tabKey,
  ]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retranslate = useCallback(() => {
    stop();
    start();
  }, [start, stop]);

  /** 失败段单段重试（只重跑失败块，成功译文保留） */
  const retryFailed = useCallback(() => {
    if (!snapshot) return;
    const failedBlocks = snapshot.blocks.filter((b) => snapshot.failedIds.includes(b.id));
    if (failedBlocks.length === 0) return;
    setPhase(tabKey, 'running');
    const controller = new AbortController();
    abortRef.current = controller;
    registerAbortController(tabKey, controller);
    const turn = createTauriTurn({
      agentId: snapshot.agentId,
      projectId,
      modelId: snapshot.modelId,
      onError: (message) => console.error('[translation]', message),
    });
    planBatchesAndTranslate(failedBlocks, {
      targetLanguage: snapshot.targetLanguage,
      tokenBudget: TOKEN_BUDGET,
      turn,
      signal: controller.signal,
      onBlockDone: (map) => setTranslations(tabKey, map),
      onBlockFail: (ids) => setFailed(tabKey, ids),
    })
      .finally(() => unregisterAbortController(tabKey, controller))
      .then(() => {
        const failed = useTranslationStore.getState().byTab[tabKey]?.failedIds ?? [];
        setPhase(tabKey, failed.length > 0 ? 'aborted' : 'done');
      })
      .catch(() => setPhase(tabKey, 'aborted'));
  }, [projectId, setFailed, setPhase, setTranslations, snapshot, tabKey]);

  /** 非可翻译文件不驱动任何逻辑 */
  if (!isTranslatableFile(filePath)) {
    return null;
  }

  return {
    snapshot,
    chatAgents,
    targetLanguage: snapshot?.targetLanguage ?? DEFAULT_TARGET_LANGUAGE,
    agentId: snapshot?.agentId ?? chatAgents[0]?.id ?? 'opencode',
    modelId: snapshot?.modelId ?? null,
    bilingual,
    setTargetLanguage: (v: string) => setSelectors(tabKey, { targetLanguage: v }),
    setAgentId: (v: string) => setSelectors(tabKey, { agentId: v }),
    setModelId: (v: string | null) => setSelectors(tabKey, { modelId: v }),
    setBilingual,
    start,
    stop,
    retranslate,
    retryFailed,
  };
}
