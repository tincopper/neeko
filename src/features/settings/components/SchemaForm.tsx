/**
 * SchemaForm — auto-generated form from a JSON Schema definition.
 *
 * Recursively renders form fields based on an AgentPlugin's
 * `configuration.schema`. Supports: string, number, integer, boolean,
 * object, array, enum, format (password, url, path).
 *
 * Follows the project's component conventions: React.memo, Tailwind v4,
 * UI primitives from @/ui, CSS variables for font sizes.
 */

import React, { useCallback, useMemo, useState } from 'react';

import {
  validateConfig,
  type JsonSchema,
  type JsonValue,
  type ValidationError,
} from '@/lib/schemaValidator';

import SchemaFieldArray from './SchemaFieldArray';
import SchemaFieldBoolean from './SchemaFieldBoolean';
import SchemaFieldNumber from './SchemaFieldNumber';
import SchemaFieldObject from './SchemaFieldObject';
import SchemaFieldString from './SchemaFieldString';

interface SchemaFormProps {
  schema: JsonSchema;
  initialValue?: Record<string, unknown>;
  onChange?: (value: Record<string, unknown>) => void;
  onValidationChange?: (valid: boolean, errors: ValidationError[]) => void;
  readOnly?: boolean;
}

const SchemaForm: React.FC<SchemaFormProps> = ({
  schema,
  initialValue = {},
  onChange,
  onValidationChange,
  readOnly = false,
}) => {
  const [config, setConfig] = useState<Record<string, JsonValue>>(
    initialValue as Record<string, JsonValue>,
  );
  const [errors, setErrors] = useState<ValidationError[]>([]);

  const fieldErrors = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of errors) {
      map[e.path] = e.message;
    }
    return map;
  }, [errors]);

  const handleFieldChange = useCallback(
    (path: string, value: unknown) => {
      setConfig((prev) => {
        const next: Record<string, JsonValue> = { ...prev };
        if (value === undefined || value === null) {
          delete next[path];
        } else {
          next[path] = value as JsonValue;
        }
        // Validate on every change
        const result = validateConfig(schema, next);
        if (result.valid) {
          setErrors([]);
          onValidationChange?.(true, []);
        } else {
          setErrors(result.errors);
          onValidationChange?.(false, result.errors);
        }
        onChange?.(next as Record<string, unknown>);
        return next;
      });
    },
    [schema, onChange, onValidationChange],
  );

  const renderField = (
    key: string,
    fieldSchema: JsonSchema,
    required: boolean,
  ): React.ReactNode => {
    const path = key;
    const value = config[key];
    const error = fieldErrors[path];

    const commonProps = {
      path,
      schema: fieldSchema,
      value,
      required,
      error,
      readOnly,
      onChange: handleFieldChange,
    };

    switch (fieldSchema.type) {
      case 'string':
        return <SchemaFieldString key={key} {...commonProps} />;
      case 'number':
      case 'integer':
        return <SchemaFieldNumber key={key} {...commonProps} />;
      case 'boolean':
        return <SchemaFieldBoolean key={key} {...commonProps} />;
      case 'object':
        return <SchemaFieldObject key={key} {...commonProps} />;
      case 'array':
        return <SchemaFieldArray key={key} {...commonProps} />;
      default:
        return null;
    }
  };

  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  return (
    <div className="flex flex-col gap-3 p-3">
      {Object.entries(properties).map(([key, fieldSchema]) =>
        renderField(key, fieldSchema, required.includes(key)),
      )}
      {errors.length > 0 && (
        <div className="text-[0.75em] text-red-400 bg-red-500/10 px-2 py-1 rounded mt-1">
          {errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; ')}
        </div>
      )}
    </div>
  );
};

export default React.memo(SchemaForm);
