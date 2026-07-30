/**
 * AgentPluginForm — form for creating a custom AgentPlugin.
 *
 * Collects: name, description, icon, command, args, skills path.
 * Serializes to the JSON blobs expected by the backend `save_custom_plugin` command.
 */

import React, { useState, useCallback } from 'react';

import { saveCustomPlugin, type SaveCustomPluginInput } from '../api/agentPluginApi';

interface AgentPluginFormProps {
  onSaved?: (plugin: SaveCustomPluginInput) => void;
  onCancel?: () => void;
}

interface FormState {
  id: string;
  name: string;
  description: string;
  icon: string;
  command: string;
  args: string;
  promptArgs: string;
  skillsPath: string;
  commandsPath: string;
  detectionType: 'command' | 'directory' | 'file';
  detectionTarget: string;
}

const INITIAL: FormState = {
  id: '',
  name: '',
  description: '',
  icon: '',
  command: '',
  args: '',
  promptArgs: '',
  skillsPath: '{{projectPath}}/.agent/skills',
  commandsPath: '{{projectPath}}/.agent/commands',
  detectionType: 'command',
  detectionTarget: '',
};

const AgentPluginForm: React.FC<AgentPluginFormProps> = ({ onSaved, onCancel }) => {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!form.id.trim()) {
        setError('Plugin ID is required');
        return;
      }
      if (!form.name.trim()) {
        setError('Plugin name is required');
        return;
      }
      if (!form.command.trim()) {
        setError('Command is required');
        return;
      }

      setSaving(true);
      try {
        const input: SaveCustomPluginInput = {
          id: form.id.trim(),
          name: form.name.trim(),
          icon: form.icon.trim() || null,
          description: form.description.trim() || null,
          version: '1.0',
          execution_json: JSON.stringify({
            command: form.command.trim(),
            args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
            env: {},
            prompt_args: form.promptArgs.trim() ? form.promptArgs.trim().split(/\s+/) : null,
            detection: {
              type: form.detectionType,
              target: form.detectionTarget.trim() || form.command.trim(),
            },
          }),
          configuration_json: JSON.stringify({
            schema: { type: 'object', properties: {} },
            defaults: {},
          }),
          capabilities_json: JSON.stringify({
            skills: { supported: true, format: 'skill.md' },
          }),
          paths_json: JSON.stringify({
            config: {
              relative: `{{home}}/.${form.id.trim()}/config.json`,
              format: 'json',
            },
            skills: {
              relative: form.skillsPath.trim() || `{{projectPath}}/.${form.id.trim()}/skills`,
              format: 'directory',
              project_level: true,
            },
            commands: {
              relative: form.commandsPath.trim() || `{{projectPath}}/.${form.id.trim()}/commands`,
              format: 'markdown',
              project_level: true,
            },
            mcp: {
              relative: `{{home}}/.${form.id.trim()}/config.json`,
              format: 'json',
            },
            hooks: {
              relative: `{{projectPath}}/.${form.id.trim()}/hooks`,
              format: 'script',
              project_level: true,
            },
            plugins: {
              relative: `{{projectPath}}/.${form.id.trim()}/plugins`,
              format: 'directory',
              project_level: true,
            },
          }),
          lifecycle_json: null,
        };

        await saveCustomPlugin(input);
        onSaved?.(input);
        setForm(INITIAL);
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
    },
    [form, onSaved],
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3">
      <div className="text-[0.86em] font-semibold text-text-primary">
        Create Custom Agent Plugin
      </div>

      {error && (
        <div className="text-[0.78em] text-red-400 bg-red-500/10 px-2 py-1 rounded">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.75em] text-text-muted">ID *</span>
          <input
            type="text"
            value={form.id}
            onChange={(e) => update('id', e.target.value)}
            placeholder="my-agent"
            className="bg-bg-secondary border border-border rounded px-2 py-1 text-[0.82em] text-text-primary outline-none focus:border-accent-blue"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.75em] text-text-muted">Name *</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="My Agent"
            className="bg-bg-secondary border border-border rounded px-2 py-1 text-[0.82em] text-text-primary outline-none focus:border-accent-blue"
          />
        </label>
      </div>

      <label className="flex flex-col gap-0.5">
        <span className="text-[0.75em] text-text-muted">Description</span>
        <input
          type="text"
          value={form.description}
          onChange={(e) => update('description', e.target.value)}
          placeholder="A custom agent provider"
          className="bg-bg-secondary border border-border rounded px-2 py-1 text-[0.82em] text-text-primary outline-none focus:border-accent-blue"
        />
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="text-[0.75em] text-text-muted">Icon (path or name)</span>
        <input
          type="text"
          value={form.icon}
          onChange={(e) => update('icon', e.target.value)}
          placeholder="my-agent.svg"
          className="bg-bg-secondary border border-border rounded px-2 py-1 text-[0.82em] text-text-primary outline-none focus:border-accent-blue"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.75em] text-text-muted">Command *</span>
          <input
            type="text"
            value={form.command}
            onChange={(e) => update('command', e.target.value)}
            placeholder="myagent"
            className="bg-bg-secondary border border-border rounded px-2 py-1 text-[0.82em] text-text-primary outline-none focus:border-accent-blue"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.75em] text-text-muted">Args (space-separated)</span>
          <input
            type="text"
            value={form.args}
            onChange={(e) => update('args', e.target.value)}
            placeholder="--flag value"
            className="bg-bg-secondary border border-border rounded px-2 py-1 text-[0.82em] text-text-primary outline-none focus:border-accent-blue"
          />
        </label>
      </div>

      <label className="flex flex-col gap-0.5">
        <span className="text-[0.75em] text-text-muted">Prompt Args (space-separated)</span>
        <input
          type="text"
          value={form.promptArgs}
          onChange={(e) => update('promptArgs', e.target.value)}
          placeholder="-p --bare"
          className="bg-bg-secondary border border-border rounded px-2 py-1 text-[0.82em] text-text-primary outline-none focus:border-accent-blue"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.75em] text-text-muted">Detection Type</span>
          <select
            value={form.detectionType}
            onChange={(e) =>
              update('detectionType', e.target.value as 'command' | 'directory' | 'file')
            }
            className="bg-bg-secondary border border-border rounded px-2 py-1 text-[0.82em] text-text-primary outline-none focus:border-accent-blue"
          >
            <option value="command">command</option>
            <option value="directory">directory</option>
            <option value="file">file</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[0.75em] text-text-muted">Detection Target</span>
          <input
            type="text"
            value={form.detectionTarget}
            onChange={(e) => update('detectionTarget', e.target.value)}
            placeholder="(defaults to command)"
            className="bg-bg-secondary border border-border rounded px-2 py-1 text-[0.82em] text-text-primary outline-none focus:border-accent-blue"
          />
        </label>
      </div>

      <label className="flex flex-col gap-0.5">
        <span className="text-[0.75em] text-text-muted">Skills Path Template</span>
        <input
          type="text"
          value={form.skillsPath}
          onChange={(e) => update('skillsPath', e.target.value)}
          className="bg-bg-secondary border border-border rounded px-2 py-1 text-[0.82em] text-text-primary outline-none focus:border-accent-blue font-mono"
        />
      </label>

      <div className="flex gap-2 mt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-1 bg-accent-blue text-white rounded text-[0.82em] font-medium disabled:opacity-50 hover:bg-accent-blue/90"
        >
          {saving ? 'Saving...' : 'Save Plugin'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 bg-bg-secondary border border-border rounded text-[0.82em] text-text-primary hover:bg-bg-hover"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};

export default React.memo(AgentPluginForm);
