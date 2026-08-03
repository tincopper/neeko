import React from 'react';

import type { McpRegistryInput } from '@/features/library/api/libraryApi';
import { cn } from '@/lib/utils';

interface McpInputControlProps {
  input: McpRegistryInput;
  value: string;
  onChange: (value: string) => void;
}

const INPUT_CLASS =
  'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md font-mono bg-bg-primary border border-border text-text-primary outline-none focus:border-accent-blue placeholder:text-text-muted';

/**
 * Control for a single server-declared config input (Argument schema):
 * choices → select, format=boolean → true/false select, otherwise text/number/password.
 */
const McpInputControl: React.FC<McpInputControlProps> = React.memo(({ input, value, onChange }) => {
  // Select when choices are declared.
  if (input.choices.length > 0) {
    return (
      <select
        id={`mcp-input-${input.name}`}
        className={INPUT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {input.choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    );
  }
  // Boolean toggle.
  if (input.format === 'boolean') {
    return (
      <select
        id={`mcp-input-${input.name}`}
        className={INPUT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  return (
    <input
      id={`mcp-input-${input.name}`}
      type={input.isSecret ? 'password' : input.format === 'number' ? 'number' : 'text'}
      className={cn(INPUT_CLASS)}
      placeholder={input.placeholder ?? (input.isSecret ? 'secret value required' : '')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
});

McpInputControl.displayName = 'McpInputControl';

export default McpInputControl;
