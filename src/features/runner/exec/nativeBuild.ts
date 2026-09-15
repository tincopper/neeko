/**
 * native Debug（lldb / dlv）共用的构建产物与 launch 载荷形状。
 *
 * Rust 与 Go 的**构建命令、产物解析方式**完全不同（cargo compiler-artifact JSON vs
 * `-o` 显式路径），故各自实现于 `languages/<lang>/`；只有「产物 → launch 配置」的结果形状
 * 与路径换算共用于此（避免两条链路各自定义 `type/program/cwd` 而漂移）。
 */

/** Debug launch 配置（测试/main 共用形状，与 `debugStore.LaunchConfig` 兼容）。 */
export interface NativeDebugLaunchConfig {
  name: string;
  type: string;
  request: string;
  program: string;
  cwd: string;
  args: string[];
  mode?: string;
  stopOnEntry: boolean;
}

/** 产物解析失败分类（显式失败而非静默 `null`，调用方据此给用户可见原因）。 */
export type TestBinaryFailure = 'binary_not_found' | 'binary_ambiguous';
export type TestBinaryResult = { ok: true; path: string } | { ok: false; error: TestBinaryFailure };

/** 相对二进制路径 → 绝对路径（cargo 在 cwd 下输出 `target/...` 相对路径）。 */
export function resolveBinaryPath(binary: string, cwd: string): string {
  if (binary.startsWith('/') || /^[A-Za-z]:[\\/]/.test(binary)) return binary;
  return `${cwd.replace(/[/\\]+$/, '')}/${binary}`;
}
