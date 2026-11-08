import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { useProjectStore } from '@/shared/store/projectStore';

/**
 * 项目切换时把侧栏滚动到目标项目（2026-11-08 定案：状态栏项目切换器落地后，
 * 左栏对「当前项目在哪」不再沉默 —— 切到列表外的项目时用户会失去方位感）。
 *
 * 职责边界：
 * - 只在 `activeProjectId` **变化**时跳（首挂不跳）：初挂载的定位归
 *   `useScrollMemory`（恢复上次浏览位置），两者互不接管 —— 面板未挂载期间发生的
 *   切换，重挂载时仍走恢复，不抢。
 * - `block: 'nearest'`（与 ActionPalette / FileTreeRow 同款）：目标已在视野内
 *   （含侧栏自己点击切换的场景）就不动，避免每次点击都把行重新居中的无谓位移。
 * - 匹配靠卡片根上的 `data-project-id`（`ProjectItem` / `ConnectionProjectCard`
 *   各写一份，WSL/SSH 同样可达）；找不到（数据未到 / 已删）安静跳过。
 */
export function useScrollToActiveProject(containerRef: RefObject<HTMLElement | null>) {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const previousIdRef = useRef(activeProjectId);

  useEffect(() => {
    const previousId = previousIdRef.current;
    previousIdRef.current = activeProjectId;
    if (!activeProjectId || previousId === activeProjectId) return;

    const container = containerRef.current;
    if (!container) return;
    // 不把 id 拼进选择器字面量：项目 id 是外部数据，含引号 / 冒号 / 方括号时会让
    // querySelector 抛 SyntaxError（MarkdownPreview 的 mermaid id 已踩过同类坑）。
    // 直接比属性：与红线 12「禁止消费侧自造字符串归一」同取向，身份判定不靠拼串。
    const target = Array.from(container.querySelectorAll<HTMLElement>('[data-project-id]')).find(
      (el) => el.dataset.projectId === activeProjectId,
    );
    target?.scrollIntoView({ block: 'nearest' });
  }, [activeProjectId, containerRef]);
}
