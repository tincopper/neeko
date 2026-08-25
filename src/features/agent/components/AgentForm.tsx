/**
 * AgentForm — 自定义 Agent 的编辑表单（数据对象 = AgentConfig）。
 *
 * 分组布局：身份 / CLI 执行 / 能力（CHAT + Headless）/ 部署。
 * 顶部实时预览能力徽标（CLI / CHAT / Headless 正交能力）。
 * 保存走 `add_agent`（持久化到 customAgents）。
 */

import { open } from '@tauri-apps/plugin-dialog';
import React, { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import type { AgentConfig, ChatStart } from '@/shared/types/agent';
import { PRESET_AGENT_ICONS } from '@/shared/utils/agents';
import { Button } from '@/ui';

import { addAgent, importAgentIcon, resolveAgentIconSrc } from '../api/agentApi';

import CapabilityBadges from './CapabilityBadges';

const CHAT_OPTIONS: { value: ChatStart; label: string; hint: string }[] = [
  { value: 'acp', label: 'ACP', hint: 'JSON-RPC stdio subprocess' },
  { value: 'serve', label: 'Serve', hint: 'opencode serve · HTTP+SSE' },
  { value: 'jsonl', label: 'JSON-Lines', hint: 'Custom stdio protocol' },
  { value: 'mock', label: 'Mock', hint: 'In-process mock (no subprocess)' },
];

const CHAT_HINTS: Record<ChatStart, string> = {
  acp: 'Agent Client Protocol over JSON-RPC stdio (subprocess)',
  serve: 'opencode serve HTTP + SSE transport',
  jsonl: 'Custom JSON-Lines stdio protocol',
  mock: 'In-process ACP mock, no command required',
};

interface AgentFormProps {
  /** 编辑已有 Agent（缺省 = 新建）。 */
  initial?: AgentConfig | null;
  onSaved?: (agent: AgentConfig) => void;
  onCancel?: () => void;
}

/** 空格分隔字符串 ↔ 参数数组。 */
function splitArgs(s: string): string[] {
  return s.trim() ? s.trim().split(/\s+/) : [];
}

/** 逗号分隔字符串 ↔ 参数数组（Headless/ACP 参数常见带空格的值）。 */
function splitCsv(s: string): string[] {
  return s.trim()
    ? s
        .trim()
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean)
    : [];
}

function emptyForm(): AgentConfig {
  return {
    id: '',
    name: '',
    icon: 'cli.svg',
    enabled: true,
    command: '',
    args: [],
    env: {},
    chat: null,
    prompt_args: null,
    post_prompt_args: null,
    skill_path: null,
    detection: null,
    deploy: { skills: '{{projectPath}}/.agent/skills', commands: null, mcp_config: null },
  };
}

/** 表单的文本态字段（数组字段以可编辑字符串承载）。 */
interface FormTextState {
  id: string;
  name: string;
  command: string;
  argsText: string;
  icon: string;
  enabled: boolean;
  chat: ChatStart | '';
  promptArgsText: string;
  postPromptArgsText: string;
  skillPath: string;
  detectionCmd: string;
  deploySkills: string;
  deployCommands: string;
  deployMcp: string;
}

function toTextState(form: AgentConfig): FormTextState {
  return {
    id: form.id,
    name: form.name,
    command: form.command,
    argsText: form.args?.join(' ') ?? '',
    icon: form.icon ?? 'cli.svg',
    enabled: form.enabled,
    chat: form.chat ?? '',
    promptArgsText: form.prompt_args?.join(', ') ?? '',
    postPromptArgsText: form.post_prompt_args?.join(', ') ?? '',
    skillPath: form.skill_path ?? '',
    detectionCmd: form.detection?.type === 'command' ? form.detection.target : '',
    deploySkills: form.deploy?.skills ?? '{{projectPath}}/.agent/skills',
    deployCommands: form.deploy?.commands ?? '',
    deployMcp: form.deploy?.mcp_config ?? '',
  };
}

