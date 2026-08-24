import { describe, expect, it } from 'vitest';

import type { ModelInfo } from '@/features/agent/api/agentApi';

import { matchModel } from '../historyRestore';

const model = (id: string, providerId?: string): ModelInfo => ({
  id,
  name: id,
  provider_id: providerId ?? null,
  provider_name: null,
  supported_reasoning_efforts: [],
  default_reasoning_effort: null,
  context_window: null,
  is_free: false,
});

describe('matchHistoryModel — 历史会话的 model 字符串匹配到 ModelInfo', () => {
  it('providerID/modelID 复合格式优先按复合键精确匹配', () => {
    const models = [model('kimi-k2', 'coding-plan'), model('gpt-5', 'openai')];
    expect(matchModel(models, 'coding-plan/kimi-k2')?.id).toBe('kimi-k2');
    expect(matchModel(models, 'openai/gpt-5')?.id).toBe('gpt-5');
  });

  it('裸 modelID 回退为单段精确匹配', () => {
    const models = [model('kimi-k2', 'coding-plan'), model('gpt-5', 'openai')];
    expect(matchModel(models, 'gpt-5')?.id).toBe('gpt-5');
  });

  it('无匹配返回 undefined（回落 agent 默认模型）', () => {
    const models = [model('kimi-k2', 'coding-plan')];
    expect(matchModel(models, 'unknown/model')).toBeUndefined();
    expect(matchModel([], 'a/b')).toBeUndefined();
  });
});
