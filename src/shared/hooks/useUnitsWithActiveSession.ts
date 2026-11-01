import { useMemo } from 'react';

import { unitsWithListedActiveSession } from '@/shared/selectors/liveSessionSelectors';
import { useEditorStore } from '@/shared/store/editorStore';
import { selectActiveSessionRefs } from '@/shared/store/editorTabSelectors';
import { useLiveSessionsStore } from '@/shared/store/liveSessionsStore';

/**
 * 哪些单元的**前台 tab 是一个会话**（父行据此把选中样式让给子行）。
 *
 * # 为什么需要它
 *
 * 单元行与会话行原本都用 `bg-bg-selected`：会话被选中时父行也亮，形成「同色套同色」，
 * 读者无法判断哪个是「当前」，而「当前会话」本来就蕴含「当前单元」—— 同一事实被强调两遍。
 * 现在：**填充色只出现在最具体的那一层**（会话行，且用强调色淡底 + 左侧色条），
 * 父行只保留「当前单元」的弱提示。
 *
 * # 稳定性
 *
 * `tabs` / `editorLayout` 是 zustand 的稳定切片：只在它们真的变化时重算 refs；
 * 不把会新建数组的 selector 直接交给 `useEditorStore`（每次 getSnapshot 都会触发
 * `Object.is` 失配）。`Set` 只在这一层构造（消费侧要的是 `has(key)`）。
 */
export function useUnitsWithActiveSession(): ReadonlySet<string> {
  const tabs = useEditorStore((s) => s.tabs);
  const editorLayout = useEditorStore((s) => s.editorLayout);
  const refs = useMemo(() => selectActiveSessionRefs({ tabs, editorLayout }), [tabs, editorLayout]);
  const sessions = useLiveSessionsStore((s) => s.sessions);
  return useMemo(() => unitsWithListedActiveSession(refs, sessions), [refs, sessions]);
}
