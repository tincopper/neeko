/**
 * 停点位置的**公开只读面**：编辑器侧（黄线 / 光标跟随）唯一允许读取的停点输入。
 *
 * 为什么是 hook 而不是让编辑器直连 debug store：`store/debug/**` 对其它 feature 是封闭
 * slice 目录（自行 `create()` 会击穿 store 单实例），跨域只允许经门面或公开 store 面。
 * 本 hook 同时承担**门控**：会话不属于当前项目时返回 null（#14 —— 切项目后旧项目的停点
 * 不得在别的项目编辑器上画线 / 夺光标）。
 *
 * 引用稳定性：`location` 是 store 内已存的稳定对象引用、`seq` 是原始值，故用 `useMemo`
 * 组装；**禁止**在 selector 里新建对象（每次 getSnapshot 都是新引用 → React 判定 tearing
 * 并持续重渲）。
 */
import { useMemo } from 'react';

import type { StopLocation } from '../stackFrames';
import { useDebugStore } from '../store/debugStore';

import { useVisibleDebugSession } from './useVisibleDebugSession';

export interface StopLocationView extends StopLocation {
  /** 位置变化序号（`locationSeq`）：编辑器侧用它把「又停了一次」与「值没变」区分开。 */
  seq: number;
}

/** 当前可见会话的停点位置；无会话 / 别项目会话 / 无位置 → null。 */
export function useStopLocation(): StopLocationView | null {
  const session = useVisibleDebugSession();
  const location = useDebugStore((s) => s.location);
  const seq = useDebugStore((s) => s.locationSeq);

  return useMemo(
    () =>
      session && location
        ? { identity: location.identity, line: location.line, column: location.column, seq }
        : null,
    [session, location, seq],
  );
}
