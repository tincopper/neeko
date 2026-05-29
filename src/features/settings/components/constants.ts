import React from "react";
import {
  AppearanceIcon,
  CodeIcon,
  EditorIcon,
  GitLogoIcon,
  GridIcon,
  KeyboardIcon,
  TerminalIcon,
} from "@/shared/components/icons";

export type NavCategory =
  | "editor"
  | "terminal"
  | "agents"
  | "ide"
  | "git"
  | "shortcuts"
  | "appearance";

export type SettingsNavId = NavCategory | `project:${string}`;

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

