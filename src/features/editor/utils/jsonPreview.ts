/**
 * JSON 预览格式化与语法高亮（纯函数，无 React/DOM 依赖）。
 *
 * 预览只读：仅展示格式化结果，绝不回写源文件。
 * token 用 { type, value } 扁平序列表示，拼接 value 可无损还原原文；
 * 冒号与空白等非字符串/数字/字面量字符合并为单个 punct token。
 */

export type JsonTokenType = 'key' | 'string' | 'number' | 'literal' | 'punct';

export interface JsonToken {
  type: JsonTokenType;
  value: string;
}

export type FormatResult = { ok: true; formatted: string } | { ok: false; error: string };

/** 解析并以 2 空格缩进格式化 JSON；失败返回错误信息（不抛异常） */
export function formatJson(content: string): FormatResult {
  try {
    return { ok: true, formatted: JSON.stringify(JSON.parse(content), null, 2) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// 依次尝试：key 字符串（lookahead 冒号，不消费）/ 普通字符串 / 数字 / 字面量
const JSON_TOKEN_RE =
  /"(?:[^"\\]|\\.)*"(?=\s*:)|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g;

/** 将格式化后的 JSON 文本切分为语法 token 序列（拼接可无损还原） */
export function highlightJson(formatted: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  for (const m of formatted.matchAll(JSON_TOKEN_RE)) {
    if (m.index > last) {
      tokens.push({ type: 'punct', value: formatted.slice(last, m.index) });
    }
    const value = m[0];
    if (value.startsWith('"')) {
      const rest = formatted.slice(m.index + value.length);
      tokens.push({ type: /^\s*:/.test(rest) ? 'key' : 'string', value });
    } else if (/^-?\d/.test(value)) {
      tokens.push({ type: 'number', value });
    } else {
      tokens.push({ type: 'literal', value });
    }
    last = m.index + value.length;
  }
  if (last < formatted.length) {
    tokens.push({ type: 'punct', value: formatted.slice(last) });
  }
  return tokens;
}
