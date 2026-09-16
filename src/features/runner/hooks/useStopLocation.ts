/**
 * 停点位置的**公开只读面**：编辑器侧（黄线 / 光标跟随）唯一允许读取的停点输入。
 *
 * 为什么是 hook 而不是让编辑器直连 debug store：`store/debug/**` 对其它 feature 是封闭
 * slice 目录（自行 `create()` 会击穿 store 单实例），跨域只允许经门面或公开 store 面。
 * 本 hook 同时承担**门控**：会话不属于当前项目时返回 null（#14 —— 切项目后旧项目的停点
 * 不得在别的项目编辑器上画线 / 夺光标）。门控本身走唯一实现 `isSessionVisibleFor`。
 *
 * **一次订阅、一并交出状态**（切片 3 / F5）：消费者只需要「位置 + 会话状态」两样输入，
 * 此前它们各自再调一次 `useVisibleDebugSession()` —— 单视图展开成 6 个订阅槽，且「会话属于
 * 当前项目」的门控在多处各判一遍（漏一处就是 #14）。现在 debug 侧用**一次** `useShallow`
 * 选择器取齐（位置 + 序号 + 会话身份 + 状态），project 侧一次取 `activeProjectId`，
 * 消费者只消费结果。结构不变量由 `runner/__tests__/architecture.test.ts` 的护栏 12 钉住。
 *
 * 引用稳定性：`location` 是 store 内已存的稳定对象引用、`seq`/`status` 是原始值，故用
 * `useMemo` 组装；**禁止**在 selector 里新建对象而不套 `useShallow`（每次 getSnapshot 都是
 * 新引用 → React 判定 tearing 并持续重渲）。
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';

import { useProjectStore } from '@/shared/store/projectStore';

import { isSessionVisibleFor } from '../sessionVisibility';
import type { StopLocation } from '../stopLocation';
import { useDebugStore } from '../store/debugStore';

export interface StopLocationView extends StopLocation {
  /** 位置变化序号（`locationSeq`）：编辑器侧用它把「又停了一次」与「值没变」区分开。 */
  seq: number;
  /**
   * 可见会话的状态：停点匹配的**软门**（后端在停点前后会瞬时报 `starting` / `running`）。
   * 与位置同源，消费者不必再单独读会话。
   */
  status: string | null;
}

/** 当前可见会话的停点位置；无会话 / 别项目会话 / 无位置 → null。 */
export function useStopLocation(): StopLocationView | null {
  const { location, locationSeq, session, status } = useDebugStore(
    useShallow((s) => ({
      location: s.location,
      locationSeq: s.locationSeq,
      session: s.session,
      status: s.session?.status ?? null,
    })),
  );
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);

  return useMemo(
    () =>
      location && isSessionVisibleFor(session, activeProjectId)
        ? {
            identity: location.identity,
            line: location.line,
            column: location.column,
            seq: locationSeq,
            status,
          }
        : null,
    [location, locationSeq, session, activeProjectId, status],
  );
}
