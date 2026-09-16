/**
 * 停点**位置**的单一归属点 —— 类型 + 构造 + 状态对。
 *
 * 「位置」原本散在三处：类型/构造在 `stackFrames.ts`、状态对在 `store/debug/shared.ts`、
 * 使用在各 slice —— 概念被切成三段，任何一处单独演化都会让「位置」出现第二种口径
 * （例如只改构造忘了序号、或状态对多了一个字段而消费侧不知道）。本模块把三者收在一起，
 * 模块名即概念名。
 *
 * 职责边界：
 * - 本模块 = 「位置是什么 / 怎么造 / 怎么变更」；
 * - `stackFrames.ts` = 「帧 → 源身份」（`pickStopFrame` / `virtualSourceIdentity`），本模块的下游；
 * - `store/debug/*` = 持有 `StopLocationState` 并通过 `withStopLocation` 写入。
 *
 * 依赖方向：`store/debug/*` → 本模块 → `stackFrames.ts` → `fileRef.ts`（单向，无环）。
 * 位置**不**放进 `store/debug/`：那会让域层（`stackFrames.ts`）反向依赖 store 内部件。
 */
import { sourceIdentityOf } from '@/shared/utils/fileRef';

import { virtualSourceIdentity } from './stackFrames';
import type { StackFrameDto } from './types';

/** 当前停点的位置。`identity` 是规范源身份（tab / 断点 key / 黄线共用同一套）。 */
export interface StopLocation {
  identity: string;
  /** 1-based 行号。 */
  line: number;
  /** 0-based 列偏移。 */
  column: number;
}

/**
 * 帧 → 停止位置（**唯一构造点**）。
 *
 * 所有「写当前停点位置」的路径都必须经这里，使位置身份与 tab 身份天然一致 ——
 * 两套写入口径（规范身份 vs 裸 `Source.path`）会让黄线与跳转判定分叉。
 *
 * - `sourcePath`（含 JDK 解压缓存路径与适配器 `jdt://…` uri）→ 收敛成规范身份；
 * - `sourceReference > 0`（适配器持有字节）→ `dap-source:` 合成身份；
 * - 无源码、或行号不可寻址（native / JIT 帧）→ `null`：位置一旦产出就必须可跳转，
 *   不允许 `line < 1` 的「伪位置」流出（否则黄线与光标会各自做一次钳制）。
 */
export function buildStopLocation(frame: StackFrameDto, projectRoot: string): StopLocation | null {
  if (frame.line < 1) return null;

  const reference = frame.sourceReference ?? 0;
  if (frame.sourcePath) {
    return {
      identity: sourceIdentityOf(projectRoot, frame.sourcePath),
      line: frame.line,
      column: frame.column,
    };
  }
  if (reference > 0) {
    return {
      identity: virtualSourceIdentity(reference, frame.sourceName),
      line: frame.line,
      column: frame.column,
    };
  }
  return null;
}

/**
 * 停点位置状态对：位置 + **严格单调**的位置变化序号。
 *
 * `locationSeq` 不是可派生冗余：「位置值相同」≠「事件相同」——同一断点在循环里连续命中时
 * 各字段逐字相等，而编辑器侧必须能区分「又发生了一次停点」（新事件要重新跟随），
 * 因此事件键只能是序号。
 */
export interface StopLocationState {
  location: StopLocation | null;
  locationSeq: number;
}

/**
 * 位置变更：写入新位置（`null` = 清空）并把序号 +1。
 *
 * 所有写位置的路径（停点 / 切帧 / 清空）都经此函数，使「位置 + 序号」永远成对更新 ——
 * 编辑器侧只依赖序号，不会漏事件也不会重复响应。
 */
export function withStopLocation(
  current: StopLocationState,
  next: StopLocation | null,
): StopLocationState {
  return { location: next, locationSeq: current.locationSeq + 1 };
}
