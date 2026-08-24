import type { ModelInfo } from '@/features/agent/api/agentApi';

/**
 * 把历史会话记录的 model 字符串匹配回 ModelInfo。
 *
 * opencode 等框架持久化的是 `providerID/modelID` 复合串；优先按复合键精确
 * 匹配，再回退单段 id 匹配。无匹配返回 `undefined`（回落 agent 默认模型），
 * 由调用方决定是否 setSelectedModel。
 */
export function matchModel(
  models: ModelInfo[],
  historyModel: string | null | undefined,
): ModelInfo | undefined {
  if (!historyModel) return undefined;
  const [provider, ...rest] = historyModel.split('/');
  const bareId = rest.join('/') || provider;
  const composite = rest.length > 0 ? historyModel : undefined;
  return (
    (composite && models.find((m) => m.id === bareId && m.provider_id === provider)) ||
    models.find((m) => m.id === bareId) ||
    models.find((m) => m.id === historyModel) ||
    undefined
  );
}
