import { describe, expect, it } from 'vitest';

import type { SourceBlock } from '../blocks';
import { buildTranslationPrompt, parseTranslationResponse } from '../prompt';

const block = (id: string, text: string): SourceBlock => ({ id, kind: 'paragraph', text });

describe('buildTranslationPrompt — 翻译 prompt 组装', () => {
  it('包含目标语言、编号段落与 JSON 输出约定', () => {
    const prompt = buildTranslationPrompt(
      [block('b0', 'Hello'), block('b1', 'World **bold**')],
      '简体中文',
    );

    expect(prompt).toContain('简体中文');
    expect(prompt).toContain('[0] Hello');
    expect(prompt).toContain('[1] World **bold**');
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('`code`'); // 行内标记保留规则
  });

  it('单块也能组装', () => {
    const prompt = buildTranslationPrompt([block('b0', 'hi')], 'English');
    expect(prompt).toContain('[0] hi');
  });
});

describe('parseTranslationResponse — 译文解析（容错）', () => {
  it('解析纯 JSON 数组', () => {
    expect(parseTranslationResponse('["你好", "世界"]', 2)).toEqual(['你好', '世界']);
  });

  it('剥离 markdown 代码围栏', () => {
    const raw = '```json\n["你好", "世界"]\n```';
    expect(parseTranslationResponse(raw, 2)).toEqual(['你好', '世界']);
  });

  it('容忍前后噪声文本（取首个 [ 到末个 ]）', () => {
    const raw = 'Here is the translation:\n["你好", "世界"]\nDone.';
    expect(parseTranslationResponse(raw, 2)).toEqual(['你好', '世界']);
  });

  it('缺失项与非字符串项 → null（调用方标失败）', () => {
    expect(parseTranslationResponse('["你好", 42, null]', 3)).toEqual(['你好', null, null]);
  });

  it('输出数量多于期望 → 截断；少于期望 → null 补齐', () => {
    expect(parseTranslationResponse('["a","b","c"]', 2)).toEqual(['a', 'b']);
    expect(parseTranslationResponse('["a"]', 3)).toEqual(['a', null, null]);
  });

  it('非法 JSON → 全 null', () => {
    expect(parseTranslationResponse('not json at all', 2)).toEqual([null, null]);
  });

  it('空输出 → 全 null', () => {
    expect(parseTranslationResponse('', 1)).toEqual([null]);
  });
});
