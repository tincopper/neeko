/**
 * 语言钩子桥（**依赖反转**）：通用 store 需要「按 adapter type 取语言钩子」与「轮询所有语言的
 * 会话输出判定」，但它**不能**直接 import `languages/registry` —— 那会形成环
 * （store → registry → 语言模块 → store）。故此处只声明桥接口，由 `languages/index.ts` 在加载时
 * 注入实现（`registerLanguageHooks`）。
 *
 * 语言清单未注入时（极早期调用）所有查询返回空 → 调用方走通用兜底文案、不触发任何语言专属不变式
 * —— 降级方向是「行为退化但绝不误判」。
 */
import type { LanguageModule } from '../languages/contract';

export interface LanguageHookBridge {
  /** DAP 配置 `type` → 语言模块（未登记 type → null）。 */
  adapterHookFor(configType: string): LanguageModule | null;
  /** 全部语言模块（会话输出不变式需逐一询问）。 */
  all(): readonly LanguageModule[];
}

let bridge: LanguageHookBridge | null = null;
let warned = false;

/**
 * 由 `languages/index.ts` 在模块加载时调用。
 *
 * **重复注册（同一实现）幂等**；**重复注册不同实现直接失败** —— 说明存在第二个语言清单，
 * 那必然导致「同一 type 查出不同语言」的隐性错配，宁可在加载期炸掉也不要线上静默错。
 */
export function registerLanguageHooks(next: LanguageHookBridge): void {
  if (bridge && bridge !== next) {
    throw new Error('Language hooks already registered (duplicate language registry?)');
  }
  bridge = next;
}

/**
 * 语言钩子桥。
 *
 * 未注入 → `null`：调用方走通用兜底（adapter 文案降级、语言专属不变式不触发）。这是**依赖
 * 反转的代价**（store 不能静态 import 语言清单，否则成环），故此处**只在开发期提示一次**，
 * 避免「静默降级」难以定位；不抛错，以免极端早期调用把 UI 打死。
 */
export function languageHooks(): LanguageHookBridge | null {
  if (!bridge && !warned) {
    warned = true;
    console.warn(
      '[runner] language hooks not registered; adapter hints and console invariants degraded',
    );
  }
  return bridge;
}

/** 供测试隔离（生产代码不调用：桥由语言清单一次性注入，无需清理）。 */
export function resetLanguageHooksForTest(): void {
  bridge = null;
  warned = false;
}