const AgentForm: React.FC<AgentFormProps> = ({ initial, onSaved, onCancel }) => {
  const [t, setT] = useState<FormTextState>(() =>
    initial ? toTextState(initial) : { ...toTextState(emptyForm()) },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback(<K extends keyof FormTextState>(key: K, value: FormTextState[K]) => {
    setT((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** 能力预览（由当前文本态实时计算：command 非空 → CLI；chat 选中 → CHAT；promptArgs 非空 → Headless）。 */
  const preview = useMemo(
    () => ({
      cli: t.command.trim().length > 0,
      chat: t.chat !== '',
      headless: t.promptArgsText.trim().length > 0,
    }),
    [t.command, t.chat, t.promptArgsText],
  );

  /** 组装提交用的 AgentConfig。 */
  const buildConfig = useCallback((): AgentConfig => {
    const promptArgs = t.promptArgsText.trim() ? splitCsv(t.promptArgsText) : null;
    return {
      id: t.id.trim(),
      name: t.name.trim(),
      icon: t.icon || 'cli.svg',
      enabled: t.enabled,
      command: t.command.trim(),
      args: splitArgs(t.argsText),
      env: initial?.env ?? {},
      chat: t.chat || null,
      prompt_args: promptArgs,
      post_prompt_args: t.postPromptArgsText.trim() ? splitCsv(t.postPromptArgsText) : null,
      skill_path: t.skillPath.trim() || null,
      detection: t.detectionCmd.trim() ? { type: 'command', target: t.detectionCmd.trim() } : null,
      deploy: {
        skills: t.deploySkills.trim() || '{{projectPath}}/.agent/skills',
        commands: t.deployCommands.trim() || null,
        mcp_config: t.deployMcp.trim() || null,
      },
    };
  }, [t, initial]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!t.id.trim()) {
        setError('Agent ID is required (lowercase letters, numbers, hyphens)');
        return;
      }
      if (!t.name.trim()) {
        setError('Agent name is required');
        return;
      }
      if (!t.command.trim() && !t.chat) {
        setError('Requires at least one of Command (CLI) or CHAT capability');
        return;
      }
      setSaving(true);
      try {
        const agent = buildConfig();
        await addAgent(agent);
        onSaved?.(agent);
      } catch (err) {
        setError(String(err));
      } finally {
        setSaving(false);
      }
    },
    [t, buildConfig, onSaved],
  );

  const handleUploadIcon = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'ico', 'bmp'],
          },
        ],
      });
      if (!selected) return;
      const iconPath = await importAgentIcon(selected);
      set('icon', iconPath);
    } catch (err) {
      console.error('[AgentForm] Failed to upload icon:', err);
    }
  }, [set]);

  const fieldCls =
    'h-7 bg-bg-secondary border border-border rounded px-2 text-[0.82em] text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue transition-colors duration-150';
  const labelCls = 'text-[0.72em] text-text-muted font-medium';
  const groupCls = 'flex flex-col gap-1.5';
  const sectionTitle = 'text-[0.75em] font-semibold text-text-secondary uppercase tracking-wider';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* ── Header: title + capability preview ─────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[0.86em] font-semibold text-text-primary">
          {initial
            ? initial.is_builtin
              ? `Edit Built-in Agent · ${initial.id}`
              : `Edit Agent · ${initial.id}`
            : 'Create Custom Agent'}
        </div>
        <CapabilityBadges
          agent={{
            command: preview.cli ? t.command : '',
            chat: (t.chat || null) as ChatStart | null,
            prompt_args: preview.headless ? [] : null,
          }}
        />
      </div>

      {initial?.is_builtin && (
        <div className="text-[0.72em] text-text-muted bg-bg-secondary/50 border border-border/60 rounded px-2 py-1">
          Edits are saved as an override. Use Reset in the settings list to restore the factory
          default.
        </div>
      )}

      {error && (
        <div className="text-[0.78em] text-accent-red bg-accent-red/10 border border-accent-red/20 px-2 py-1 rounded">
          {error}
        </div>
      )}

      {/* ── Identity ──────────────────────────────────────────────────── */}
      <div className="border border-border rounded-lg bg-bg-primary overflow-hidden">
        <div className={cn(sectionTitle, 'px-3 pt-2 pb-1.5 bg-bg-secondary/40')}>Identity</div>
        <div className="p-3 pt-2 grid grid-cols-2 gap-2">
          <label className={groupCls}>
            <span className={labelCls}>ID *</span>
            <input
              type="text"
              value={t.id}
              disabled={Boolean(initial)}
              onChange={(e) => set('id', e.target.value.trim())}
              placeholder="my-agent"
              className={cn(fieldCls, 'font-mono', initial && 'opacity-50 cursor-not-allowed')}
            />
          </label>
          <label className={groupCls}>
            <span className={labelCls}>Name *</span>
            <input
              type="text"
              value={t.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="My Agent"
              className={fieldCls}
            />
          </label>
        </div>
        <div className="px-3 pb-3 -mt-1 flex items-center gap-2">
          <span className={labelCls}>Icon:</span>
          <div className="flex items-center gap-1 flex-wrap">
            {PRESET_AGENT_ICONS.map((iconName) => (
              <button
                key={iconName}
                type="button"
                className={cn(
                  'size-6 rounded flex items-center justify-center border transition-colors',
                  t.icon === iconName
                    ? 'border-accent-blue bg-accent-blue/10'
                    : 'border-transparent hover:bg-bg-hover',
                )}
                onClick={() => set('icon', iconName)}
                title={iconName}
              >
                <img
                  src={resolveAgentIconSrc(iconName) ?? undefined}
                  className="size-3.5 object-contain"
                  alt=""
                />
              </button>
            ))}
            <span className="text-text-muted mx-0.5 select-none">|</span>
            <button
              type="button"
              className="text-[0.75em] text-accent-blue hover:underline px-1 py-0.5"
              onClick={handleUploadIcon}
              title="Upload custom icon"
            >
              Upload
            </button>
          </div>
        </div>
      </div>

      {/* ── CLI Execution ────────────────────────────────────────────── */}
      <div className="border border-border rounded-lg bg-bg-primary overflow-hidden">
        <div className={cn(sectionTitle, 'px-3 pt-2 pb-1.5 bg-bg-secondary/40')}>CLI Execution</div>
        <div className="p-3 pt-2 grid grid-cols-2 gap-2">
          <label className={groupCls}>
            <span className={labelCls}>Command * (terminal TUI launch)</span>
            <input
              type="text"
              value={t.command}
              onChange={(e) => set('command', e.target.value)}
              placeholder="myagent"
              className={cn(fieldCls, 'font-mono')}
            />
          </label>
          <label className={groupCls}>
            <span className={labelCls}>Args (space-separated)</span>
            <input
              type="text"
              value={t.argsText}
              onChange={(e) => set('argsText', e.target.value)}
              placeholder="--flag value"
              className={cn(fieldCls, 'font-mono')}
            />
          </label>
        </div>
        <div className="px-3 pb-3 -mt-0.5">
          <span className="text-[0.7em] text-text-muted">
            Leave Command empty for no CLI capability (e.g. in-process CHAT-only agents).
          </span>
        </div>
      </div>

      {/* ── Capabilities: CHAT + Headless ────────────────────────────── */}
      <div className="border border-border rounded-lg bg-bg-primary overflow-hidden">
        <div className={cn(sectionTitle, 'px-3 pt-2 pb-1.5 bg-bg-secondary/40')}>Capabilities</div>
        <div className="p-3 pt-2 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className={groupCls}>
              <span className={labelCls}>CHAT Transport</span>
              <select
                value={t.chat}
                onChange={(e) => set('chat', e.target.value as ChatStart | '')}
                className={cn(fieldCls, 'bg-bg-secondary')}
              >
                <option value="">None (—)</option>
                {CHAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {t.chat === 'acp' ? (
              <div className="flex items-end pb-1.5">
                <span className="text-[0.7em] text-text-muted leading-snug">
                  ACP launches a{' '}
                  <span className="font-mono text-text-secondary">command + args</span> JSON-RPC
                  subprocess (e.g. opencode needs the <span className="font-mono">acp</span>{' '}
                  subcommand)
                </span>
              </div>
            ) : (
              <div className="hidden" />
            )}
          </div>
          {t.chat && (
            <div className="text-[0.7em] text-text-muted -mt-1">
              {CHAT_HINTS[t.chat as ChatStart]}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className={groupCls}>
              <span className={labelCls}>Prompt Args (Headless · comma-separated)</span>
              <input
                type="text"
                value={t.promptArgsText}
                onChange={(e) => set('promptArgsText', e.target.value)}
                placeholder="-p, --bare"
                className={cn(fieldCls, 'font-mono')}
              />
            </label>
            <label className={groupCls}>
              <span className={labelCls}>Post Prompt Args (comma-separated)</span>
              <input
                type="text"
                value={t.postPromptArgsText}
                onChange={(e) => set('postPromptArgsText', e.target.value)}
                placeholder="--dangerously-skip-permissions"
                className={cn(fieldCls, 'font-mono')}
              />
            </label>
          </div>
        </div>
      </div>

      {/* ── Deploy ───────────────────────────────────────────────────── */}
      <div className="border border-border rounded-lg bg-bg-primary overflow-hidden">
        <div className={cn(sectionTitle, 'px-3 pt-2 pb-1.5 bg-bg-secondary/40')}>Deploy</div>
        <div className="p-3 pt-2 flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <label className={groupCls}>
              <span className={labelCls}>
                Skills Template (supports {'{{'}projectPath{'}}'})
              </span>
              <input
                type="text"
                value={t.deploySkills}
                onChange={(e) => set('deploySkills', e.target.value)}
                className={cn(fieldCls, 'font-mono')}
              />
            </label>
            <label className={groupCls}>
              <span className={labelCls}>Commands Template (optional)</span>
              <input
                type="text"
                value={t.deployCommands}
                onChange={(e) => set('deployCommands', e.target.value)}
                placeholder="None (command deploy unsupported)"
                className={cn(fieldCls, 'font-mono')}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className={groupCls}>
              <span className={labelCls}>MCP Config Template (optional)</span>
              <input
                type="text"
                value={t.deployMcp}
                onChange={(e) => set('deployMcp', e.target.value)}
                placeholder="None (MCP deploy unsupported)"
                className={cn(fieldCls, 'font-mono')}
              />
            </label>
            <label className={groupCls}>
              <span className={labelCls}>Global Skill Path (optional override)</span>
              <input
                type="text"
                value={t.skillPath}
                onChange={(e) => set('skillPath', e.target.value)}
                placeholder="~/.my-agent/skills"
                className={cn(fieldCls, 'font-mono')}
              />
            </label>
          </div>
          <label className={groupCls}>
            <span className={labelCls}>
              Install detection command (optional · considered installed if found in PATH)
            </span>
            <input
              type="text"
              value={t.detectionCmd}
              onChange={(e) => set('detectionCmd', e.target.value)}
              placeholder="myagent (empty = always considered installed)"
              className={cn(fieldCls, 'font-mono')}
            />
          </label>
        </div>
      </div>

      {/* ── Footer: enabled + actions ────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[0.82em] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={t.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
            className="accent-accent-blue size-3.5"
          />
          Enabled
        </label>
        <div className="flex gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="text-[0.82em]"
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={saving}
            className="text-[0.82em]"
          >
            {saving ? 'Saving…' : initial ? 'Save Agent' : 'Create Agent'}
          </Button>
        </div>
      </div>
    </form>
  );
};

export default React.memo(AgentForm);
