/**
 * SchemaFieldBoolean — renders a boolean field from a JSON Schema property.
 *
 * Uses the project's Switch component for a consistent toggle UI.
 */

import React, { useCallback } from 'react';

import { Switch } from '@/ui';

import type { BaseFieldProps } from './types';

interface SchemaFieldBooleanProps extends BaseFieldProps {
  onChange: (path: string, value: unknown) => void;
}

const SchemaFieldBoolean: React.FC<SchemaFieldBooleanProps> = ({
  path,
  schema,
  value,
  error,
  readOnly,
  onChange,
}) => {
  const handleChange = useCallback(
    (checked: boolean) => {
      onChange(path, checked);
    },
    [path, onChange],
  );

  const label = schema.description || path.replace(/([A-Z])/g, ' $1').trim();

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex-1 min-w-0">
        <span className="text-[0.75em] text-text-muted">{label}</span>
        {error && <div className="text-[0.7em] text-red-400 mt-0.5">{error}</div>}
      </div>
      <Switch
        checked={(value as boolean) || false}
        onCheckedChange={handleChange}
        disabled={readOnly}
      />
    </div>
  );
};

export default React.memo(SchemaFieldBoolean);
