/** WebKit（WKWebView / WebKitGTK）对 input/textarea 的默认行为关断属性：
 * 句首自动大写（autocapitalize 默认 sentences）、自动纠错、拼写检查。
 * 通用组件（ui/Input）内部展开，散落的裸 input/textarea 也应展开此常量，
 * 避免三属性在各处重复硬编码。放在 {...props} 之前，调用方可覆盖。 */
export const noAutocorrectProps = {
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
} as const;
