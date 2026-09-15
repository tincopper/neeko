import type { JavaDebugBackend } from '@/shared/types';

/** `dap.javaBackend` 的合法取值（与 Rust 侧 `JavaDebugBackend::parse` 一一对应）。 */
const VALID: readonly JavaDebugBackend[] = ['jdtls', 'host'];

/**
 * `dap.javaBackend` 的**唯一解析点**：缺键 / 空值 / 非法值 / 类型不符一律 → `auto`。
 *
 * 前端读取该键只用于 dispatch（是否发起 JDTLS 探测、是否跳过 host-jar 门控）；
 * 后端在同一次调用内会权威复核 —— 两侧解析规则必须一致，故收在这一处。
 */
export function parseJavaDebugBackend(value: unknown): JavaDebugBackend {
  return typeof value === 'string' && (VALID as readonly string[]).includes(value)
    ? (value as JavaDebugBackend)
    : 'auto';
}

/**
 * `auto` 是否把默认路径交给 JDTLS 后端（B'）。
 *
 * **已置 true**：S0 Phase 2 真机验证通过（`research/jdtls-debug-spike.md`）——
 * bundle 注入 → `startDebugSession` → DAP 直连 → `launch` → **断点命中（verified）**
 * → stackTrace / scopes / **evaluate** → `disconnect{terminateDebuggee}` 杀掉 JVM，
 * 全链路有真机证据。三条载荷约束也由该次验证确定并已落入实现：
 * ① `args` 必须是**字符串**（数组会被 Gson 拒绝）；② Console Launcher **前置**在
 * classPaths 首位（否则项目旧版 junit-platform 类触发 `NoSuchMethodError`）；
 * ③ `projectName` 必填（缺它 evaluate 失败）。
 *
 * 若将来需要临时回退到"只用 A"，把该常量置回 `false` 即可（无需改其它代码）：
 * `auto` 会退化为 host-first，行为与今天之前完全一致。
 */
export const AUTO_PREFERS_JDTLS = true;

/** 本次动作是否走 B'（JDTLS 内 java-debug）。 */
export function prefersJdtlsBackend(backend: JavaDebugBackend): boolean {
  return backend === 'jdtls' || (backend === 'auto' && AUTO_PREFERS_JDTLS);
}

/**
 * 是否跳过 `dap_check_adapter('java')` 门控。
 *
 * 该门控的 Java 判据是「`java` 可执行 + **host jar 存在**」（`JavaAdapter::is_available`），
 * 而 B'（JDTLS 内 java-debug）**不需要 host jar** —— 不跳过会让目标用户在能力探测之前
 * 就被拦住。只有**确定要走 B'** 时才跳过；`host`（含 auto 未启用 B' 时）保留门控。
 */
export function shouldSkipJavaAdapterGate(configType: string, backend: JavaDebugBackend): boolean {
  return configType === 'java' && prefersJdtlsBackend(backend);
}
