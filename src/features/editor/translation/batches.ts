import type { SourceBlock } from './blocks';

/**
 * 粗略 token 估算：CJK 字符每字 ≈ 1 token，其余字符每 4 字符 ≈ 1 token。
 * 仅用于凑批预算控制，不追求精确分词。
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(char)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return cjk + Math.ceil(other / 4);
}

/**
 * 按相邻贪心策略把块序列凑成翻译批次（共识：相邻小段合并，减少请求轮次）。
 * - 批内 token 总量 ≤ budget（恰好等于预算仍可同批）；
 * - 单块超预算 → 独立成批（不拆分、不丢弃）；
 * - budget ≤ 0 → 退化为每块独立成批（逐段翻译）。
 */
export function planTranslationBatches(blocks: SourceBlock[], budget: number): SourceBlock[][] {
  const batches: SourceBlock[][] = [];
  let current: SourceBlock[] = [];
  let currentTokens = 0;

  for (const block of blocks) {
    const tokens = estimateTokens(block.text);
    const fits = current.length > 0 && currentTokens + tokens <= budget;
    if (!fits && current.length > 0) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(block);
    currentTokens += tokens;
    // 单块已超预算（或预算非正）→ 立即封闭该批
    if (currentTokens > budget) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
