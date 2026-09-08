import React, { useEffect, useMemo, useRef } from 'react';

import { useAppContext } from '@/shared/contexts/AppContext';
import { buildMonoStack } from '@/shared/utils/typography';

import { useDebugStore } from '../store/debugStore';

/** Debug console — same bg / fg / size / typeface as Task Console (xterm). */
function DebugConsolePane() {
  const consoleLines = useDebugStore((s) => s.consoleLines);
  const { config } = useAppContext();

  const consoleEndRef = useRef<HTMLDivElement>(null);

  /** Same typeface + size as Task Console / xterm. */
  const terminalType = useMemo(
    () => ({
      fontSize: config.terminalFontSize ?? 14,
      fontFamily: buildMonoStack(config.monoFontFamily ?? config.fontFamily ?? ''),
    }),
    [config.terminalFontSize, config.monoFontFamily, config.fontFamily],
  );

  // Pane mounts only when the console tab is active — scroll on mount + new lines.
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLines]);

  return (
    <div
      className="flex-1 flex flex-col min-h-0 min-w-0"
      style={{ backgroundColor: 'var(--terminal-bg, var(--bg-secondary))' }}
    >
      <div
        className="flex-1 overflow-y-auto px-3 py-1.5 space-y-0.5"
        style={{
          fontSize: `${terminalType.fontSize}px`,
          fontFamily: terminalType.fontFamily,
          color: 'var(--terminal-fg, var(--text-secondary))',
          lineHeight: 1.35,
        }}
      >
        {consoleLines.length === 0 ? (
          <div
            className="h-full flex items-center justify-center px-3 text-center leading-relaxed"
            style={{
              fontSize: `${terminalType.fontSize}px`,
              fontFamily: terminalType.fontFamily,
              color: 'var(--terminal-fg-dim, var(--text-muted))',
            }}
          >
            Debug output and build messages appear here.
          </div>
        ) : (
          consoleLines.map((line) => (
            <div
              key={line.id}
              className="whitespace-pre-wrap"
              style={{
                fontSize: `${terminalType.fontSize}px`,
                fontFamily: terminalType.fontFamily,
                color:
                  line.kind === 'in'
                    ? 'var(--accent-blue)'
                    : line.kind === 'err'
                      ? 'var(--accent-red)'
                      : line.kind === 'sys'
                        ? 'var(--terminal-fg-dim, var(--text-muted))'
                        : 'var(--terminal-fg, var(--text-secondary))',
              }}
            >
              {line.kind === 'in' ? `› ${line.text}` : line.text}
            </div>
          ))
        )}
        <div ref={consoleEndRef} />
      </div>
    </div>
  );
}

export default React.memo(DebugConsolePane);
