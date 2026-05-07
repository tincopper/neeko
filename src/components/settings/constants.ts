import React from "react";
import type { AgentConfig } from "../../types";
import {
  AppearanceIcon,
  CodeIcon,
  EditorIcon,
  GitLogoIcon,
  GridIcon,
  KeyboardIcon,
  TerminalIcon,
} from "../icons";

export type NavCategory =
  | "editor"
  | "terminal"
  | "agents"
  | "ide"
  | "git"
  | "shortcuts"
  | "appearance";

export interface NavItem {
  id: NavCategory;
  label: string;
  icon: React.ReactNode;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: "appearance",
    label: "Appearance",
    icon: React.createElement(AppearanceIcon, { size: 16 }),
  },
  {
    id: "editor",
    label: "Editor",
    icon: React.createElement(EditorIcon, { size: 16 }),
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: React.createElement(TerminalIcon, { size: 16 }),
  },
  {
    id: "agents",
    label: "Agents",
    icon: React.createElement(GridIcon, { size: 16 }),
  },
  {
    id: "ide",
    label: "IDE",
    icon: React.createElement(CodeIcon, { size: 16 }),
  },
  {
    id: "git",
    label: "Git",
    icon: React.createElement(GitLogoIcon, { size: 16 }),
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: React.createElement(KeyboardIcon, { size: 16 }),
  },
];

// Built-in monospace font presets
export const BUILTIN_FONTS = [
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Source Code Pro",
  "Consolas",
  "Monaco",
  "Menlo",
  "DejaVu Sans Mono",
  "Courier New",
];

// Platform-specific preset shells
export const PRESET_SHELLS: { label: string; value: string }[] =
  navigator.platform.toLowerCase().includes("win")
    ? [
        { label: "PowerShell", value: "powershell.exe" },
        { label: "Command Prompt", value: "cmd.exe" },
        { label: "Git Bash", value: "C:\\Program Files\\Git\\bin\\bash.exe" },
        { label: "WSL (bash)", value: "wsl.exe" },
      ]
    : [
        { label: "Default ($SHELL)", value: "" },
        { label: "bash", value: "/bin/bash" },
        { label: "zsh", value: "/bin/zsh" },
        { label: "fish", value: "/usr/bin/fish" },
        { label: "sh", value: "/bin/sh" },
      ];

export const BUILTIN_AGENTS: Array<
  AgentConfig & { defaultSkillPath: string | null }
> = [
  {
    id: "opencode",
    name: "opencode",
    command: "opencode",
    args: [],
    env: {},
    icon: "opencode.png",
    enabled: true,
    defaultSkillPath: "~/.agents/skills",
  },
  {
    id: "claude-code",
    name: "claude-code",
    command: "claude",
    args: [],
    env: {},
    icon: "claude-code.png",
    enabled: true,
    defaultSkillPath: "~/.claude/skills",
  },
  {
    id: "gemini",
    name: "gemini",
    command: "gemini",
    args: [],
    env: {},
    icon: "gemini.png",
    enabled: true,
    defaultSkillPath: "~/.gemini/skills",
  },
  {
    id: "codex",
    name: "codex",
    command: "codex",
    args: [],
    env: {},
    icon: "codex.png",
    enabled: true,
    defaultSkillPath: "~/.codex/skills",
  },
  {
    id: "qoder",
    name: "qoder",
    command: "qoder",
    args: [],
    env: {},
    icon: "qoder.svg",
    enabled: true,
    defaultSkillPath: "~/.qoder/skills",
  },
  {
    id: "codebuddy",
    name: "codebuddy",
    command: "codebuddy",
    args: [],
    env: {},
    icon: "codebuddy.svg",
    enabled: true,
    defaultSkillPath: "~/.codebuddy/skills",
  },
];
