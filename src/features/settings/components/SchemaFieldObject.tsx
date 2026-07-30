/**
 * SchemaFieldObject — renders a nested object field from a JSON Schema property.
 *
 * Recursively renders form fields inside a collapsible fieldset.
 * - Objects with `properties` → renders each property using the shared
 *   SchemaField components (string, number, boolean, array, object)
 * - Objects with `additionalProperties` (and no `properties`) → renders a JSON
 *   textarea for free-form key/value editing (e.g. mcpServers, env)
 *
 * Uses project UI primitives (Textarea) and reuses SchemaField components
 * for consistency.
 */

import React, { useCallback, useMemo, useState } from 'react';

import { validateConfig, type JsonValue, type ValidationError } from '@/lib/schemaValidator';
import { Textarea } from '@/ui';

import SchemaFieldArray from './SchemaFieldArray';
import SchemaFieldBoolean from './SchemaFieldBoolean';
import SchemaFieldNumber from './SchemaFieldNumber';
import SchemaFieldString from './SchemaFieldString';
import type { BaseFieldProps } from './types';

interface SchemaFieldObjectProps extends BaseFieldProps {
  onChange: (path: string, value: unknown) => void;
}

const SchemaFieldObject: React.FC<SchemaFieldObjectProps> = ({
  path,
  schema,
  value = {},
  error,
  readOnly,
  onChange,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [nestedErrors, setNestedErrors] = useState<ValidationError[]>([]);

  const properties = schema.properties ?? {};
  const additionalProperties = schema.additionalProperties;
  const hasProperties = Object.keys(properties).length > 0;
  const hasAdditionalProperties =
    !hasProperties && additionalProperties != null && typeof additionalProperties === 'object';

  // For additionalProperties objects: validate + edit as JSON
  const jsonText = useMemo(() => {
    if (!hasAdditionalProperties) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }, [hasAdditionalProperties, value]);

  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleNestedChange = useCallback(
    (newValue: Record<string, JsonValue>) => {
      const result = validateConfig(schema, newValue);
      if (result.valid) {
        setNestedErrors([]);
      } else {
        setNestedErrors(result.errors);
      }
      onChange(path, newValue as Record<string, unknown>);
    },
    [path, schema, onChange],
  );

  const handleJsonChange = useCallback(
    (text: string) => {
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setJsonError('Must be a JSON object');
          return;
        }
        setJsonError(null);
        const result = validateConfig(schema, parsed);
        if (!result.valid) {
          setNestedErrors(result.errors);
        } else {
          setNestedErrors([]);
        }
        onChange(path, parsed as Record<string, unknown>);
      } catch {
        setJsonError('Invalid JSON');
      }
    },
    [path, schema, onChange],
  );

  const label = schema.description || path.replace(/([A-Z])/g, ' $1').trim();
  const required = schema.required ?? [];
  const hasError = !!error || nestedErrors.length > 0 || jsonError !== null;

  return (
    <fieldset className="border border-border rounded-md p-2">
      <button
        type="button"
        className="text-[0.75em] text-text-muted px-1 cursor-pointer select-none bg-transparent border-none outline-none"
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      >
        {collapsed ? '▶ ' : '▼ '}
        {label}
        {hasError && <span className="text-red-400 ml-1">●</span>}
      </button>
      {!collapsed && hasProperties && (
        <div className="flex flex-col gap-2 mt-1">
          {Object.entries(properties).map(([key, fieldSchema]) => {
            const fieldPath = `${path}.${key}`;
            const fieldValue = (value as Record<string, JsonValue>)[key];
            const fieldError = nestedErrors.find((e) => e.path === key)?.message;

            const commonProps = {
              path: fieldPath,
              schema: fieldSchema,
              value: fieldValue,
              required: required.includes(key),
              error: fieldError,
              readOnly,
              onChange: (_p: string, v: unknown) => {
                handleNestedChange({
                  ...(value as Record<string, JsonValue>),
                  [key]: v as JsonValue,
                });
              },
            };

            switch (fieldSchema.type) {
              case 'string':
                return <SchemaFieldString key={key} {...commonProps} />;
              case 'number':
              case 'integer':
                return <SchemaFieldNumber key={key} {...commonProps} />;
              case 'boolean':
                return <SchemaFieldBoolean key={key} {...commonProps} />;
              case 'array':
                return <SchemaFieldArray key={key} {...commonProps} />;
              case 'object':
                return <SchemaFieldObject key={key} {...commonProps} />;
              default:
                return null;
            }
          })}
        </div>
      )}
      {!collapsed && hasAdditionalProperties && (
        <div className="flex flex-col gap-1 mt-1">
          <span className="text-[0.75em] text-text-muted">Key-value pairs (one JSON object)</span>
          <Textarea
            value={jsonText}
            onChange={(e) => handleJsonChange(e.target.value)}
            readOnly={readOnly}
            rows={6}
            className={jsonError ? 'border-red-400 focus:border-red-400' : undefined}
          />
          {jsonError && <span className="text-[0.7em] text-red-400">{jsonError}</span>}
        </div>
      )}
      {error && <span className="text-[0.7em] text-red-400 mt-1">{error}</span>}
    </fieldset>
  );
};

export default React.memo(SchemaFieldObject);
