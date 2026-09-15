import React, { useCallback, useMemo, useState } from 'react';

import { ChevronDown, ChevronRight, Loader2 } from '@/shared/components/icons';

import { useDebugStore } from '../store/debugStore';
import { useJavaDebugStore } from '../store/javaDebugStore';
import type { VariableRow } from '../variableTree';
import { buildVariableRows } from '../variableTree';

import { EmptyHint, SectionLabel } from './PanePrimitives';

function RowIndent({ depth, children }: { depth: number; children: React.ReactNode }) {
  return <div style={{ paddingLeft: 10 + depth * 14 }}>{children}</div>;
}

const VariableRow = React.memo(function VariableRow({ row }: { row: VariableRow }) {
  const toggleVariableExpand = useDebugStore((s) => s.toggleVariableExpand);
  const expandedRefs = useDebugStore((s) => s.expandedRefs);
  const loadingRefs = useDebugStore((s) => s.loadingRefs);

  if (row.kind === 'loading') {
    return (
      <RowIndent depth={row.depth}>
        <div className="flex items-center gap-1.5 px-2.5 py-0.5 text-text-muted">
          <Loader2 size={11} className="animate-spin shrink-0" />
          <span>Loading…</span>
        </div>
      </RowIndent>
    );
  }
  if (row.kind === 'error') {
    return (
      <RowIndent depth={row.depth}>
        <div className="px-2.5 py-0.5 text-accent-red truncate" title={row.message}>
          {row.message}
        </div>
      </RowIndent>
    );
  }

  const { v, depth } = row;
  const ref = v.variablesReference;
  const expandable = ref > 0;
  const expanded = !!expandedRefs[ref];
  const loading = !!loadingRefs[ref];
  return (
    <div
      className="flex items-baseline gap-2 px-2.5 py-0.5 hover:bg-bg-hover min-h-[22px] min-w-0"
      style={{ paddingLeft: 10 + depth * 14 }}
      title={v.value}
    >
      {expandable ? (
        <button
          type="button"
          className="shrink-0 self-center inline-flex items-center justify-center w-3.5 h-3.5 -ml-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={() => void toggleVariableExpand(ref)}
        >
          {loading ? (
            <Loader2 size={11} className="animate-spin" />
          ) : expanded ? (
            <ChevronDown size={11} />
          ) : (
            <ChevronRight size={11} />
          )}
        </button>
      ) : (
        <span className="shrink-0 self-center w-3.5 -ml-1" />
      )}
      <span className="text-accent-blue shrink-0">{v.name}</span>
      <span className="text-text-muted shrink-0">=</span>
      <span className="text-text-primary truncate min-w-0">{v.value}</span>
      {v.type ? (
        <span className="text-[10px] text-text-muted shrink-0 ml-auto pl-2">{v.type}</span>
      ) : null}
    </div>
  );
});

/** Variables tree + evaluate input (evaluate lives here, not in Console). */
function DebugVariablesPane() {
  const session = useDebugStore((s) => s.session);
  const variables = useDebugStore((s) => s.variables);
  const childrenByRef = useDebugStore((s) => s.childrenByRef);
  const expandedRefs = useDebugStore((s) => s.expandedRefs);
  const loadingRefs = useDebugStore((s) => s.loadingRefs);
  const varErrors = useDebugStore((s) => s.varErrors);
  const evaluate = useDebugStore((s) => s.evaluate);
  const javaBackendLabel = useJavaDebugStore((s) => s.backendLabel);

  const [expr, setExpr] = useState('');

  const live = !!session && session.status !== 'terminated' && session.status !== 'ended';
  const isStopped = live && session?.status === 'stopped';
  // host 后端的求值恒降级（NoopProviders）→ 直接禁用输入并说明原因，
  // 而不是让用户敲了表达式才收到错误（能力受限必须可见）。
  const evaluationAvailable = javaBackendLabel === null || javaBackendLabel === 'jdtls';

  const variableRows = useMemo(
    () => buildVariableRows(variables, childrenByRef, expandedRefs, loadingRefs, varErrors),
    [variables, childrenByRef, expandedRefs, loadingRefs, varErrors],
  );

  const handleEval = useCallback(async () => {
    const text = expr.trim();
    if (!text) return;
    setExpr('');
    await evaluate(text);
  }, [expr, evaluate]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-bg-secondary">
      <div className="shrink-0 h-7 border-b border-border flex items-center px-2.5 gap-2 bg-bg-primary/40">
        <span className="text-accent-blue font-mono text-[var(--font-size)] shrink-0 select-none">
          ›
        </span>
        <input
          type="text"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleEval();
          }}
          placeholder={
            !evaluationAvailable
              ? `Expression evaluation needs the JDTLS backend (current: ${javaBackendLabel})`
              : isStopped
                ? 'Evaluate expression…'
                : 'Evaluate when paused'
          }
          disabled={!isStopped || !evaluationAvailable}
          className="flex-1 min-w-0 bg-transparent text-[var(--font-size)] text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-40 font-mono"
        />
      </div>

      <SectionLabel>
        Variables
        {variables.length > 0 ? (
          <span className="ml-auto tabular-nums">{variables.length}</span>
        ) : null}
      </SectionLabel>

      <div className="flex-1 overflow-y-auto text-[var(--font-size)] font-mono">
        {variables.length === 0 ? (
          <EmptyHint className="font-sans">
            {isStopped ? 'Variables are not available' : 'Pause to inspect variables'}
          </EmptyHint>
        ) : (
          variableRows.map((row) => <VariableRow key={row.path} row={row} />)
        )}
      </div>
    </div>
  );
}

export default React.memo(DebugVariablesPane);
