import { describe, expect, it } from 'vitest';

import { isAbandonedImeAsciiBuffer, stripImeSegmentationSpaces } from '../ime';

describe('isAbandonedImeAsciiBuffer', () => {
  it("判定 'hai hao' 为被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('hai hao')).toBe(true);
  });

  it("判定 'a b c'（多个分词空格）为被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('a b c')).toBe(true);
  });

  it("判定 'hello'（无空格）不是被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('hello')).toBe(false);
  });

  it("判定 '   '（纯空格）不是被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('   ')).toBe(false);
  });

  it("判定 ' '（单空格）不是被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer(' ')).toBe(false);
  });

  it("判定 ''（空字符串）不是被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('')).toBe(false);
  });

  it("判定 '你好'（纯中文）不是被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('你好')).toBe(false);
  });

  it("判定 '中文 输入'（含中文与空格）不是被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('中文 输入')).toBe(false);
  });

  it("判定 'hai hao 你好'（含非 ASCII）不是被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('hai hao 你好')).toBe(false);
  });

  it("判定 'hai\\thao'（含制表符）不是被放弃的拼音缓冲区（判定正则只接受空格分隔）", () => {
    expect(isAbandonedImeAsciiBuffer('hai\thao')).toBe(false);
  });

  it("判定 'hai\\u3000hao'（全角空格分隔）为被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('hai\u3000hao')).toBe(true);
  });

  it("判定 'a\\u3000b'（全角空格）为被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('a\u3000b')).toBe(true);
  });

  it("判定 '\\u3000\\u3000'（纯全角空格）不是被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('\u3000\u3000')).toBe(false);
  });

  it("判定 '\\u3000'（单全角空格）不是被放弃的拼音缓冲区", () => {
    expect(isAbandonedImeAsciiBuffer('\u3000')).toBe(false);
  });
});

describe('stripImeSegmentationSpaces', () => {
  it("剥离 'hai hao' 的分词空格得到 'haihao'", () => {
    expect(stripImeSegmentationSpaces('hai hao')).toBe('haihao');
  });

  it("剥离 'a   b' 的多连续空格得到 'ab'", () => {
    expect(stripImeSegmentationSpaces('a   b')).toBe('ab');
  });

  it("剥离 '  hai  hao  ' 的首尾与中间空格", () => {
    expect(stripImeSegmentationSpaces('  hai  hao  ')).toBe('haihao');
  });

  it("剥离 'a\\tb' 的制表符", () => {
    expect(stripImeSegmentationSpaces('a\tb')).toBe('ab');
  });

  it("剥离 'a\\nb' 的换行", () => {
    expect(stripImeSegmentationSpaces('a\nb')).toBe('ab');
  });

  it("无空格的 'haihao' 保持不变", () => {
    expect(stripImeSegmentationSpaces('haihao')).toBe('haihao');
  });
});
