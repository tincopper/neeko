import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { AGENT_MODES, THINKING_LEVELS } from './constants';

function AgentModeSelector({
  modes,
  selected,
  onChange,
}: {
  modes: typeof AGENT_MODES;
  selected: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const positionDropdown = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const dropdown = btnRef.current
      .closest('.param-selector-wrap')
      ?.querySelector('.param-dropdown') as HTMLElement;
    if (dropdown) {
      dropdown.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      dropdown.style.left = `${rect.left}px`;
    }
  }, []);

  const current = modes.find((m) => m.id === selected) ?? modes[0];
  const Icon = current.icon;

  return (
    <div className="param-selector-wrap">
      <button
        ref={btnRef}
        className={`param-selector-btn${open ? ' open' : ''}`}
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(positionDropdown, 0);
        }}
      >
        <span className="param-icon">
          <Icon size={14} />
        </span>
        <span className="param-name">{current.name}</span>
        <span className="param-chevron">
          <ChevronDown size={12} />
        </span>
      </button>
      {open && (
        <>
          <div
            className="drop-overlay"
            role="button"
            tabIndex={0}
            aria-label="关闭下拉菜单"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <div className="param-dropdown show">
            {modes.map((m) => {
              const MIcon = m.icon;
              return (
                <button
                  key={m.id}
                  className={`param-option${m.id === selected ? ' selected' : ''}`}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                >
                  <span className="param-opt-icon">
                    <MIcon size={14} />
                  </span>
                  <span className="param-opt-info">
                    <span className="param-opt-name">{m.name}</span>
                    <span className="param-opt-desc">{m.desc}</span>
                  </span>
                  <span className="param-opt-check">
                    <Check size={12} />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ThinkingLevelSelector({
  levels,
  selected,
  onChange,
}: {
  levels: typeof THINKING_LEVELS;
  selected: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const positionDropdown = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const dropdown = btnRef.current
      .closest('.param-selector-wrap')
      ?.querySelector('.param-dropdown') as HTMLElement;
    if (dropdown) {
      dropdown.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      dropdown.style.left = `${rect.left}px`;
    }
  }, []);

  const current = levels.find((l) => l.id === selected) ?? levels[2];
  const Icon = current.icon;

  return (
    <div className="param-selector-wrap">
      <button
        ref={btnRef}
        className={`param-selector-btn${open ? ' open' : ''}`}
        onClick={() => {
          setOpen(!open);
          if (!open) setTimeout(positionDropdown, 0);
        }}
      >
        <span className="param-icon">
          <Icon size={14} />
        </span>
        <span className="param-name">{current.name}</span>
        <span className="param-chevron">
          <ChevronDown size={12} />
        </span>
      </button>
      {open && (
        <>
          <div
            className="drop-overlay"
            role="button"
            tabIndex={0}
            aria-label="关闭下拉菜单"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <div className="param-dropdown show">
            {levels.map((l) => {
              const LIcon = l.icon;
              return (
                <button
                  key={l.id}
                  className={`param-option${l.id === selected ? ' selected' : ''}`}
                  onClick={() => {
                    onChange(l.id);
                    setOpen(false);
                  }}
                >
                  <span className="param-opt-icon">
                    <LIcon size={14} />
                  </span>
                  <span className="param-opt-info">
                    <span className="param-opt-name">{l.name}</span>
                    <span className="param-opt-desc">{l.desc}</span>
                  </span>
                  <span className="param-opt-check">
                    <Check size={12} />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export { AgentModeSelector, ThinkingLevelSelector };
