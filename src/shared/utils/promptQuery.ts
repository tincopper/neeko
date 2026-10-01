import type { PromptResource } from '@/shared/types/library';

/** 快速选择列表的单次上限（两个入口共用，避免各写一个魔法数字）。 */
export const PROMPT_QUERY_LIMIT = 20;

/** 匹配规则：name / slash / description / tags 任一命中（大小写无关）。 */
function matchesPromptQuery(prompt: PromptResource, query: string): boolean {
  return (
    prompt.name.toLowerCase().includes(query) ||
    prompt.slash?.toLowerCase().includes(query) === true ||
    prompt.description?.toLowerCase().includes(query) === true ||
    prompt.tags.some((tag) => tag.toLowerCase().includes(query))
  );
}

/**
 * 按查询词过滤 prompts 并截断到 `PROMPT_QUERY_LIMIT`。
 *
 * 唯一产出点：状态栏 Prompts 下拉与 Library 的 Insert 选择器必须给同一份判定，
 * 否则改一处（匹配字段、上限）另一处会静默漂移。空 / 纯空白查询 = 不过滤。
 * 纯函数：不改动入参数组。
 */
export function filterPromptsByQuery(
  prompts: readonly PromptResource[],
  query: string,
): PromptResource[] {
  const q = query.trim().toLowerCase();
  const matched = q ? prompts.filter((prompt) => matchesPromptQuery(prompt, q)) : prompts;
  return matched.slice(0, PROMPT_QUERY_LIMIT);
}
