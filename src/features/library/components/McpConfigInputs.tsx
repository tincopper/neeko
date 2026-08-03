import React from 'react';

import type { McpRegistryEnvVar, McpRegistryInput } from '@/features/library/api/libraryApi';

import McpInputControl from './McpInputControl';

interface McpConfigInputsProps {
  /** Server-declared env vars — only secret ones require user input. */
  env: McpRegistryEnvVar[];
  /** Server-declared config inputs (Argument schema) driving dynamic form controls. */
  inputs: McpRegistryInput[];
  /** Current user-entered values keyed by env/input name. */
  values: Record<string, string>;
  /** Called on every value change: (name, value). */
  onChange: (name: string, value: string) => void;
}

/**
 * Config-only section for the marketplace install dialog: secret env values the
 * user must fill in plus server-declared dynamic config inputs. Non-secret env
 * vars are omitted here — their defaults are merged on save.
 */
const McpConfigInputs: React.FC<McpConfigInputsProps> = React.memo(
  ({ env, inputs, values, onChange }) => {
    const secretEnv = env.filter((e) => e.isSecret);
    if (secretEnv.length === 0 && inputs.length === 0) return null;

    return (
      <div className="rounded-md border border-border p-3 space-y-3 bg-bg-primary/40">
        {secretEnv.length > 0 && (
          <div className="space-y-2">
            <span className="block text-[11px] font-medium text-text-muted">
              Secret Environment
            </span>
            {secretEnv.map((ev) => (
              <div key={ev.name}>
                <label
                  htmlFor={`mcp-secret-${ev.name}`}
                  className="block text-[11px] font-medium text-text-muted mb-1"
                >
                  {ev.name}
                  {ev.isRequired && <span className="text-accent-red ml-1">*</span>}
                  <span className="text-accent-yellow ml-1">(secret)</span>
                </label>
                <input
                  id={`mcp-secret-${ev.name}`}
                  type="password"
                  className="w-full h-8 px-2.5 text-[var(--font-size)] rounded-md font-mono bg-bg-primary border border-border text-text-primary outline-none focus:border-accent-blue placeholder:text-text-muted"
                  placeholder="secret value required"
                  value={values[ev.name] ?? ''}
                  onChange={(e) => onChange(ev.name, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}

        {inputs.length > 0 && (
          <div className="space-y-2">
            <span className="block text-[11px] font-medium text-text-muted">Configuration</span>
            {inputs.map((input) => (
              <div key={input.name}>
                <label
                  htmlFor={`mcp-input-${input.name}`}
                  className="block text-[11px] font-medium text-text-muted mb-1"
                >
                  {input.name}
                  {input.isRequired && <span className="text-accent-red ml-1">*</span>}
                  {input.isSecret && <span className="text-accent-yellow ml-1">(secret)</span>}
                </label>
                <McpInputControl
                  input={input}
                  value={values[input.name] ?? ''}
                  onChange={(v) => onChange(input.name, v)}
                />
              </div>
            ))}
            <p className="text-[10px] text-text-muted leading-snug">
              Values are merged into the environment configuration on save. Secret inputs are never
              auto-filled.
            </p>
          </div>
        )}
      </div>
    );
  },
);

McpConfigInputs.displayName = 'McpConfigInputs';

export default McpConfigInputs;
