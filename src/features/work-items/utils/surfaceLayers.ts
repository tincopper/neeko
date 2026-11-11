/**
 * **表面层叠的自动发现**：从真实渲染出来的 DOM 里抽出「内层表面 vs 外层表面」的配对。
 *
 * # 为什么要有这个模块（三次同型事故的教训）
 *
 * 同一个缺陷出现了三次，每次都是「表面层级没走到最内层」：
 *
 * | # | 形态 | 当时为什么没被发现 |
 * | --- | --- | --- |
 * | ① | 海面 vs 岛 | 面板根写了海面色，被外层岛包着 → 岛被填成海 |
 * | ② | 卡片 vs 列 | 卡片也写 `bg-bg-tertiary` → 与列同色，恒 1.00 |
 * | ③ | 行 vs 主岛 | 列表容器没底色，行（`secondary`）直接叠在主岛（也是 `secondary`）→ 恒 1.00 |
 *
 * 三次的**共同根因不是配色，而是判据形态**：每次都是人肉列一张「我关心的 token 配对」，
 * 而缺陷恰好落在列表**没列到**的那一对上。手写列表只能覆盖「我已经想到的层」。
 *
 * 所以这里换成**自动发现**：给一棵真实渲染的树，把每一对「内层表面 / 它最近的外层表面」
 * 抽出来。新增一层表面时它自动进入判据，不需要有人记得去登记。
 *
 * # 为什么是「最近的外层表面」而不是「直接父节点」
 *
 * 真实代码里层与层之间常夹着透明容器（`<ul>`、`<span>`、布局 wrapper）。卡片住在
 * `bg-tertiary` 的列里，中间可能隔着 `flex` 容器 —— 那些容器不画表面，视觉上卡片就是
 * 直接叠在列上。所以「外层」的定义是：**往上找第一个自己画表面的祖先**。
 *
 * # 配对方向：`outer > inner`
 *
 * 读作「内层画在外层之上」。判据是**这两个 token 在每个主题下都必须可分辨** ——
 * 同 token 恒为 1.00，直接失败。
 */

/** 会被当作「表面」的 Tailwind 类（与 `styles/base/tailwind.css` 的 `--color-bg-*` 对应）。 */
const SURFACE_TOKEN = /^bg-(bg-primary|bg-secondary|bg-tertiary|bg-hover|bg-selected)$/;

/**
 * 一个元素的**表面 token**（`bg-bg-secondary` 这类），没有则 `null`。
 *
 * 只取**第一个**命中的 token：写两个表面类（`bg-bg-primary bg-bg-secondary`）是自相矛盾的
 * 样式，取第一个已足够让「同色」判据工作；真要抓「两个表面类并存」是另一条判据（见
 * `findMultipleSurfaces`）。
 */
export function surfaceOf(element: Element): string | null {
  for (const token of Array.from(element.classList)) {
    if (SURFACE_TOKEN.test(token)) return token;
  }
  return null;
}

/** 写在同一元素上的全部表面 token（正常应为 0 或 1 个）。 */
export function surfacesOf(element: Element): string[] {
  return Array.from(element.classList).filter((token) => SURFACE_TOKEN.test(token));
}

/**
 * 从一个子树里收集全部「外层表面 > 内层表面」配对。
 *
 * 返回**排序去重**的 `string[]`（便于快照式断言与稳定报错顺序），不是 Set ——
 * 调用方通常要拿它和「期望的配对集合」做相等比较。
 */
export function collectSurfacePairs(root: ParentNode): string[] {
  const pairs = new Set<string>();

  for (const element of Array.from(root.querySelectorAll('*'))) {
    const inner = surfaceOf(element);
    if (inner === null) continue;

    let ancestor = element.parentElement;
    while (ancestor !== null) {
      const outer = surfaceOf(ancestor);
      if (outer !== null) {
        pairs.add(`${outer} > ${inner}`);
        break;
      }
      ancestor = ancestor.parentElement;
    }
  }

  return Array.from(pairs).sort();
}

/**
 * 找出「同一个元素上写了多个表面 token」的违规元素（返回其 `className`，便于定位）。
 *
 * 两个表面类并存时，实际生效的取决于 CSS 产出顺序而不是书写顺序 —— 那是**不可预测**的，
 * 所以一律禁止。这条与「内外层必须可分辨」是两件不同的事，必须分开判。
 */
export function findMultipleSurfaces(root: ParentNode): string[] {
  const offenders: string[] = [];

  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (surfacesOf(element).length > 1) {
      offenders.push(element.className);
    }
  }

  return offenders;
}

/**
 * 把 `outer > inner` 配对解析回两个 token。
 *
 * 解析失败（格式不对）时返回 `null` —— 调用方据此报「配对字符串被写坏了」，
 * 而不是静默跳过。
 */
export function parseSurfacePair(pair: string): { outer: string; inner: string } | null {
  const parts = pair.split(' > ');
  if (parts.length !== 2) return null;
  const [outer, inner] = parts;
  if (!SURFACE_TOKEN.test(outer) || !SURFACE_TOKEN.test(inner)) return null;
  return { outer, inner };
}
