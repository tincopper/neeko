/**
 * AgentPlugin — a complete contract describing an Agent provider.
 *
 * It answers 5 questions:
 * 1. How to execute?      → execution (command, args, env, detection)
 * 2. How to configure?    → configuration (schema + defaults + secrets)
 * 3. What extensions?     → capabilities (mcp, commands, hooks, skills, plugins)
 * 4. Where are resources? → paths (templated paths with variables)
 * 5. Lifecycle hooks?     → lifecycle (onProjectActivate, onSessionStart)
 */

// ─── Execution ──────────────────────────────────────────────────────────────

/** How an Agent CLI is launched and detected. */
export interface AgentExecution {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** prompt 前置参数，如 ["--bare", "-p"]。None 表示不支持 prompt 直接模式。 */
  promptArgs?: string[] | null;
  /** prompt 后置参数，追加在 prompt 之后。 */
  postPromptArgs?: string[] | null;
  /** How to detect whether this Agent is installed. */
  detection?: AgentDetection;
}

/** Installation detection strategy. */
export interface AgentDetection {
  /** Detection method. */
  type: 'command' | 'directory' | 'file';
  /** Target to check (command name or path template). */
  target: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration contract for an Agent provider. */
export interface AgentConfiguration {
  /** JSON Schema for validating Agent configuration. */
  schema: JsonSchema;
  /** Default configuration values. */
  defaults: Record<string, unknown>;
  /** Secrets the user must provide (e.g. API keys). */
  secrets?: SecretDefinition[];
}

/** JSON Schema subset (sufficient for validation + UI generation). */
export interface JsonSchema {
  type?: 'object' | 'string' | 'number' | 'boolean' | 'array';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  description?: string;
}

/** A single property in a JSON Schema. */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  default?: unknown;
  enum?: (string | number | boolean)[];
  /** For string-type secrets (password masking in UI). */
  format?: 'password' | 'path' | 'url';
}

/** A secret the user must provide to use this Agent. */
export interface SecretDefinition {
  key: string;
  label: string;
  description?: string;
  type: 'string' | 'password' | 'path' | 'url';
  required: boolean;
}

// ─── Capabilities ───────────────────────────────────────────────────────────

/** Declares what resource types this Agent supports. */
export interface AgentCapabilities {
  mcp?: { supported: boolean; transports?: ('stdio' | 'sse')[] };
  commands?: { supported: boolean; format?: 'markdown' | 'json' };
  hooks?: { supported: boolean; events?: HookEvent[] };
  skills?: { supported: boolean; format?: 'skill.md' };
  plugins?: { supported: boolean };
}

/** Lifecycle events an Agent can hook into. */
export type HookEvent = 'pre-send' | 'post-receive' | 'session-start' | 'session-end' | 'on-error';

// ─── Resource Paths ─────────────────────────────────────────────────────────

/** Templated paths to various resource locations. */
export interface AgentResourcePaths {
  /** Agent's own configuration file. */
  config: PathTemplate;
  /** Skills directory. */
  skills: PathTemplate;
  /** Commands directory. */
  commands: PathTemplate;
  /** MCP configuration file. */
  mcp: PathTemplate;
  /** Hooks directory. */
  hooks: PathTemplate;
  /** Plugins directory. */
  plugins: PathTemplate;
  /** Secrets file (optional). */
  secrets?: PathTemplate;
}

/**
 * A path template supporting variable interpolation.
 *
 * Variables: `{{home}}`, `{{projectPath}}`, `{{agentId}}`, `{{configDir}}`
 */
export interface PathTemplate {
  /** Relative path (supports {{home}}, {{projectPath}}, etc.). */
  relative: string;
  /** File format / content type. */
  format: 'json' | 'toml' | 'yaml' | 'markdown' | 'script' | 'directory';
  /** Human-readable description. */
  description?: string;
  /** Whether this path supports project-level override. */
  projectLevel?: boolean;
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

/** Lifecycle hooks for intervening in Agent execution. */
export interface AgentLifecycle {
  /** Script to run when a project is activated. */
  onProjectActivate?: string;
  /** Script to run when a session starts. */
  onSessionStart?: string;
}

// ─── AgentPlugin (root) ─────────────────────────────────────────────────────

/** A complete contract describing an Agent provider. */
export interface AgentPlugin {
  id: string;
  name: string;
  icon: string | null;
  description?: string;
  version: string;
  isBuiltin: boolean;
  enabled: boolean;

  /** Execution contract. */
  execution: AgentExecution;
  /** Configuration contract. */
  configuration: AgentConfiguration;
  /** Capability declarations. */
  capabilities: AgentCapabilities;
  /** Resource path templates. */
  paths: AgentResourcePaths;
  /** Lifecycle hooks (optional). */
  lifecycle?: AgentLifecycle;
}

// ─── DTOs ──────────────────────────────────────────────────────────────────

/** Resolved path for a specific resource type and project. */
export interface ResolvedPath {
  /** Resource type key (e.g. "skills", "config"). */
  resourceType: string;
  /** Resolved absolute path. */
  absolutePath: string;
  /** Whether the path currently exists on disk. */
  exists: boolean;
  /** Scope of the path. */
  scope: 'global' | 'project';
}

/** Result of detecting installed Agents. */
export interface AgentDetectionResult {
  pluginId: string;
  installed: boolean;
  /** Resolved detection target path (when applicable). */
  resolvedTarget?: string;
}
