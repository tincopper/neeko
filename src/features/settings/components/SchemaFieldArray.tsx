/**
 * SchemaFieldArray — renders an array field from a JSON Schema property.
 *
 * Provides a dynamic list with add/remove controls. Items are strings
 * (the most common case for agent config arrays like rules, tools, tags).
 */

import React, { useCallback, useMemo, useState } from 'react';

import type { BaseFieldProps } from './types';

interface SchemaFieldArrayProps extends BaseFieldProps {
  onChange: (path: string, value: unknown) => void;
}

const SchemaFieldArray: React.FC<SchemaFieldArrayProps> = ({
  path,
  schema,
  value = [],
  required,
  error,
  readOnly,
  onChange,
}) => {
  const [draft, setDraft] = useState('');

  const items = useMemo(() => (Array.isArray(value) ? value : []), [value]);

  const handleAdd = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed) {
      onChange(path, [...items, trimmed]);
      setDraft('');
    }
  }, [path, draft, items, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      const next = items.filter((_, i) => i !== index);
      onChange(path, next);
    },
    [path, items, onChange],
  );

  const handleItemChange = useCallback(
    (index: number, newVal: string) => {
      const next = items.map((item, i) => (i === index ? newVal : item));
      onChange(path, next);
    },
    [path, items, onChange],
  );

  const label = schema.description || path.replace(/([A-Z])/g, ' $1').trim();
  const itemSchema = schema.items;
  const isStringArray = !itemSchema || itemSchema.type === 'string';

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.75em] text-text-muted">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
        <span className="text-text-muted/60 ml-1">({items.length})</span>
      </span>

      {items.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-1">
              {isStringArray ? (
                <input
                  type="text"
                  value={String(item)}
                  onChange={(e) => handleItemChange(index, e.target.value)}
                  readOnly={readOnly}
                  className="flex-1 min-w-0 bg-bg-secondary border border-border rounded px-2 py-0.5 text-[0.82em] text-text-primary font-mono outline-none focus:border-accent-blue"
                />
              ) : (
                <span className="flex-1 min-w-0 text-[0.82em] text-text-primary font-mono truncate">
                  {String(item)}
                </span>
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="text-text-muted hover:text-red-400 text-[0.93em] px-1 shrink-0"
                  title="Remove"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!readOnly && isStringArray && (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Add item..."
            className="flex-1 min-w-0 bg-bg-secondary border border-border rounded px-2 py-0.5 text-[0.82em] text-text-primary font-mono outline-none focus:border-accent-blue placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!draft.trim()}
            className="text-accent-blue disabled:opacity-30 text-[0.82em] px-1.5 py-0.5 border border-border rounded hover:bg-bg-hover shrink-0"
          >
            +
          </button>
        </div>
      )}

      {error && <span className="text-[0.7em] text-red-400">{error}</span>}
    </div>
  );
};

export default React.memo(SchemaFieldArray);
