import { Component, type ErrorInfo, type ReactNode } from 'react';

import { reportFrontendError } from '@/app/registerGlobalErrorHandlers';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 自定义降级 UI；缺省时走「通知 + 自动重试」策略，不展示错误页 */
  fallback?: ReactNode;
  /** 捕获到错误时回调（用于上报/日志） */
  onError?: (error: Error, info: ErrorInfo) => void;
}

type BoundaryPhase =
  | 'ok' // 正常渲染 children
  | 'unhandled' // 已捕获、待 componentDidCatch 决策（渲染 null，阻断重试再抛的同步循环）
  | 'retrying' // 自动重试：渲染 children
  | 'degraded'; // 反复崩溃：轻量占位（唯一可见的兜底 UI）

interface ErrorBoundaryState {
  phase: BoundaryPhase;
  error: Error | null;
}

/** 同一 boundary 的自动重试窗口：窗口内再次崩溃视为持久性故障，转降级占位。 */
const RECOVERY_WINDOW_MS = 10_000;

/**
 * 顶层错误边界。渲染/生命周期抛出未捕获异常时不再展示全屏错误页，只通过
 * 通知中心告知用户（reportFrontendError → Rust 日志 + 通知），应用保持可用：
 *
 * - 首次崩溃：上报 + 通知，并自动重试渲染（对渲染竞态类瞬态错误直接恢复，
 *   无任何页面干扰）；
 * - 重试窗口内再次崩溃：判定为持久性故障，渲染极简占位卡片并停止自动重试，
 *   避免无限重渲染循环；占位上保留手动 Retry 与窗口过期后的再次自动重试。
 *
 * 显式传入 fallback 的调用方保持「崩溃即 fallback」的旧语义。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { phase: 'ok', error: null };

  /** 崩溃计数与上次崩溃时间（实例字段；state 异步不参与计数决策） */
  private crashCount = 0;
  private lastCrashAt = 0;

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // 中间态：先渲染 null 阻断「重试又抛错 → 再捕获 → 再重试」的同步循环，
    // 真正的重试/降级决策由 componentDidCatch 里的 setState 完成。
    return { phase: 'unhandled', error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info);
    reportFrontendError('render', error);

    const now = Date.now();
    this.crashCount = now - this.lastCrashAt >= RECOVERY_WINDOW_MS ? 1 : this.crashCount + 1;
    this.lastCrashAt = now;

    this.props.onError?.(error, info);

    // 显式 fallback 的调用方立即降级；否则窗口外的新崩溃（含首次）自动重试，
    // 窗口内反复崩溃转降级占位
    const phase: BoundaryPhase =
      this.props.fallback || this.crashCount > 1 ? 'degraded' : 'retrying';
    this.setState({ phase, error });
  }

  private handleRetry = () => {
    this.crashCount = 0;
    this.lastCrashAt = 0;
    this.setState({ phase: 'retrying', error: null });
  };

  render() {
    const { phase, error } = this.state;

    if (phase === 'ok' || phase === 'retrying') {
      return this.props.children;
    }

    if (phase === 'unhandled') {
      // 决策前的一帧：显式 fallback 可同步呈现，否则短暂空白（无感）
      return this.props.fallback ?? null;
    }

    // degraded：显式 fallback 优先，缺省渲染轻量占位卡片
    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div
        role="alert"
        className="w-screen h-screen flex items-center justify-center bg-bg-primary p-8"
      >
        <div className="max-w-md w-full rounded-lg bg-bg-surface p-5 flex flex-col gap-3">
          <div className="text-sm font-medium text-text-primary">
            界面渲染出现异常，已停止自动重试
          </div>
          <p className="text-xs text-text-secondary leading-relaxed break-all">
            {error?.message ?? '未知错误'}
          </p>
          <div>
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-3 py-1.5 rounded-md bg-accent-blue text-white text-xs hover:opacity-90"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
}
