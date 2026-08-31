import { describe, expect, it } from 'vitest';

import { formatJson, highlightJson, type JsonToken } from '@/features/editor/utils/jsonPreview';

describe('formatJson', () => {
  it('合法 JSON 格式化为 2 空格缩进', () => {
    const result = formatJson('{"a":1,"b":[true,null]}');
    expect(result).toEqual({
      ok: true,
      formatted: '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
    });
  });

  it('非法 JSON 返回错误信息，不抛异常', () => {
    const result = formatJson('{"a": }');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('a');
    }
  });
});

describe('highlightJson', () => {
  const types = (s: string): Array<JsonToken['type']> => highlightJson(s).map((t) => t.type);

  it('键（后跟冒号的字符串）与字符串值区分，冒号空白归 punct', () => {
    const tokens = highlightJson('"key": "value"');
    expect(tokens).toEqual([
      { type: 'key', value: '"key"' },
      { type: 'punct', value: ': ' },
      { type: 'string', value: '"value"' },
    ]);
  });

  it('数字 / 字面量 / 标点分类', () => {
    expect(types('-1.5e3')).toEqual(['number']);
    expect(types('true')).toEqual(['literal']);
    expect(types('false')).toEqual(['literal']);
    expect(types('null')).toEqual(['literal']);
    expect(types('{')).toEqual(['punct']);
  });

  it('含转义字符的字符串不中断', () => {
    expect(types('"a\\"b": 1')).toEqual(['key', 'punct', 'number']);
  });

  it('连续标点/空白合并为单个 punct', () => {
    expect(highlightJson('{\n  "a": 1\n}')).toEqual([
      { type: 'punct', value: '{\n  ' },
      { type: 'key', value: '"a"' },
      { type: 'punct', value: ': ' },
      { type: 'number', value: '1' },
      { type: 'punct', value: '\n}' },
    ]);
  });

  it('格式化输出整体 token 化后拼接还原原文', () => {
    const formatted = '{\n  "a": 1,\n  "b": [true, null],\n  "c": "x\\ny"\n}';
    const joined = highlightJson(formatted)
      .map((t) => t.value)
      .join('');
    expect(joined).toBe(formatted);
  });
});
