/**
 * 共享 IME 工具：处理 macOS WKWebView 下中文拼音输入法切换中英文键放弃组字时，
 * WebKit 将未确认的拼音缓冲区以「分词空格」形式提交到文本输入的问题
 * （如输入 `haihao` 会被提交为 `hai hao`）。原生 app 无此行为，仅 WebView 受影响。
 */

/** 判定「被放弃的拼音缓冲区」：纯 ASCII 可打印字符 + 含空格（半角或全角 \u3000）+ 去空格后非空。
 *  真实 CJK 提交含非 ASCII 字符，不匹配；正常单字符空格（' '）与纯空格串不匹配；
 *  粘贴的整段含空格命令（如 git 提交消息）会命中，需调用方用上下文（如 paste 标记）区分。
 *  全角空格兼容：部分 WebView 平台可能以全角空格做分词分隔。 */
export function isAbandonedImeAsciiBuffer(data: string): boolean {
  return /^[\x21-\x7e \u3000]+$/.test(data) && /[ \u3000]/.test(data) && data.trim() !== '';
}

/** 去除拼音缓冲区中的分词空格（`\s+` 覆盖半角/全角空格、tab、换行；
 *  实际调用路径中判定函数已排除 tab/换行，此处保持通用剥离能力）。 */
export function stripImeSegmentationSpaces(data: string): string {
  return data.replace(/\s+/g, '');
}
