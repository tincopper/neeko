/**
 * SchemaFieldString — renders a string field from a JSON Schema property.
 *
 * - `enum` → Select dropdown
 * - `format: "password"` → password input
 * - otherwise → text input
 *
 * Uses project UI primitives (Input, Select) and CSS variables for font sizing.
 */

import React, { useCallback } from 'react';

import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui';

import type { BaseFieldProps } from './types';

interface SchemaFieldStringProps extends BaseFieldProps {
  onChange: (path: string, value: unknown) => void;
}

const SchemaFieldString: React.FC<SchemaFieldStringProps> = ({
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
      onChange(path, newValue || undefined);
    },
    [path, onChange],
  );

  const label = schema.description || path.replace(/([A-Z])/g, ' $1').trim();
  const enumValues = schema.enum as string[] | undefined;

  // Enum → Select
  if (enumValues && enumValues.length > 0) {
    return (
      <label className="flex flex-col gap-0.5">
        <span className="text-[0.75em] text-text-muted">
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </span>
        <Select value={(value as string) || ''} onValueChange={handleChange} disabled={readOnly}>
          <SelectTrigger className={error ? 'border-red-400' : undefined}>
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {enumValues.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <span className="text-[0.7em] text-red-400">{error}</span>}
      </label>
    );
  }

  // Password format
  const inputType = schema.format === 'password' ? 'password' : 'text';

  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[0.75em] text-text-muted">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      <Input
        type={inputType}
        value={(value as string) || ''}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={(schema.default as string) || ''}
        readOnly={readOnly}
        className={error ? 'border-red-400 focus:border-red-400' : undefined}
      />
      {error && <span className="text-[0.7em] text-red-400">{error}</span>}
    </label>
  );
};

export default React.memo(SchemaFieldString);
