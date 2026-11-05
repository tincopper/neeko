import { useMemo } from 'react';

import { useActiveSessionRefs } from '@/shared/hooks/useActiveSessionRefs';
import { unitsWithListedActiveSession } from '@/shared/selectors/liveSessionSelectors';
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
 * # 「当前」不是这里判的（R8）
 *
 * 前台会话 refs 复用 `useActiveSessionRefs`（激活项目 + 激活单元的唯一派生）；本 hook 不再
 * 订阅 `editorStore`，也不再自己遍历所有 tab 空间 —— 那样切项目后旧单元的父行仍会让出
 * 选中底。这里只做「refs 与 live 快照求交」：`unitsWithListedActiveSession` 把未列出的
 * 会话挡掉（父行不能因为一条不可见会话失去选中态）。`Set` 只在这一层构造（消费侧要 `has(key)`）。
 *
 * # 稳定性
 *
 * `sessions` 是 store 的稳定切片；refs 由 `useMemo` 产出（无当前单元时是共享空常量）。
 * 不把会新建 Set 的 selector 直接交给 zustand（每次 getSnapshot 都会触发 `Object.is` 失配）。
 */
export function useUnitsWithActiveSession(): ReadonlySet<string> {
  const refs = useActiveSessionRefs();
  const sessions = useLiveSessionsStore((s) => s.sessions);
  return useMemo(() => unitsWithListedActiveSession(refs, sessions), [refs, sessions]);
}
