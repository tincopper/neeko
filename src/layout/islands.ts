/**
 * Islands 海面几何（布局框架统一标准，唯一来源）。
 *
 * 任意两座岛屿之间永远是 3px 海面 = 1px 面板内缩 + 1px 分隔条 + 1px 面板内缩。
 * 两种层级用不同手段实现同一几何，禁止各面板自定 gap/padding 数值：
 *
 * - 窗口级（DockLayout）：zone 面板各留 1px 内边（`py-0.5 pr-px` 等）+ `ResizableHandle`（`w-px`）；
 * - 面板内部分栏：宿主 panel（中央区 / zone 面板）承担外圈内缩，Group 只用
 *   `ISLAND_SPLIT_GROUP_CLASS`（`gap-px`，分隔条两侧各 1px）分隔岛屿。
 *   Group 禁止再加外圈 padding——否则与宿主 panel 双重内缩（Library 曾因此四面多缩 2px）。
 */
export const ISLAND_SPLIT_GROUP_CLASS = 'gap-px';

/**
 * 非分栏的岛屿并列 / 堆叠间距（看板列之间、面板内上下两块岛之间）。
 *
 * # 为什么不复用 `gap-px`
 *
 * `gap-px` 是**分栏**的几何：它两侧各贴一条 `ResizableHandle`（`w-px`），
 * 三者相加才是 3px 海面。非分栏的位置没有手柄可贴 —— 只写 `gap-px` 会得到 1px，
 * 岛屿的 `rounded-lg` 在 1px 缝里读起来是「表格线」而不是「浮在海上的块」。
 *
 * # 为什么是 6px
 *
 * 它就是 `src/styles/base/variables.css` 里的 `--gap-island: 6px`（Tailwind `gap-1.5`
 * 在 4px 基准下正好是 6px）。岛屿之间需要**可见**海面，而分栏位置需要的是
 * **可拖拽的窄缝** —— 两个需求不同，所以是两个常量，不是一个能靠参数切换的值。
 *
 * 禁止各面板自写 `gap-2` / `p-2` / `gap-[7px]`：那会让「海面有多宽」变成每个面板的私事。
 */
export const ISLAND_GAP_CLASS = 'gap-1.5';

/**
 * 海面内缩（岛屿到宿主边缘）。与 `ISLAND_GAP_CLASS` 同值，但**语义不同**，
 * 所以是两个常量：`gap` 是两块岛之间的距离，`padding` 是岛到海面边缘的距离。
 *
 * 宿主 panel 承担外圈内缩（`islands.ts` 总则）：中心区面板已经给了 1px，
 * 这里补的是「面板内自成一片海」时的那一圈（看板列与面板头部都浮在这片海上）。
 */
export const ISLAND_SEA_PAD_CLASS = 'p-1.5';
