/**
 * Tasks 面板的键盘快捷键判据（design §11.7：`Cmd+N` 新建 / `Delete` 删除选中 / `Escape` 关闭）。
 *
 * # 为什么判据是纯函数，而不是 `onKeyDown` 里的几个 `if`
 *
 * 这里每一条都是「**什么时候不许动**」的判断，而每一条的反面都是一次数据破坏：
 * 在标题框里按 Backspace 会删掉整条工作项、在对话框上按 Cmd+N 会叠出第二层对话框、
 * 在没有选中时按 Delete 会静默什么都不做（用户以为坏了）。这些条件无法靠 UI 手测覆盖
 * （要先聚焦某个输入框、再按某个键），所以判据单独成函数并被单测钉住；
 * 组件侧只剩「按下 → 调动作」这一层（见 `TasksPanel` 的 `handleKeyDown`）。
 *
 * # 谁拥有 Escape
 *
 * 对话框开着时 `Escape` 归 **Radix Dialog**（它自己监听并关闭）。这里一律返回 `null`，
 * 不再处理一次 —— 同一次按键两个所有者，症状是「关掉对话框的同时也把背后那一行删了」
 * 或者「Esc 要按两次」。
 */

/** 面板级快捷键的动作。`null` = 这一次按键不归面板管。 */
export type ShortcutAction = 'create' | 'delete' | 'close';

/**
 * 判据只消费**这几个字段**，所以要一个「事件形状」而不是 `KeyboardEvent`：
 * React 合成事件、原生事件、测试里的字面量都能直接传（也就不用为测试造 DOM 事件）。
 */
export interface ShortcutEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** 这一次按键发生时面板的处境 —— 判据的全部输入。 */
export interface ShortcutContext {
  /** 焦点在可编辑控件里（input / textarea / contentEditable，见 `isEditableElement`）。 */
  editable: boolean;
  /** 新建 / 编辑对话框开着。 */
  dialogOpen: boolean;
  /** 有选中的行。今天「选中」等价于详情面板打开（`selectedId` 是唯一真相）。 */
  hasSelection: boolean;
}

/**
 * 按键 → 动作。判据顺序就是优先级，改顺序会改变语义（注释里逐条写了为什么）。
 */
export function resolveShortcut(
  event: ShortcutEventLike,
  context: ShortcutContext,
): ShortcutAction | null {
  // ① 输入中一律不拦。这是最贵的一类误伤：在标题框里按 Backspace 会删掉整条工作项。
  if (context.editable) return null;

  // ② 对话框开着时键盘整体归它（Esc 由 Radix Dialog 关闭；Cmd+N 不该叠第二层；
  //    Delete 不该删掉对话框背后那一行）。
  if (context.dialogOpen) return null;

  // ③ Cmd+N / Ctrl+N。**不**做平台探测（`navigator.platform` 在测试与各端壳里都不可靠）：
  //    这两个修饰键在本面板没有别的绑定，同时接受不会冲突。
  //    Shift / Alt 组合留给别的功能（`Cmd+Shift+N` 在多数应用里是另一件事）。
  const primary = event.metaKey || event.ctrlKey;
  if (primary && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
    return 'create';
  }

  // ④ 下面两条都要求「有选中的行」：没有选中时 Esc / Delete 不属于面板，让给上层或浏览器。
  if (!context.hasSelection) return null;

  // Escape 在此只能关**详情**（对话框那条分支在 ② 已经让路）：这是面板里另一个可关闭的面。
  if (event.key === 'Escape') return 'close';

  // ⑤ Mac 笔记本键盘上只有 Backspace，没有独立 Delete 键 —— 两个都收，且只在选中时生效。
  if (event.key === 'Delete' || event.key === 'Backspace') return 'delete';

  return null;
}

/**
 * 焦点是否在可编辑控件里。
 *
 * `input` / `textarea` 直接命中；`contentEditable` 要**向上找祖先** —— 属性常挂在容器上
 * （`<div contenteditable><span>…</span></div>`），而 `HTMLElement.isContentEditable`
 * 在 jsdom 里恒为 `false`，依赖它就等于这条守卫在测试里永远不生效。
 *
 * `contenteditable="false"` 会**中断**查找：那是作者在可编辑区里有意划出的不可编辑岛，
 * 在岛上按 Backspace 不该被当成「正在输入」。
 */
export function isEditableElement(element: Element | null | undefined): boolean {
  if (element === null || element === undefined) return false;

  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;

    const editable = node.getAttribute('contenteditable');
    if (editable === 'false') return false;
    // `''`（裸属性）与 `true` / `plaintext-only` 都是可编辑；其余值按规范是 inherit ⇒ 继续向上。
    if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
  }

  return false;
}
