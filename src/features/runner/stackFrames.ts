/**
 * Stack-frame helpers for DAP stopped handling.
 *
 * No Just My Code: every stop parks where the debugger stopped, third-party /
 * stdlib frames included. Silently auto-continuing past a frame makes library
 * breakpoints unobservable and step-into-library impossible — the stop location
 * is always the source we navigate to.
 *
 * 本模块是**「帧 → 源身份」的唯一所有权点**：适配器虚拟源码身份
 * （`virtualSourceIdentity`）在此产出，物理源码身份由 `fileRef.sourceIdentityOf` 提供
 * （本模块的下游 `stopLocation.ts` 消费两者来构造位置）。零依赖（只用共享纯工具），
 * 可被 store 切片与 UI 直接消费。
 *
 * 「位置」本身（类型 / 构造 / 状态对）不在本模块 —— 见 `stopLocation.ts`。
 */
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
