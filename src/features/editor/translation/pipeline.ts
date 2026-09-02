import { planTranslationBatches } from './batches';
import type { SourceBlock } from './blocks';
import { buildTranslationPrompt, parseTranslationResponse } from './prompt';

/** 一次翻译 turn 的抽象：生产实现包 agent 会话 + 事件流，测试注入脚本。 */
export interface TranslationTurn {
  /** 执行一次 turn，resolve 为 agent 最终输出文本；失败/中止 reject。 */
  run(prompt: string, signal: AbortSignalLike): Promise<string>;
}

/** 与 AbortSignal 兼容的最小接口（便于测试注入普通对象）。 */
export interface AbortSignalLike {
  aborted: boolean;
}

export interface TranslateOptions {
  targetLanguage: string;
  /** 批次 token 预算 */
  tokenBudget: number;
  turn: TranslationTurn;
  signal?: AbortSignalLike;
  /** 每批完成回填（id → 译文） */
  onBlockDone?: (translations: Record<string, string>) => void;
  /** 每批失败回填（解析失败 / turn 失败 / 模型漏段） */
  onBlockFail?: (ids: string[]) => void;
}

export interface TranslateResult {
  translations: Record<string, string>;
  failedIds: string[];
  /** 因 abort 提前结束（未处理的块保持未翻译） */
  aborted: boolean;
}

/**
 * 批次调度：块序列 → token 预算凑批 → 顺序执行每批
 * （组装 prompt → turn → 解析回填），失败批标记该批块、后续批次继续；
 * 批间检测 abort → 提前结束（已译保留，共识：停止不清成果）。
 */
export async function planBatchesAndTranslate(
  blocks: SourceBlock[],
  options: TranslateOptions,
): Promise<TranslateResult> {
  const { targetLanguage, tokenBudget, turn, signal = { aborted: false } } = options;
  const batches = planTranslationBatches(blocks, tokenBudget);
  const translations: Record<string, string> = {};
  const failedIds: string[] = [];
  let aborted = false;

  for (const batch of batches) {
    if (signal.aborted) {
      aborted = true;
      break;
    }

    const ids = batch.map((block) => block.id);
    try {
      const raw = await turn.run(buildTranslationPrompt(batch, targetLanguage), signal);
      const parsed = parseTranslationResponse(raw, batch.length);
      const done: Record<string, string> = {};
      const batchFailed: string[] = [];
      batch.forEach((block, index) => {
        const text = parsed[index];
        if (text === null) {
          batchFailed.push(block.id);
        } else {
          done[block.id] = text;
        }
      });

      Object.assign(translations, done);
      failedIds.push(...batchFailed);
      if (Object.keys(done).length > 0) options.onBlockDone?.(done);
      if (batchFailed.length > 0) options.onBlockFail?.(batchFailed);
    } catch {
      failedIds.push(...ids);
      options.onBlockFail?.(ids);
    }
  }

  return { translations, failedIds, aborted };
}
