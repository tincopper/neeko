import { memo, useMemo } from 'react';

import { fromFileUri, getLspLanguageId } from '../api/languageMap';
import type { LspDiagnostic } from '../types';
import { diagnosticRowKeys, sortDiagnosticsForGroup } from '../utils/diagnosticGroups';

import { DiagnosticGroupHeader } from './DiagnosticGroupHeader';
import { DiagnosticRow } from './DiagnosticRow';

interface DiagnosticGroupProps {
  uri: string;
  label: string;
  /** store 里的**原数组引用**（本组唯一的变化判据）。 */
  diagnostics: LspDiagnostic[];
  projectPath: string;
  isCollapsed: boolean;
  /** 折叠翻转（父组件经 `useCallback` 稳定引用，memo 才生效）。 */
  onToggle: (uri: string) => void;
  /** 行点击跳转（父组件经 `useCallback` 稳定引用，memo 才生效）。 */
  onJump?: (uri: string, diagnostic: LspDiagnostic) => void;
}

/**
 * 一个文件的诊断分组（组头 + 展开时的行）。
 *
 * `React.memo`（P4）是分组增量的**唯一机制**：props 里只有 `diagnostics` 会随 store flush 变化，
 * 而 store 的 per-uri 整体替换语义保证未涉及的 uri 引用不变（`setProjectDiagnosticsBatch`）——
 * 因此「只编辑了 b.java」时，其余分组既不重排（下面的 `useMemo` 不重跑）也不重渲染（memo 跳过），
 * 200 组规模下每次编辑的渲染成本收敛到 O(本次变更组)。
 *
 * 为什么不做「引用缓存 + 全量重排」：那需要在本层之外手写一份与 React 并行的记忆化（并在渲染期
 * 读写 ref），既重复了框架已有的能力，又容易与 StrictMode / 丢弃渲染抢状态。分组的输入边界
 * （uri → 数组）就是天然的分片边界，直接用组件身份表达即可。
 */
export const DiagnosticGroup = memo(function DiagnosticGroup({
  uri,
  label,
  diagnostics,
  projectPath,
  isCollapsed,
  onToggle,
  onJump,
}: DiagnosticGroupProps) {
  const sorted = useMemo(() => sortDiagnosticsForGroup(diagnostics), [diagnostics]);
  // 组内共享语言 ID 按组算一次（P2），不再每行重算；只在本组重渲染时才算。
  const languageId = getLspLanguageId(fromFileUri(uri));
  // 折叠组不渲染行 ⇒ 连行 key 都不算（P2 懒渲染 + 零成本）
  const rowKeys = isCollapsed ? [] : diagnosticRowKeys(sorted);

  return (
    <div data-testid={`diagnostic-file-group-${label}`}>
      <DiagnosticGroupHeader
        uri={uri}
        label={label}
        count={diagnostics.length}
        isCollapsed={isCollapsed}
        onToggle={onToggle}
      />
      {!isCollapsed && (
        <div className="ml-6 border-l border-border/60">
          {sorted.map((diagnostic, index) => (
            <DiagnosticRow
              key={rowKeys[index]}
              uri={uri}
              projectPath={projectPath}
              languageId={languageId}
              diagnostic={diagnostic}
              onJump={onJump}
            />
          ))}
        </div>
      )}
    </div>
  );
});
