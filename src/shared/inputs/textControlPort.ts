/**
 * ③ 焦点文本控件端口 —— 「把文本插到当前聚焦的 `<input>` / `<textarea>` 光标处」。
 *
 * # 为什么这一级被允许存在（R6 的边界）
 *
 * 历史上的 `isTextInputElement(document.activeElement)` 是一个**代理判据**：
 * 「这个元素长得像输入框」被当成「文本已经进到某个业务输入里了」。而 xterm 的输入载体
 * 本身就是 `<textarea class="xterm-helper-textarea">`，于是该判据在终端聚焦时恒真，
 * 文本被 `dispatchEvent` 给一个零监听者的 DOM 后丢弃 —— 拖文件「什么都没发生」。
 *
 * 现在标签名**只决定由哪个端口接**，而这个端口必须**真的把文本插进去**才算落地：
 * 返回 `true` 的判据是「值或选区真的变了」，`execCommand` 拒绝 / 什么都没变一律返回
 * `false`，让调用方继续降级（最终未命中 → toast，不再静默）。
 *
 * # 为什么用 `document.execCommand('insertText')`
 *
 * 它是唯一**同步**且**保留 undo 栈**、还能驱动 React 受控组件的插入路径
 * （派发真实的 `beforeinput` / `input`）。手写 `value` setter + 手工派发事件会绕过
 * React 的受控状态，产生「界面有、state 没有」的假象。已废弃 API，但失败可检测、
 * 可降级 —— 比自造一条语义不等价的路径更安全（design §3.1 / §7）。
 *
 * # 刻意不覆盖 `contenteditable`
 *
 * 富文本有自己的端口（agent-chat composer 的 Tiptap 注册表），终端有终端端口。
 * 「任何看起来可编辑的元素都算文本控件」正是当年那条启发式的形态，不从后门放回来。
 */

/** 不接受自由文本的 `<input>` 类型（`selectionStart` 在它们上面没有意义）。 */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** xterm / 其他终端实现用来捕获键盘的隐藏载体 —— 不是用户可见的文本控件。 */
const TERMINAL_HELPER_CLASS = 'xterm-helper-textarea';

export type TextControl = HTMLInputElement | HTMLTextAreaElement;

export interface TextControlTarget {
  el: TextControl;
  /** `false` = 本次没落地（调用方继续降级）。 */
  insert: (text: string) => boolean;
}

function isTextControl(el: Element | null): el is TextControl {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) {
    // 终端等实现用隐藏 textarea 捕获键盘；它有专门的端口，不在这里接。
    return !el.classList.contains(TERMINAL_HELPER_CLASS);
  }
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type);
  return false;
}

/**
 * 在光标处插入文本，用「值或选区真的变了」作为唯一成功判据。
 *
 * 语义说明（与 design §3.1 的一处偏差）：design 写的是 `值变了 && 选区变了`，
 * 实现取 `或` —— 「同长替换选区」时值不变而选区变了，那**确实**是一次成功的插入，
 * 用 `&&` 会把它误报成失败并降级到别的端口（写入两处）。
 */
export function insertIntoTextControl(el: TextControl, text: string): boolean {
  el.focus();
  const beforeValue = el.value;
  const beforeSelection = el.selectionStart;
  // jsdom / 非 Chromium 内核没有这个方法：当作「不支持」而不是「成功」。
  const accepted = document.execCommand?.('insertText', false, text) ?? false;
  if (!accepted) return false;
  return el.value !== beforeValue || el.selectionStart !== beforeSelection;
}

/**
 * 当前焦点落在普通文本控件上时返回该端口；否则 `null`。
 *
 * 注意这是**命中判据**而不是「文本该去哪」的断言：真正的落地由 `insert()` 的返回值回答。
 */
export function focusedTextControl(): TextControlTarget | null {
  const active = document.activeElement;
  if (!isTextControl(active)) return null;
  return { el: active, insert: (text) => insertIntoTextControl(active, text) };
}
