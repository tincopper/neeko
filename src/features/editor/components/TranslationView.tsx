import React, { useEffect, useMemo, useState } from 'react';

import { listAgentModels, type ModelInfo } from '@/features/agent/api/agentApi';
import { useAppContext } from '@/shared/contexts/AppContext';

import {
  splitDocumentBlocks,
  useDocumentTranslation,
  type UseDocumentTranslationParams,
} from '../translation/useDocumentTranslation';

import BlockPair from './translation/BlockPair';
import TranslationToolbar from './translation/TranslationToolbar';

/**
 * AI 译文视图：双语段落预览（临时、不落盘）。
 * 组合层：控制器（useDocumentTranslation）+ 工具条 + 块渲染；
 * 状态与交互逻辑全部在 translation/ 域内，本文件只做数据接线。
 */
const TranslationView: React.FC<UseDocumentTranslationParams> = (params) => {
  const { config } = useAppContext();
  const controller = useDocumentTranslation({
    ...params,
    defaultAgentId: config.translation?.agentId,
    defaultModelId: config.translation?.modelId,
    defaultTargetLanguage: config.translation?.targetLanguage,
  });
  const [models, setModels] = useState<ModelInfo[]>([]);

  // agent 变化 → 拉取其可用模型列表（失败静默，模型选择退回 agent 默认）
  useEffect(() => {
    if (!controller) return;
    let cancelled = false;
    // Defer to avoid sync setState in effect (can trigger cascading renders)
    Promise.resolve().then(() => {
      if (!cancelled) setModels([]);
    });
    listAgentModels(controller.agentId)
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // controller 仅取 agentId，依赖整对象会导致每帧重订阅；仅监听 agentId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller?.agentId]);

  // 未翻译（idle）：从当前内容切块展示原文，与翻译后的渲染器保持同一排版
  //（hooks 顺序：必须在条件 return 之前）
  const hasResult = (controller?.snapshot?.blocks.length ?? 0) > 0;
  const idleBlocks = useMemo(
    () => (hasResult ? [] : splitDocumentBlocks(params.filePath, params.content)),
    [hasResult, params.filePath, params.content],
  );

  if (!controller) return null;
  const { snapshot } = controller;
  if (!snapshot) return null;

  const running = snapshot.phase === 'running';
  const total = snapshot.blocks.length;
  const doneCount = snapshot.blocks.filter((b) => snapshot.translations[b.id] !== undefined).length;
  const isPlain = /\.(txt)$/i.test(params.filePath);
  const stale = snapshot.phase === 'stale';

  return (
    <div className="flex flex-col h-full min-h-0">
      <TranslationToolbar
        running={running}
        total={total}
        doneCount={doneCount}
        stale={stale}
        hasResult={hasResult}
        targetLanguage={controller.targetLanguage}
        agentId={controller.agentId}
        modelId={controller.modelId}
        chatAgents={controller.chatAgents}
        models={models}
        bilingual={controller.bilingual}
        onTargetLanguageChange={controller.setTargetLanguage}
        onAgentChange={controller.setAgentId}
        onModelChange={controller.setModelId}
        onBilingualChange={controller.setBilingual}
        onStop={controller.stop}
        onRetranslate={controller.retranslate}
      />

      {/* 双语文档；未翻译时显示原文（同一块渲染器，仅源文侧） */}
      <div className="flex-1 overflow-y-auto min-h-0 px-8 py-6 text-sm leading-relaxed">
        {hasResult ? (
          <div className="max-w-3xl mx-auto flex flex-col gap-3.5">
            {snapshot.blocks.map((b) => (
              <BlockPair
                key={b.id}
                block={b}
                translation={snapshot.translations[b.id]}
                failed={snapshot.failedIds.includes(b.id)}
                running={running}
                bilingual={controller.bilingual}
                isPlain={isPlain}
                onRetry={controller.retryFailed}
              />
            ))}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-3.5">
            {idleBlocks.map((b) => (
              <BlockPair
                key={b.id}
                block={b}
                failed={false}
                running={false}
                // idle 仅展示原文：src 侧常显、dst 无译文自然不渲染
                bilingual
                isPlain={isPlain}
                onRetry={controller.retryFailed}
              />
            ))}
            {idleBlocks.length === 0 && (
              <div className="text-text-muted text-center py-8">没有可翻译的段落</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(TranslationView);
