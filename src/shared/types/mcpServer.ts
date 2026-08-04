/**
 * MCP (Model Context Protocol) server resource type.
 *
 * MCP servers are launched by agents as child processes (stdio) or connected
 * to over HTTP (sse). Neeko manages their definitions in a central library and
 * deploys them to agent-specific configuration files via AgentPlugin paths.
 */

/** MCP server resource. */
export interface McpServer {
  /** Unique identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Optional description. */
  description?: string | null;
  /** Executable command to launch the MCP server. */
  command: string;
  /** Remote endpoint URL (http/sse transports). */
  url?: string | null;
  /** Command-line arguments. */
  args: unknown[];
  /** Environment variables. */
  env: Record<string, string>;
  /** Transport type: "stdio", "sse", or "http". */
  transport: 'stdio' | 'sse' | 'http';
  /** Scope: "global" or "project". */
  scope: 'global' | 'project';
  /** Project id when scope = "project". */
  projectId?: string | null;
  /** MCP Registry source (present when installed from the marketplace). */
  sourceRegistry?: string | null;
  /** Registry-unique name (matches the marketplace entry for "installed" marking). */
  sourceRef?: string | null;
  /** Tag names. */
  tags: string[];
  /** Whether enabled. */
  enabled: boolean;
  /** Usage counter. */
  usageCount: number;
  /** Timestamp of last use. */
  lastUsedAt?: number | null;
  /** Creation timestamp. */
  createdAt: number;
  /** Last update timestamp. */
  updatedAt: number;
}

/** Input for creating / updating an MCP server. */
export type McpServerInput = Omit<
  McpServer,
  'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'lastUsedAt' | 'enabled'
>;

/** Agent capabilities for MCP and Commands. */
export interface AgentCapabilities {
  /** Agent identifier. */
  agentId: string;
  /** Human-readable agent name. */
  agentName: string;
  /** Whether this agent supports MCP. */
  supportsMcp: boolean;
  /** Whether this agent supports slash commands. */
  supportsCommands: boolean;
  /** Supported MCP transports (e.g. ["stdio", "sse"]). */
  mcpTransports: string[];
  /** Commands format (e.g. "markdown"). */
  commandsFormat?: string | null;
  /** MCP config path template. */
  mcpPath: string;
  /** Commands directory path template. */
  commandsPath: string;
}

/** Result of an MCP connection test. */
export interface McpTestResult {
  /** Whether the command was found in PATH. */
  commandFound: boolean;
  /** The command that was checked. */
  command: string;
  /** Human-readable message. */
  message: string;
}

/** MCP tag group (analogous to Skill tag groups). */
export interface McpTagGroup {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  sortOrder: number;
  serverCount: number;
}

/** Input for creating/updating an MCP tag group. */
export interface McpTagGroupInput {
  name: string;
  description?: string | null;
  icon?: string | null;
}

/** MCP server deployment target. */
export interface McpServerTarget {
  id: string;
  serverId: string;
  agentId: string;
  targetPath: string;
  status: string;
  deployedAt?: number | null;
  lastError?: string | null;
}

/** A resource resolved from a slash command (prompt or command). */
export interface SlashResource {
  /** Resource kind: "prompt" or "command". */
  kind: 'prompt' | 'command';
  /** Resource ID. */
  id: string;
  /** Display name. */
  name: string;
  /** Resolved content. */
  content: string;
  /** Slash trigger. */
  slash?: string | null;
}
