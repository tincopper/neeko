import { useMemo } from 'react';

import type { DockSlot } from '@/shared/dock';
import { useEditorStore } from '@/shared/store/editorStore';
import { countDockedTabs } from '@/shared/store/editorTabSelectors';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorkspaceKey } from '@/shared/store/workspaceStore';

/**
 * 每个槽的槽位宿主里**可渲染 tab 的条数**（`isZoneRenderable` 的 `hostTabCount`，
 * 同时是「到达 = 条数增加」揭示（`useDockTabHostReveal`）的输入）。
 */
export type DockTabHostContent = Record<DockSlot, number>;

/**
 * zone 可见性的**内容事实**注入端口（P5：可见性从内容派生）。
 *
 * 为什么由 app 层算：判据需要「当前 workspace 的 tab 布局」，而 `layout/` 不得 import
 * tab 域（同一规矩见 `onMoveView` 注入）。`shared/dock` 也不认识 tab 域，所以它把
 * `hostTabCount` 作为参数收下 —— 三层各守自己的知识边界。
 *
 * **为什么是条数而不是布尔**：同一份事实要回答两个问题 ——「有没有内容」（`> 0`，只由
 * `isZoneRenderable` 内部决定一处）与「是不是刚刚到来」（条数增加）。布尔只够回答前者：
 * 已折叠且已非空的槽再自动停靠一条（1 → 2）没有假 → 真跃迁，那次点击就会静默无反应。
 * 计数是**同一事实的更细形式**，不是第二个判据 —— 不要同时维护两份。
 *
 * 键是 `useActiveWorkspaceKey`（当前单元的 tab 空间）：**不要**抄 `ProjectView` 的
 * `tabSpaceKeyOf({ kind: 'app' })` 兜底 —— app 空间没有可停靠的 tab，那会是第三份公式。
 * 没有激活项目时 key 为 `null`，`countDockedTabs` 直接 `0`（不凭空占位）。
 *
 * 返回对象用 `useMemo` 稳定：它挂在 `DockLayout`（`React.memo`）上，每次渲染新建一个
 * 对象等于让 memo 恒失效。
 */
export function useDockTabHostContent(): DockTabHostContent {
  // 取 `activeProject?.id` 而不是 `activeProjectId`：宿主自己（`DockTabHostWrapper`）就是这么
  // 取项目的 —— 内容事实必须与宿主算在**同一个 tabKey** 上，否则中间态会出现
  // 「判据说有 tab、宿主渲染为空」的空岛。selector 返回字符串原始值，不会因项目对象刷新重渲。
  const projectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const tabKey = useActiveWorkspaceKey(projectId);
  // 两槽各一次订阅（数字原始值：selector 返回数组/对象会让快照比较恒不等）。
  // 显式写两个键而不是遍历 `DOCK_SLOTS`：新增槽位时这里应当**编译报错**（追加强制处理），
  // 循环填充会让新槽默默拿到另一个槽的值。
  const left = useEditorStore((s) => countDockedTabs(s, tabKey, 'left'));
  const right = useEditorStore((s) => countDockedTabs(s, tabKey, 'right'));

  return useMemo(() => ({ left, right }), [left, right]);
}
