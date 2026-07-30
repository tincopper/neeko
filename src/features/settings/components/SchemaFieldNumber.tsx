/**
 * SchemaFieldNumber — renders a number/integer field from a JSON Schema property.
 *
 * Uses a number input with min/max constraints from the schema.
 */

import React, { useCallback } from 'react';

import { Input } from '@/ui';

import type { BaseFieldProps } from './types';

interface SchemaFieldNumberProps extends BaseFieldProps {
  onChange: (path: string, value: unknown) => void;
}

const SchemaFieldNumber: React.FC<SchemaFieldNumberProps> = ({
  path,
  schema,
  value,
  required,
  error,
  readOnly,
  onChange,
}) => {
  const handleChange = useCallback(
    (newValue: string) => {
      if (newValue === '') {
        onChange(path, undefined);
        return;
      }
      const num = schema.type === 'integer' ? parseInt(newValue, 10) : parseFloat(newValue);
      if (Number.isNaN(num)) {
        onChange(path, undefined);
      } else {
        onChange(path, num);
      }
    },
    [path, schema.type, onChange],
  );

  const label = schema.description || path.replace(/([A-Z])/g, ' $1').trim();

  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[0.75em] text-text-muted">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      <Input
        type="number"
        value={value != null ? String(value) : ''}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={schema.default != null ? String(schema.default) : ''}
        readOnly={readOnly}
        min={schema.minimum}
        max={schema.maximum}
        className={error ? 'border-red-400 focus:border-red-400' : undefined}
      />
      {error && <span className="text-[0.7em] text-red-400">{error}</span>}
    </label>
  );
};

export default React.memo(SchemaFieldNumber);
