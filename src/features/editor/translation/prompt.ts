import type { SourceBlock } from './blocks';

/**
 * 组装一次翻译 turn 的 prompt：目标语言 + 编号段落 + 输出格式约定。
 * 行内 markdown 标记要求模型原样保留；输出为 JSON 数组（parseTranslationResponse 解析）。
 */
export function buildTranslationPrompt(blocks: SourceBlock[], targetLanguage: string): string {
  const segments = blocks.map((block, index) => `[${index}] ${block.text}`).join('\n\n');
  return [
    `You are a professional translator for software documentation. Translate each numbered segment into ${targetLanguage}.`,
    '',
    'Rules:',
    '- Preserve inline markdown syntax exactly (e.g. `code`, **bold**, *em*, ~~del~~, [text](url)).',
    '- Do not translate code identifiers, file paths, URLs, or error messages inside code spans.',
    '- Return ONLY a JSON array of strings: item i is the translation of segment [i]. No commentary, no code fences.',
    '',
    'Segments:',
    '',
    segments,
  ].join('\n');
}

/**
 * 解析模型输出为按序译文数组（与输入块一一对应）。
 * 容错：剥离代码围栏、容忍前后噪声（取首个 `[` 到末个 `]`）、
 * 非字符串/缺失项 → null（调用方标失败）；非法 JSON → 全 null。
 */
export function parseTranslationResponse(raw: string, expectedCount: number): Array<string | null> {
  const result: Array<string | null> = new Array(expectedCount).fill(null);
  const text = raw.trim();
  if (!text) return result;

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return result;

  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return result;
    for (let i = 0; i < expectedCount && i < parsed.length; i++) {
      const item = parsed[i];
      if (typeof item === 'string' && item.trim()) {
        result[i] = item;
      }
    }
    return result;
  } catch {
    return result;
  }
}
