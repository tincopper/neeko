/**
 * Stack-frame helpers for DAP stopped handling.
 *
 * No Just My Code: every stop parks where the debugger stopped, third-party /
 * stdlib frames included. Silently auto-continuing past a frame makes library
 * breakpoints unobservable and step-into-library impossible — the stop location
 * is always the source we navigate to.
 *
 * 本模块同时是**「帧 → 源身份」的唯一所有权点**：物理源码身份（`sourceIdentityOf`，
 * 含 JDK 缓存路径 / 适配器 `jdt://…` uri 的归并）与适配器虚拟源码身份
 * （`virtualSourceIdentity`）都在此产出，因此「停止位置」不可能出现第二种口径。
 * 零依赖（只用共享纯工具），可被 store 切片与 UI 直接消费。
 */
import { sourceIdentityOf } from '@/shared/utils/fileRef';

import type { StackFrameDto } from './types';

/**
 * 驱动「编辑器跳转 + 黄线」的帧 = **栈顶第一个带源码的帧**（即真正的停止位置）。
 *
 * 自上而下取第一个可用源码（`sourcePath` 磁盘路径，或 `sourceReference`
 * 适配器虚拟源码）；栈顶若是 native / JIT 帧（`LambdaForm…`，无源码）则下探到
 * 最近的有源码帧。
 *
 * **刻意不做「优先项目帧」**：那会让「单步进入 JDK / 第三方库」时把编辑器拉回
 * 调用方文件，用户看到的是自己的代码而不是停住的那一行（Just My Code 时代的
 * 残留规则，与 VS Code / IntelliJ 的「编辑器跟随栈顶帧」语义相反）。调用方文件
 * 仍可在 Call Stack 面板点选跳转。
 */
export function pickStopFrame(frames: StackFrameDto[]): StackFrameDto | null {
  for (const f of frames) {
    if (f.sourcePath || (f.sourceReference ?? 0) > 0) return f;
  }
  return null;
}

/** 虚拟源码 tab 的身份路径（`dap-source:` 前缀，非文件系统路径）。 */
export function virtualSourceIdentity(reference: number, name?: string | null): string {
  return `dap-source:/${reference}/${name && name.trim() ? name.trim() : 'source'}`;
}

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
