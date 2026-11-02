import { CSS, type Transform } from '@dnd-kit/utilities';

/**
 * 可排序卡片的位移样式 —— **只在「真的在动」时才写 `transform`**。
 *
 * 两个合法状态：
 *
 * - `isDragging`：这是被拖的那张卡，跟手是它的本职；
 * - `transition` 存在：别的卡在被拖，它在**让位**（dnd-kit 会给让位过程一个 transition）。
 *
 * 两者都不成立却仍带着 `transform`，说明 dnd-kit 的状态与渲染错开了（拖拽期间节点重挂、
 * 或外部 store 更新让列表重排）。CSS 不会自己恢复 —— 卡片会**永久停在偏移位置**，
 * 看起来就是「项目块自己浮起来、像被拖走没放下」。
 *
 * 正常拖拽不受影响：让位动画的两个条件里必有一个成立。
 */
export function sortableCardStyle(args: {
  isDragging: boolean;
  transition: string | null | undefined;
  transform: Transform | null;
}): { transform: string | undefined; transition: string | undefined } {
  const moving = args.isDragging || Boolean(args.transition);
  return {
    transform: moving ? CSS.Transform.toString(args.transform) : undefined,
    transition: args.transition ?? undefined,
  };
}
