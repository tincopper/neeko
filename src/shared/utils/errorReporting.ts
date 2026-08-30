// 唯一的 invoke(`log_frontend_error`) 事实源。此文件位于 shared/utils，
// 供 app 层（全局 handler、ErrorBoundary）与所有 feature 域消费。
/* eslint-disable-next-line no-restricted-imports -- shared IPC entry for frontend error reporting */
import { invoke } from '@tauri-apps/api/core';

export interface FrontendErrorPayload {
  source: string;
  message: string;
  stack?: string | null;
}

/** 用户提示回调（toast）。由 app 层注册真实实现，测试注入 mock，避免 shared/utils 依赖 store。 */
export type ErrorNotifier = (message: string) => void;

let notifier: ErrorNotifier | null = null;

/**
 * 注册用户提示回调。app 层启动时调用一次注入 `useNotificationStore` 实现；
 * 传 null 可取消 toast（仅记录日志）。测试通过此入口注入 mock。
 */
export function setErrorNotifier(fn: ErrorNotifier | null): void {
  notifier = fn;
}

/** 同 source 错误上报的最小间隔（ms），防止一次崩溃风暴刷爆日志与提示。 */
const THROTTLE_MS = 5000;
/** 错误提示消息的最大长度，避免海量堆栈刷屏通知。 */
const MAX_MESSAGE_LENGTH = 200;

const lastReportAt: Record<string, number> = {};

/**
 * 已知良性警告前缀。这类由浏览器/WebView 规范发出的诊断信息不是应用缺陷
 * （如 ResizeObserver loop），只落日志、不打扰用户。
 */
const BENIGN_WARNING_PREFIXES = ['ResizeObserver loop'];

/**
 * 外部库内部崩溃的已知良性模式：无功能损害（调用方自愈）且应用侧不可修，
 * 落日志（保留可观察性）但不弹 toast 打扰用户。
 *
 * - CodeMirror `posAtCoords → Pointer.scanTile`：hover 定时检查触发，
 *   `tile.children[scan.i]` 在指针位于 tile 末尾时越界（@codemirror/view
 *   6.43.9 上游边界 bug），该次 hover 检查自愈、下次 mousemove 重启。
 */
const BENIGN_MESSAGE_PATTERNS = [/evaluating 'child\.isText'/];

/** 判定是否为无需 toast 的良性警告。 */
export function isBenignWarning(message: string): boolean {
  return (
    BENIGN_WARNING_PREFIXES.some((prefix) => message.startsWith(prefix)) ||
    BENIGN_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
  );
}

/**
 * 将前端错误上报到 Rust 日志（`~/.neeko/neeko.log`）+ 用户提示 toast。
 * 带 source 级节流，防刷屏；上报链路自身失败一律静默（避免二次崩溃）。
 * 良性警告（见 isBenignWarning）仅落日志、不弹 toast。
 */
export function reportFrontendError(source: string, error: unknown): void {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  const now = Date.now();
  const last = lastReportAt[source] ?? -Infinity;
  if (now - last < THROTTLE_MS) {
    return;
  }
  lastReportAt[source] = now;

  // 日志上报失败内部静默；toast 与日志互不阻塞
  void logFrontendError({
    source,
    message,
    stack: stack ?? null,
  });

  // 良性警告不打扰用户（仅已记日志）
  if (isBenignWarning(message)) {
    return;
  }

  try {
    notifier?.(message.slice(0, MAX_MESSAGE_LENGTH) || '发生未捕获错误');
  } catch {
    // 提示链路自身失败必须静默，避免错误处理引发二次错误
  }
}

/**
 * 重置节流状态。主要用于测试隔离；真实场景中亦可由设置面板调用以清空
 * 错误上报频率限制。
 */
export function resetFrontendErrorThrottle(): void {
  Object.keys(lastReportAt).forEach((key) => {
    delete lastReportAt[key];
  });
}

/**
 * Report a frontend error to the Rust file logger (`~/.neeko/neeko.log`).
 * Best-effort: the error path must never crash again, so both synchronous
 * throws (e.g. invoke unavailable outside Tauri) and async rejections are
 * swallowed here instead of by callers.
 */
export async function logFrontendError(payload: FrontendErrorPayload): Promise<void> {
  try {
    await invoke('log_frontend_error', {
      source: payload.source,
      message: payload.message,
      stack: payload.stack ?? null,
    });
  } catch {
    // 上报链路自身失败必须静默，避免错误处理引发二次错误
  }
}
