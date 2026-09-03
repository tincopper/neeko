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
