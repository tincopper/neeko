import { Component, type ErrorInfo, type ReactNode } from 'react';

import { reportFrontendError } from '@/app/registerGlobalErrorHandlers';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 自定义 fallback；缺省时使用内置错误页 */
  fallback?: ReactNode;
  /** 捕获到错误时回调（用于上报/日志） */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 顶层错误边界：子组件树渲染/生命周期抛出未捕获异常时，展示错误页而非
 * 卸载整棵树（React 18 默认行为会导致黑屏）。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info);
    reportFrontendError('render', error);
    this.props.onError?.(error, info);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div
        role="alert"
        className="w-screen h-screen flex flex-col items-center justify-center gap-4 bg-bg-primary text-text-primary p-8"
      >
        <div className="text-2xl font-semibold">应用遇到问题</div>
        <p className="text-sm text-text-secondary max-w-md text-center">
          渲染过程中发生未捕获错误。错误信息已记录到控制台，可点击下方按钮重试。
        </p>
        <pre className="text-xs text-accent-red bg-bg-surface border border-border rounded p-3 max-w-lg overflow-auto whitespace-pre-wrap">
          {this.state.error?.message ?? '未知错误'}
        </pre>
        <button
          type="button"
          onClick={this.handleReset}
          className="px-4 py-2 rounded bg-accent-blue text-white text-sm hover:opacity-90"
        >
          Retry
        </button>
      </div>
    );
  }
}
