/**
 * Built-in Agent plugin definitions.
 *
 * Each plugin is a complete contract describing how Neeko interacts with
 * a specific Agent provider (Claude Code, Cursor, Codex, etc.).
 *
 * Paths use template variables: {{home}}, {{projectPath}}, {{agentId}}, {{configDir}}
 */

import type { AgentPlugin } from '@/shared/types/agentPlugin';

export const BUILT_IN_AGENT_PLUGINS: AgentPlugin[] = [
  // ── Claude Code ───────────────────────────────────────────────────────────
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: 'claude-code.png',
    description: 'Anthropic Claude Code CLI agent',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'claude',
      args: [],
      env: {},
      promptArgs: ['--bare', '-p'],
      postPromptArgs: ['--dangerously-skip-permissions'],
      detection: { type: 'command', target: 'claude' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'Model to use',
            default: 'sonnet',
            enum: ['sonnet', 'opus', 'haiku'],
          },
        },
      },
      defaults: { model: 'sonnet' },
      secrets: [
        {
          key: 'ANTHROPIC_API_KEY',
          label: 'Anthropic API Key',
          description: 'Your Anthropic API key',
          type: 'password',
          required: true,
        },
      ],
    },
    capabilities: {
      mcp: { supported: true, transports: ['stdio', 'sse'] },
      commands: { supported: true, format: 'markdown' },
      hooks: {
        supported: true,
        events: ['pre-send', 'post-receive', 'session-start', 'on-error'],
      },
      skills: { supported: true, format: 'skill.md' },
      plugins: { supported: true },
    },
    paths: {
      config: {
        relative: '{{home}}/.claude/settings.json',
        format: 'json',
        description: 'Global Claude Code settings',
      },
      skills: {
        relative: '{{projectPath}}/.claude/skills',
        format: 'directory',
        projectLevel: true,
        description: 'Project-level skills directory',
      },
      commands: {
        relative: '{{projectPath}}/.claude/commands',
        format: 'markdown',
        projectLevel: true,
        description: 'Project-level slash commands',
      },
      mcp: {
        relative: '{{home}}/.claude/settings.json',
        format: 'json',
        description: 'MCP server configuration',
      },
      hooks: {
        relative: '{{projectPath}}/.claude/hooks',
        format: 'script',
        projectLevel: true,
        description: 'Lifecycle hook scripts',
      },
      plugins: {
        relative: '{{projectPath}}/.claude/plugins',
        format: 'directory',
        projectLevel: true,
        description: 'Plugin directory',
      },
    },
    lifecycle: {
      onSessionStart: '{{home}}/.claude/hooks/session-start',
    },
  },

  // ── Cursor ────────────────────────────────────────────────────────────────
  {
    id: 'cursor',
    name: 'Cursor',
    icon: 'cursor.svg',
    description: 'Cursor IDE with AI-powered coding assistance',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'cursor',
      args: [],
      env: {},
      detection: { type: 'directory', target: '{{projectPath}}/.cursor' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {},
      },
      defaults: {},
    },
    capabilities: {
      mcp: { supported: true, transports: ['stdio'] },
      commands: { supported: true, format: 'markdown' },
      skills: { supported: true, format: 'skill.md' },
    },
    paths: {
      config: {
        relative: '{{projectPath}}/.cursor/settings.json',
        format: 'json',
        projectLevel: true,
        description: 'Project-level Cursor settings',
      },
      skills: {
        relative: '{{projectPath}}/.cursor/skills',
        format: 'directory',
        projectLevel: true,
        description: 'Project-level skills',
      },
      commands: {
        relative: '{{projectPath}}/.cursor/commands',
        format: 'markdown',
        projectLevel: true,
        description: 'Project-level commands',
      },
      mcp: {
        relative: '{{projectPath}}/.cursor/settings.json',
        format: 'json',
        projectLevel: true,
        description: 'MCP configuration',
      },
      hooks: {
        relative: '{{projectPath}}/.cursor/hooks',
        format: 'script',
        projectLevel: true,
        description: 'Hook scripts',
      },
      plugins: {
        relative: '{{projectPath}}/.cursor/extensions',
        format: 'directory',
        projectLevel: true,
        description: 'Extension directory',
      },
    },
  },

  // ── Codex ─────────────────────────────────────────────────────────────────
  {
    id: 'codex',
    name: 'Codex',
    icon: 'codex.png',
    description: 'OpenAI Codex CLI agent',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'codex',
      args: [],
      env: {},
      promptArgs: [],
      detection: { type: 'command', target: 'codex' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            description: 'Model to use',
            default: 'o4-mini',
          },
        },
      },
      defaults: { model: 'o4-mini' },
      secrets: [
        {
          key: 'OPENAI_API_KEY',
          label: 'OpenAI API Key',
          description: 'Your OpenAI API key',
          type: 'password',
          required: true,
        },
      ],
    },
    capabilities: {
      skills: { supported: true, format: 'skill.md' },
    },
    paths: {
      config: {
        relative: '{{home}}/.codex/config.toml',
        format: 'toml',
        description: 'Codex configuration',
      },
      skills: {
        relative: '{{projectPath}}/.codex/skills',
        format: 'directory',
        projectLevel: true,
        description: 'Project-level skills',
      },
      commands: {
        relative: '{{projectPath}}/.codex/commands',
        format: 'markdown',
        projectLevel: true,
      },
      mcp: {
        relative: '{{home}}/.codex/config.toml',
        format: 'toml',
      },
      hooks: {
        relative: '{{projectPath}}/.codex/hooks',
        format: 'script',
        projectLevel: true,
      },
      plugins: {
        relative: '{{projectPath}}/.codex/plugins',
        format: 'directory',
        projectLevel: true,
      },
    },
  },

  // ── Gemini ────────────────────────────────────────────────────────────────
  {
    id: 'gemini',
    name: 'Gemini',
    icon: 'gemini.png',
    description: 'Google Gemini CLI agent',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'gemini',
      args: [],
      env: {},
      promptArgs: ['--prompt'],
      detection: { type: 'command', target: 'gemini' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {},
      },
      defaults: {},
      secrets: [
        {
          key: 'GEMINI_API_KEY',
          label: 'Gemini API Key',
          description: 'Your Google Gemini API key',
          type: 'password',
          required: true,
        },
      ],
    },
    capabilities: {
      skills: { supported: true, format: 'skill.md' },
    },
    paths: {
      config: {
        relative: '{{home}}/.gemini/settings.json',
        format: 'json',
        description: 'Gemini settings',
      },
      skills: {
        relative: '{{projectPath}}/.gemini/skills',
        format: 'directory',
        projectLevel: true,
      },
      commands: {
        relative: '{{projectPath}}/.gemini/commands',
        format: 'markdown',
        projectLevel: true,
      },
      mcp: {
        relative: '{{home}}/.gemini/settings.json',
        format: 'json',
      },
      hooks: {
        relative: '{{projectPath}}/.gemini/hooks',
        format: 'script',
        projectLevel: true,
      },
      plugins: {
        relative: '{{projectPath}}/.gemini/plugins',
        format: 'directory',
        projectLevel: true,
      },
    },
  },

  // ── Qoder ─────────────────────────────────────────────────────────────────
  {
    id: 'qoder',
    name: 'Qoder',
    icon: 'qoder.svg',
    description: 'Qoder CLI agent',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'qodercli',
      args: [],
      env: {},
      promptArgs: ['--prompt'],
      detection: { type: 'command', target: 'qodercli' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {},
      },
      defaults: {},
    },
    capabilities: {
      skills: { supported: true, format: 'skill.md' },
    },
    paths: {
      config: {
        relative: '{{home}}/.qoder/config.json',
        format: 'json',
      },
      skills: {
        relative: '{{projectPath}}/.qoder/skills',
        format: 'directory',
        projectLevel: true,
      },
      commands: {
        relative: '{{projectPath}}/.qoder/commands',
        format: 'markdown',
        projectLevel: true,
      },
      mcp: {
        relative: '{{home}}/.qoder/config.json',
        format: 'json',
      },
      hooks: {
        relative: '{{projectPath}}/.qoder/hooks',
        format: 'script',
        projectLevel: true,
      },
      plugins: {
        relative: '{{projectPath}}/.qoder/plugins',
        format: 'directory',
        projectLevel: true,
      },
    },
  },

  // ── CodeBuddy ─────────────────────────────────────────────────────────────
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    icon: 'codebuddy.svg',
    description: 'CodeBuddy CLI agent',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'codebuddy',
      args: [],
      env: {},
      promptArgs: ['--prompt'],
      detection: { type: 'command', target: 'codebuddy' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {},
      },
      defaults: {},
    },
    capabilities: {
      skills: { supported: true, format: 'skill.md' },
    },
    paths: {
      config: {
        relative: '{{home}}/.codebuddy/config.json',
        format: 'json',
      },
      skills: {
        relative: '{{projectPath}}/.codebuddy/skills',
        format: 'directory',
        projectLevel: true,
      },
      commands: {
        relative: '{{projectPath}}/.codebuddy/commands',
        format: 'markdown',
        projectLevel: true,
      },
      mcp: {
        relative: '{{home}}/.codebuddy/config.json',
        format: 'json',
      },
      hooks: {
        relative: '{{projectPath}}/.codebuddy/hooks',
        format: 'script',
        projectLevel: true,
      },
      plugins: {
        relative: '{{projectPath}}/.codebuddy/plugins',
        format: 'directory',
        projectLevel: true,
      },
    },
  },

  // ── OpenCode ──────────────────────────────────────────────────────────────
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: 'opencode.png',
    description: 'OpenCode CLI agent',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'opencode',
      args: ['run', '--pure', '--dangerously-skip-permissions=true', '-f'],
      env: {},
      promptArgs: ['run', '--pure', '--dangerously-skip-permissions=true', '-f'],
      detection: { type: 'command', target: 'opencode' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {},
      },
      defaults: {},
    },
    capabilities: {
      skills: { supported: true, format: 'skill.md' },
    },
    paths: {
      config: {
        relative: '{{home}}/.config/opencode/config.json',
        format: 'json',
      },
      skills: {
        relative: '{{projectPath}}/.opencode/skills',
        format: 'directory',
        projectLevel: true,
      },
      commands: {
        relative: '{{projectPath}}/.opencode/commands',
        format: 'markdown',
        projectLevel: true,
      },
      mcp: {
        relative: '{{home}}/.config/opencode/config.json',
        format: 'json',
      },
      hooks: {
        relative: '{{projectPath}}/.opencode/hooks',
        format: 'script',
        projectLevel: true,
      },
      plugins: {
        relative: '{{projectPath}}/.opencode/plugins',
        format: 'directory',
        projectLevel: true,
      },
    },
  },

  // ── OMP ───────────────────────────────────────────────────────────────────
  {
    id: 'omp',
    name: 'OMP',
    icon: 'omp.svg',
    description: 'OMP CLI agent',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'omp',
      args: [],
      env: {},
      promptArgs: ['-p'],
      detection: { type: 'command', target: 'omp' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {},
      },
      defaults: {},
    },
    capabilities: {
      skills: { supported: true, format: 'skill.md' },
    },
    paths: {
      config: {
        relative: '{{home}}/.omp/config.json',
        format: 'json',
      },
      skills: {
        relative: '{{projectPath}}/.omp/skills',
        format: 'directory',
        projectLevel: true,
      },
      commands: {
        relative: '{{projectPath}}/.omp/commands',
        format: 'markdown',
        projectLevel: true,
      },
      mcp: {
        relative: '{{home}}/.omp/config.json',
        format: 'json',
      },
      hooks: {
        relative: '{{projectPath}}/.omp/hooks',
        format: 'script',
        projectLevel: true,
      },
      plugins: {
        relative: '{{projectPath}}/.omp/plugins',
        format: 'directory',
        projectLevel: true,
      },
    },
  },

  // ── Pi ───────────────────────────────────────────────────────────────────
  {
    id: 'pi',
    name: 'Pi',
    icon: 'pi.svg',
    description: 'Pi CLI agent',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'pi',
      args: [],
      env: {},
      promptArgs: ['-p'],
      detection: { type: 'command', target: 'pi' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {},
      },
      defaults: {},
    },
    capabilities: {
      skills: { supported: true, format: 'skill.md' },
    },
    paths: {
      config: {
        relative: '{{home}}/.pi/config.json',
        format: 'json',
      },
      skills: {
        relative: '{{projectPath}}/.pi/skills',
        format: 'directory',
        projectLevel: true,
      },
      commands: {
        relative: '{{projectPath}}/.pi/commands',
        format: 'markdown',
        projectLevel: true,
      },
      mcp: {
        relative: '{{home}}/.pi/config.json',
        format: 'json',
      },
      hooks: {
        relative: '{{projectPath}}/.pi/hooks',
        format: 'script',
        projectLevel: true,
      },
      plugins: {
        relative: '{{projectPath}}/.pi/plugins',
        format: 'directory',
        projectLevel: true,
      },
    },
  },

  // ── Reasonix ──────────────────────────────────────────────────────────────
  {
    id: 'reasonix',
    name: 'Reasonix',
    icon: 'reasonix.svg',
    description: 'Reasonix CLI agent',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'reasonix',
      args: ['run', '--yolo'],
      env: {},
      promptArgs: ['run', '--yolo'],
      detection: { type: 'command', target: 'reasonix' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {},
      },
      defaults: {},
    },
    capabilities: {
      skills: { supported: true, format: 'skill.md' },
    },
    paths: {
      config: {
        relative: '{{home}}/.reasonix/config.json',
        format: 'json',
      },
      skills: {
        relative: '{{projectPath}}/.reasonix/skills',
        format: 'directory',
        projectLevel: true,
      },
      commands: {
        relative: '{{projectPath}}/.reasonix/commands',
        format: 'markdown',
        projectLevel: true,
      },
      mcp: {
        relative: '{{home}}/.reasonix/config.json',
        format: 'json',
      },
      hooks: {
        relative: '{{projectPath}}/.reasonix/hooks',
        format: 'script',
        projectLevel: true,
      },
      plugins: {
        relative: '{{projectPath}}/.reasonix/plugins',
        format: 'directory',
        projectLevel: true,
      },
    },
  },

  // ── Grok ─────────────────────────────────────────────────────────────────
  {
    id: 'grok',
    name: 'Grok',
    icon: 'grok.ico',
    description: 'Grok CLI agent (xAI)',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'grok',
      args: [],
      env: {},
      promptArgs: ['-p'],
      detection: { type: 'command', target: 'grok' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {},
      },
      defaults: {},
      secrets: [
        {
          key: 'XAI_API_KEY',
          label: 'xAI API Key',
          description: 'Your xAI API key',
          type: 'password',
          required: true,
        },
      ],
    },
    capabilities: {
      skills: { supported: true, format: 'skill.md' },
    },
    paths: {
      config: {
        relative: '{{home}}/.grok/config.json',
        format: 'json',
      },
      skills: {
        relative: '{{projectPath}}/.grok/skills',
        format: 'directory',
        projectLevel: true,
      },
      commands: {
        relative: '{{projectPath}}/.grok/commands',
        format: 'markdown',
        projectLevel: true,
      },
      mcp: {
        relative: '{{home}}/.grok/config.json',
        format: 'json',
      },
      hooks: {
        relative: '{{projectPath}}/.grok/hooks',
        format: 'script',
        projectLevel: true,
      },
      plugins: {
        relative: '{{projectPath}}/.grok/plugins',
        format: 'directory',
        projectLevel: true,
      },
    },
  },

  // ── Windsurf ──────────────────────────────────────────────────────────────
  {
    id: 'windsurf',
    name: 'Windsurf',
    icon: 'windsurf.svg',
    description: 'Windsurf IDE (Codeium)',
    version: '1.0',
    isBuiltin: true,
    enabled: true,
    execution: {
      command: 'windsurf',
      args: [],
      env: {},
      detection: { type: 'directory', target: '{{projectPath}}/.codeium/windsurf' },
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {},
      },
      defaults: {},
    },
    capabilities: {
      mcp: { supported: true, transports: ['stdio'] },
      skills: { supported: true, format: 'skill.md' },
    },
    paths: {
      config: {
        relative: '{{projectPath}}/.codeium/windsurf/settings.json',
        format: 'json',
        projectLevel: true,
      },
      skills: {
        relative: '{{projectPath}}/.codeium/windsurf/skills',
        format: 'directory',
        projectLevel: true,
      },
      commands: {
        relative: '{{projectPath}}/.codeium/windsurf/commands',
        format: 'markdown',
        projectLevel: true,
      },
      mcp: {
        relative: '{{projectPath}}/.codeium/windsurf/settings.json',
        format: 'json',
        projectLevel: true,
      },
      hooks: {
        relative: '{{projectPath}}/.codeium/windsurf/hooks',
        format: 'script',
        projectLevel: true,
      },
      plugins: {
        relative: '{{projectPath}}/.codeium/windsurf/extensions',
        format: 'directory',
        projectLevel: true,
      },
    },
  },
];

/** Map of built-in plugin ID → definition for quick lookup. */
export const BUILT_IN_PLUGIN_MAP: Record<string, AgentPlugin> = Object.fromEntries(
  BUILT_IN_AGENT_PLUGINS.map((p) => [p.id, p]),
);
