import React from 'react';

import { cn } from '@/lib/utils';
import { Bug } from '@/shared/components/icons';

import type { JavaBackendLabel } from '../types';

interface DebugSessionBadgeProps {
  /** 会话状态文案（`statusMeta().label`）。 */
  statusLabel: string;
  /** 状态圆点 class（`statusMeta().dot`）。 */
  statusDot: string;
  /** 当前会话的配置名；`null` 表示无会话。 */
  configName: string | null;
  /**
   * Java 调试后端标注（`null` = 非 Java 会话）。
   *
   * 降级路径（`host` / `host (fallback)`）**必须常驻可见** —— 用户始终能看到这一路用的是
   * 哪个引擎、能力是否受限（design §2.5 的"降级不可静默"）。
   */
  javaBackendLabel: JavaBackendLabel | null;
  /** 「重试 JDTLS」：由父层清除本会话的降级记忆。 */
  onRetryJdtls: () => void;
}

/**
 * Debug 面板标题栏的品牌 + 状态 + 后端标注簇。
 *
 * 抽成独立组件的理由（P10 组件规模红线 + 单一职责）：面板主体已接近 300 行上限，
 * 而这块是**纯展示**（无 store 订阅、无副作用），抽出后既让主体回落，也让"后端标注"
 * 这条跨领域的 UX 规则有唯一落点。
 */
const DebugSessionBadge: React.FC<DebugSessionBadgeProps> = ({
  statusLabel,
  statusDot,
  configName,
  javaBackendLabel,
  onRetryJdtls,
}) => {
  const canRetry = javaBackendLabel === 'host (fallback)';
  return (
    <div className="inline-flex items-center gap-1.5 shrink-0 px-2.5 max-w-[220px]">
      <Bug size={13} className="text-text-secondary shrink-0" />
      <span className="text-[var(--font-size)] font-medium text-text-primary">Debug</span>
      {configName ? (
        <span
          className="inline-flex items-center gap-1.5 min-w-0 max-w-[220px]"
          title={`${statusLabel} · ${configName}${
            javaBackendLabel ? ` · Java backend: ${javaBackendLabel}` : ''
          }`}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDot)} />
          <span className="truncate text-[calc(var(--font-size)-1px)] text-text-secondary">
            {configName}
          </span>
          {javaBackendLabel ? (
            <button
              type="button"
              disabled={!canRetry}
              onClick={onRetryJdtls}
              title={
                canRetry
                  ? 'Click to re-enable the JDTLS backend for this project, then Debug again'
                  : `Java backend: ${javaBackendLabel}`
              }
              className={cn(
                'shrink-0 rounded-sm px-1 text-[calc(var(--font-size)-2px)]',
                javaBackendLabel === 'jdtls'
                  ? 'text-text-muted bg-bg-tertiary/40'
                  : 'text-status-warning bg-status-warning/10',
                canRetry && 'cursor-pointer hover:underline',
              )}
            >
              {javaBackendLabel}
            </button>
          ) : null}
        </span>
      ) : (
        <span className="text-[calc(var(--font-size)-1px)] text-text-muted">No session</span>
      )}
    </div>
  );
};

export default React.memo(DebugSessionBadge);
