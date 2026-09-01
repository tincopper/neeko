/**
 * Tab 栏溢出计算 —— 纯函数。
 *
 * 规则（与产品共识一致）：
 * - 不缩略原则：可见 tab 按自然宽度渲染，放不下的进下拉；
 * - 激活 tab 强制可见：预留其槽位宽度，其余 tab 从左往右装入，
 *   第一个装不下的 tab 起全部进入下拉；
 * - pinned 永不溢出：pinned 宽度恒定扣除（即使占满空间）；
 * - 溢出按钮二段预留：第一遍不预留「⋯」宽度；若产生溢出，
 *   第二遍预留按钮宽度重算（按钮仅在无隐藏 tab 时不渲染）。
 */

export interface OverflowTabEntry {
  id: string;
  /** tab 完整渲染（标题不被截断）所需的自然宽度 */
  width: number;
}

export interface TabOverflowResult {
  visibleIds: string[];
  hiddenIds: string[];
}

export interface ComputeTabOverflowParams {
  /** 普通（非 pinned）tab，按渲染顺序排列 */
  tabs: OverflowTabEntry[];
  /** tab 栏容器可用宽度 */
  containerWidth: number;
  /** pinned tab（豁免溢出，恒可见；此处仅用于宽度扣除） */
  pinnedTabs?: OverflowTabEntry[];
  /** 激活 tab id（强制可见；null 或不存在时退化为纯前缀计算） */
  activeTabId?: string | null;
  /** 「⋯」按钮宽度（仅在产生溢出时预留） */
  overflowButtonWidth?: number;
  /** 相邻 tab 的间距 */
  gap?: number;
}

export function computeTabOverflow(params: ComputeTabOverflowParams): TabOverflowResult {
  const {
    tabs,
    containerWidth,
    pinnedTabs = [],
    activeTabId = null,
    overflowButtonWidth = 0,
    gap = 0,
  } = params;

  if (tabs.length === 0) {
    return { visibleIds: [], hiddenIds: [] };
  }

  const active = activeTabId !== null ? (tabs.find((t) => t.id === activeTabId) ?? null) : null;

  const run = (reserveButton: boolean): TabOverflowResult => {
    // 恒占槽位的宽度：pinned + 激活 tab + （可选）溢出按钮
    let occupied = pinnedTabs.reduce((sum, t) => sum + t.width, 0);
    if (active) occupied += active.width;
    if (reserveButton) occupied += overflowButtonWidth;

    // 已占用槽位的 item 数，用于确定第一个待装入 tab 是否需要计入 gap
    let placedCount = pinnedTabs.length + (active ? 1 : 0);

    const fittedIds = new Set<string>();
    const hiddenIds: string[] = [];

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      if (active && tab.id === active.id) continue;

      const cost = tab.width + (placedCount > 0 ? gap : 0);
      if (occupied + cost <= containerWidth) {
        occupied += cost;
        placedCount += 1;
        fittedIds.add(tab.id);
      } else {
        // 前缀语义：第一个放不下起，后续全部隐藏（激活 tab 除外）
        for (let j = i; j < tabs.length; j++) {
          if (!(active && tabs[j].id === active.id)) hiddenIds.push(tabs[j].id);
        }
        break;
      }
    }

    // 激活 tab 强制可见：按渲染顺序合并进可见集合
    const visibleIds = tabs
      .filter((t) => fittedIds.has(t.id) || (active !== null && t.id === active.id))
      .map((t) => t.id);

    return { visibleIds, hiddenIds };
  };

  const firstPass = run(false);
  if (firstPass.hiddenIds.length === 0 || overflowButtonWidth <= 0) {
    return firstPass;
  }
  return run(true);
}
