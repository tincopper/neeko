import { Box, Brain, Gem, Sparkles, Zap } from 'lucide-react';

import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';
import FallbackImage from '@/shared/components/FallbackImage';
import { modelVendorOf, type ModelVendor } from '@/shared/utils/modelVendor';

/**
 * 模型图标：优先用厂商品牌 logo，没有资源的厂商用语义化兜底图标，
 * 认不出厂商的用中性图标。
 *
 * # 为什么不直接用 agent 图标
 *
 * 列表里每一项是**模型**，不是 agent。同一个 agent（Pi）能挂 15 个 provider
 * 的 224 个模型 —— 全显示 Pi 的 logo 等于没有信息量。
 *
 * # 为什么有些厂商只能兜底
 *
 * 协议里没有图标字段（Pi 的模型条目只有 `id/name/provider/...`），厂商靠命名
 * 推断。仓里现成的品牌资源只有 6 个（Claude / OpenAI / Gemini / opencode /
 * Qoder / Grok），其余厂商没有 logo 可用 —— 用语义化图标区分「这是另一家」，
 * 比套一个错误的品牌好。
 */
const VENDOR_ICON: Partial<Record<ModelVendor, string>> = {
  anthropic: 'claude-code.png',
  openai: 'codex.png',
  google: 'gemini.png',
  opencode: 'opencode.png',
  xiaomi: 'mimo.png',
  // 有品牌资源的厂商一律用真 logo（比语义兜底图标信息量大）。
  // 加图时必须在 `shared/utils/agents.ts` 的 `AGENT_ICONS` 里同时登记，
  // 否则 Vite 不打包该文件 → `<img>` 加载失败后静默回落到兜底图标。
  deepseek: 'deepseek.svg',
  zhipu: 'glm.svg',
};

/** 没有品牌资源时的语义兜底（按厂商的“气质”选一个稳定图标）。 */
function fallbackIconFor(vendor: ModelVendor | null) {
  switch (vendor) {
    case 'deepseek':
    case 'moonshot':
      return <Brain size={14} />;
    case 'qwen':
    case 'minimax':
      return <Gem size={14} />;
    case 'zhipu':
    case 'mistral':
    case 'meta':
      return <Sparkles size={14} />;
    case 'xai':
    case 'bytedance':
    case 'stepfun':
    case 'nvidia':
      return <Zap size={14} />;
    // 认不出厂商（big-pickle / space-bunny / nemotron …，实测占 28%）
    default:
      return <Box size={14} />;
  }
}

function ModelBadge({ modelId, modelName }: { modelId: string; modelName?: string | null }) {
  const vendor = modelVendorOf({ id: modelId, name: modelName });
  const preset = vendor ? VENDOR_ICON[vendor] : undefined;
  const src = preset ? resolveAgentIconSrc(preset) : null;

  return (
    <FallbackImage
      src={src}
      size={14}
      className="model-badge-img"
      alt={vendor ?? ''}
      fallback={fallbackIconFor(vendor)}
    />
  );
}

export { ModelBadge };
