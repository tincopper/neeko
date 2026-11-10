import { useEffect, useRef } from 'react';

/**
 * 抽屉的焦点管理（打开移焦 + 焦点陷阱 + Esc 关闭 + 关闭归还）。
 *
 * # 为什么必须做
 *
 * 抽屉（`MemberDetailDrawer`；任务详情已改为中央 tab）都是 `absolute … z-10` 的覆盖层，
 * 触发它们的按钮**还在 DOM 里**（只是被盖住）。没有焦点管理时，键盘用户 Tab 一次就进到
 * 看不见的内容里：看不见焦点环、也不知道自己在哪一层。
 *
 * # 为什么是 hook 而不是 `@/ui/Dialog`
 *
 * `@/ui/Dialog` 是 Radix 的**居中弹窗**（`DialogContent` 自己带 portal、遮罩与居中定位），
 * 面板里的抽屉是右栏 / 底栏的贴边覆盖层，套进来要覆盖掉它的定位与遮罩，等于把 Radix 的
 * 布局约定改成第二套。`@/ui/OverlayPanel` 是 `fixed inset-0` 的全屏面板，同理不合适。
 * 所以这里只借 Radix 的**行为**契约（`role="dialog"` + `aria-modal` + 移焦 + 陷阱 + Esc +
 * 归还），布局留给抽屉自己。
 *
 * **两个抽屉共用这一份实现**，不各写一份：只做了一半的焦点管理（比如有 Esc 没有陷阱）
 * 比完全没有更难发现 —— 用户以为已经能用了。
 *
 * # 返回的 ref 挂在哪
 *
 * 挂在**抽屉根元素**上，并且根元素要 `tabIndex={-1}`：里面一个可聚焦元素都没有时（加载中），
 * 焦点仍然要有一个落点，否则 `document.activeElement` 留在背后的按钮上，Tab 会从背后继续走。
 *
 * @param onClose 关闭回调（Esc 触发；组件卸载时不会调用它）
 */
export function useDrawerFocus<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null);
  /** 最新回调（抽屉每次渲染都可能换引用，事件监听只装一次）。 */
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;

    /**
     * 打开者（触发按钮）。卸载时把焦点还给它 —— 抽屉关掉之后焦点必须回到「我按下的是哪」，
     * 否则会落到 `body` 上，接着 Tab 从文档开头开始走。
     */
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = (): HTMLElement[] =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
            'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el !== node);

    // ① 打开移焦：第一个可聚焦元素（通常是「关闭」按钮），没有就落在容器上。
    (focusables()[0] ?? node).focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // 抽屉是最上层的交互面：Esc 归它，不再冒泡给宿主的全局快捷键。
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // 焦点跑到抽屉外面（背后的按钮 / body）→ 拉回来，这是「陷阱」的实质。
      if (active === null || !node.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // 装在 `document` 上而不是容器上：焦点可能已经跑到容器外面（那正是要拦的情形），
    // 装在容器上的监听在那时收不到事件。
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      // ② 关闭归还：触发按钮还在 DOM 里（它只是被盖住了），所以这一句总是成立。
      if (opener !== null && opener.isConnected) opener.focus();
    };
  }, []);

  return ref;
}
