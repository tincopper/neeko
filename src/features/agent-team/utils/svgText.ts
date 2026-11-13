/**
 * SVG 文本的共用小工具（分配图的节点 / lead 胶囊两处都要用）。
 *
 * 单独成文件而不是各自内联：截断口径一致（一处 `…`）与字号常量共享，改一次全场生效；
 * 样式对象是**模块级常量**而不是 JSX 字面量 —— 每次渲染新建对象会让 SVG 每帧对 `style`
 * 做 diff（见 `TeamFlowGraph` 的布局文档）。
 *
 * 第 2 轮成员行已不在图上渲染，`TEXT_SUB_STYLE` 随之删除（零消费者不留死常量）。
 */

/** 任务标题字号（节点第一行）。 */
export const TEXT_TITLE_STYLE = { fontSize: 10, fontWeight: 600 } as const;
/** 节点副标题字号（两行共用：指派 / 认领）。 */
export const TEXT_META_STYLE = { fontSize: 9 } as const;

/** 超长文本截断并加省略号；短于上限时原样返回。 */
export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
