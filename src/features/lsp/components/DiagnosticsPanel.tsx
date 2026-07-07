import type { LspDiagnostic } from '../types';

interface DiagnosticsPanelProps {
  diagnostics: LspDiagnostic[];
  fileName: string;
  onJumpToLine?: (line: number) => void;
}

export function DiagnosticsPanel({ diagnostics, onJumpToLine }: DiagnosticsPanelProps) {
  if (diagnostics.length === 0) {
    return <div className="p-3 text-xs text-text-secondary">No diagnostics</div>;
  }

  const errors = diagnostics.filter((d) => d.severity !== null && d.severity <= 2);
  const warnings = diagnostics.filter(
    (d) => d.severity !== null && d.severity > 2 && d.severity <= 3,
  );
  const info = diagnostics.filter((d) => d.severity === null || d.severity > 3);

  const severityIcon = (severity: number | null) => {
    if (severity === null || severity > 3) return 'ℹ️';
    if (severity <= 2) return '✕';
    return '⚠';
  };

  const severityColor = (severity: number | null) => {
    if (severity === null || severity > 3) return 'text-blue-500';
    if (severity <= 2) return 'text-red-500';
    return 'text-yellow-500';
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-1.5 text-xs font-medium text-text-secondary border-b border-border flex items-center gap-3">
        <span className="text-red-500">
          {errors.length} error{errors.length !== 1 ? 's' : ''}
        </span>
        <span className="text-yellow-500">
          {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
        </span>
        <span className="text-blue-500">{info.length} info</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {diagnostics.map((d, i) => (
          <button
            key={i}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-bg-hover transition-colors border-b border-border/50 flex items-start gap-2"
            onClick={() => onJumpToLine?.(d.range.start.line)}
          >
            <span className={`mt-0.5 shrink-0 ${severityColor(d.severity)}`}>
              {severityIcon(d.severity)}
            </span>
            <div className="min-w-0">
              <p className="text-text-primary truncate">{d.message}</p>
              <p className="text-text-secondary">
                L{d.range.start.line + 1}:{d.range.start.character}
                {d.source ? ` • ${d.source}` : ''}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
