import React from 'react';

import type { JavaDebugBackend } from '@/shared/types';
import { ToggleGroup, ToggleGroupItem } from '@/ui';

interface DebugPanelProps {
  javaBackend: JavaDebugBackend;
  onJavaBackendChange: (backend: JavaDebugBackend) => void;
}

/**
 * Debug 设置分区（当前仅 Java 后端选择）。
 *
 * 三选语义（左右两列说明必须与实现一致）：
 * - `auto`：JDTLS 后端优先；**不自动换引擎** —— 静态不可用（无 JDK21 / 未装 jdtls /
 *   debug 插件未加载）时询问一次是否改用 Host；其他不可用报错并给出显式切换入口。
 * - `jdtls`：只用 JDTLS 后端（需要 Java 21+ 与 JDTLS 的 Java 语言服务器）。
 * - `host`：只用自写 host（功能受限：无表达式求值 / 调试控制台补全）。
 */
const DebugPanel: React.FC<DebugPanelProps> = ({ javaBackend, onJavaBackendChange }) => {
  return (
    <>
      <h3 className="text-base font-semibold text-text-primary mb-4">Debug</h3>
      <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Java backend</div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            <span className="font-medium">Auto</span>: prefer the JDTLS backend (real classpath,
            expression evaluation) and never switch engines silently.{' '}
            <span className="font-medium">JDTLS</span>: only the JDTLS backend — needs Java 21+ and
            a running Java language server for the project.{' '}
            <span className="font-medium">Host</span>: only Neeko&apos;s built-in host (limited — no
            expression evaluation). Remote (SSH) projects are not supported by either backend.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ToggleGroup
            type="single"
            value={javaBackend}
            onValueChange={(value) => {
              if (value) onJavaBackendChange(value as JavaDebugBackend);
            }}
          >
            <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
            <ToggleGroupItem value="jdtls">JDTLS</ToggleGroupItem>
            <ToggleGroupItem value="host">Host</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </>
  );
};

export default React.memo(DebugPanel);
