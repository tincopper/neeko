import { IS_MACOS } from "./platform";

export interface ParsedBinding {
  code: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface MatchResult {
  matched: boolean;
  digit?: number;
}

export interface ConflictEntry {
  binding: string;
  actions: string[];
}

/** Settings UI + routing domain. */
export type ShortcutCategory =
  | "tabs"
  | "editor"
  | "workspace"
  | "terminal"
  | "dock";

export interface ShortcutAction {
  id: string;
  label: string;
  /** Default chord (Win/Linux). On macOS, "Ctrl" in bindings matches ⌘ via matchesBinding. */
  defaultBinding: string;
  category: ShortcutCategory;
  /**
   * When false, settings UI only shows the binding (e.g. digit-range patterns).
   * Default true.
   */
  recordable?: boolean;
  /**
   * When true, fires even if focus is in input/textarea (rare).
   * Default false — most shortcuts are blocked while typing.
   */
  allowInEditable?: boolean;
}

export const SHORTCUT_CATEGORIES: { id: ShortcutCategory; label: string }[] = [
  { id: "tabs", label: "Tabs & Navigation" },
  { id: "editor", label: "Editor" },
  { id: "workspace", label: "Workspace" },
  { id: "terminal", label: "Terminal" },
  { id: "dock", label: "Panels" },
];

/**
 * Single source of truth for app shortcuts.
 * User overrides live in `AppConfig.shortcuts[actionId]`.
 * Never hardcode the same chord outside this registry + resolveBindings().
 */
export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  // ── Tabs ──────────────────────────────────────────────────────────────
  {
    id: "closeTab",
    label: "Close Tab",
    defaultBinding: "Ctrl+W",
    category: "tabs",
  },
  {
    id: "prevTab",
    label: "Previous Tab",
    defaultBinding: "Alt+Left",
    category: "tabs",
  },
  {
    id: "nextTab",
    label: "Next Tab",
    defaultBinding: "Alt+Right",
    category: "tabs",
  },
  {
    id: "switchTabNext",
    label: "Next Tab (Ctrl+Tab)",
    defaultBinding: "Ctrl+Tab",
    category: "tabs",
  },
  {
    id: "switchTabPrev",
    label: "Previous Tab (Ctrl+Shift+Tab)",
    defaultBinding: "Ctrl+Shift+Tab",
    category: "tabs",
  },

  // ── Editor ────────────────────────────────────────────────────────────
  {
    id: "saveFile",
    label: "Save File",
    defaultBinding: "Ctrl+S",
    category: "editor",
    allowInEditable: true,
  },
  {
    id: "gotoDefinition",
    label: "Go to Definition",
    defaultBinding: "F12",
    category: "editor",
    allowInEditable: true,
  },
  {
    id: "findReferences",
    label: "Find References",
    defaultBinding: "Shift+F12",
    category: "editor",
    allowInEditable: true,
  },

  // ── Workspace ─────────────────────────────────────────────────────────
  {
    id: "cycleWorktree",
    label: "Cycle Worktree",
    defaultBinding: "Ctrl+N",
    category: "workspace",
  },
  {
    id: "openIde",
    label: "Open in IDE",
    defaultBinding: "Ctrl+O",
    category: "workspace",
  },
  {
    id: "cycleProject",
    label: "Next Project",
    defaultBinding: "Ctrl+Q",
    category: "workspace",
  },
  {
    id: "switchProject",
    label: "Jump to Project 1–9",
    defaultBinding: "Ctrl+[1-9]",
    category: "workspace",
    recordable: false,
  },

  // ── Terminal ──────────────────────────────────────────────────────────
  {
    id: "refreshTerminal",
    label: "Refresh Terminal",
    defaultBinding: "Ctrl+Alt+R",
    category: "terminal",
  },

  // ── Dock (defaults avoid Ctrl+1..9 project jump) ──────────────────────
  {
    id: "toggleDockProjects",
    label: "Toggle Projects Panel",
    defaultBinding: "Ctrl+Shift+1",
    category: "dock",
  },
  {
    id: "toggleDockSkills",
    label: "Toggle Skills Panel",
    defaultBinding: "Ctrl+Shift+2",
    category: "dock",
  },
];

const ACTION_BY_ID = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a]));

export function getShortcutAction(id: string): ShortcutAction | undefined {
  return ACTION_BY_ID.get(id);
}

const MODIFIER_MAP: Record<string, keyof Omit<ParsedBinding, "code">> = {
  Ctrl: "ctrl",
  Control: "ctrl",
  Alt: "alt",
  Shift: "shift",
  Meta: "meta",
  Cmd: "meta",
};

const CODE_TO_CHAR: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "Space",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  CapsLock: "CapsLock",
  NumLock: "NumLock",
  ScrollLock: "ScrollLock",
};

function codeToLabel(code: string): string {
  if (code in CODE_TO_CHAR) return CODE_TO_CHAR[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("F") && /^F\d+$/.test(code)) return code;
  return code;
}

function labelToCode(label: string): string {
  for (const [code, char] of Object.entries(CODE_TO_CHAR)) {
    if (char === label) return code;
  }
  if (label.length === 1 && /[A-Za-z]/.test(label)) return `Key${label.toUpperCase()}`;
  if (label.length === 1 && /\d/.test(label)) return `Digit${label}`;
  if (/^F\d+$/.test(label)) return label;
  return label;
}

export function parseBinding(binding: string): ParsedBinding | null {
  if (!binding || binding.trim() === "") return null;
  const parts = binding.split("+");
  if (parts.length < 1) return null;

  const parsed: ParsedBinding = { code: "", ctrl: false, alt: false, shift: false, meta: false };

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i].trim();
    const key = MODIFIER_MAP[part];
    if (key) {
      parsed[key] = true;
    }
  }

  const codePart = parts[parts.length - 1].trim();
  if (codePart === "[1-9]") {
    parsed.code = "Digit";
    return parsed;
  }

  parsed.code = labelToCode(codePart);
  if (!parsed.code) return null;

  return parsed;
}

export function formatBinding(parsed: ParsedBinding): string {
  const parts: string[] = [];
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  if (parsed.meta) parts.push("Meta");

  if (parsed.code === "Digit") {
    parts.push("[1-9]");
  } else {
    parts.push(codeToLabel(parsed.code));
  }

  return parts.join("+");
}

export function captureBinding(e: KeyboardEvent): ParsedBinding {
  const parsed: ParsedBinding = {
    code: e.code,
    ctrl: IS_MACOS ? false : e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: IS_MACOS ? e.metaKey : false,
  };

  // On macOS primary modifier is Cmd → stored as Ctrl in our chord language
  // so defaults written as Ctrl+* work on both platforms via matchesBinding.
  if (IS_MACOS && e.metaKey) {
    parsed.ctrl = true;
    parsed.meta = false;
  }

  return parsed;
}

export function matchesBinding(e: KeyboardEvent, binding: string): MatchResult {
  if (!binding || binding.trim() === "") return { matched: false };

  const isRangeBinding = binding.endsWith("+[1-9]");
  if (isRangeBinding) {
    const prefix = binding.slice(0, -5);
    const modifierParts = prefix.split("+").filter(Boolean);

    const match = e.code.match(/^Digit([1-9])$/);
    if (!match) return { matched: false };

    const hasCtrl = modifierParts.includes("Ctrl");
    const hasAlt = modifierParts.includes("Alt");
    const hasShift = modifierParts.includes("Shift");
    const hasMeta = modifierParts.includes("Meta") || modifierParts.includes("Cmd");

    // Ctrl in binding = primary modifier (Cmd on macOS)
    const primaryDown = IS_MACOS ? e.metaKey : e.ctrlKey;
    const secondaryCtrl = IS_MACOS ? e.ctrlKey : e.metaKey;

    if (
      primaryDown !== hasCtrl ||
      e.altKey !== hasAlt ||
      e.shiftKey !== hasShift ||
      secondaryCtrl !== hasMeta
    ) {
      return { matched: false };
    }

    const digit = parseInt(match[1], 10);
    return { matched: true, digit };
  }

  const parsed = parseBinding(binding);
  if (!parsed) return { matched: false };

  const codeMatch = e.code === parsed.code;
  // Ctrl in stored binding → primary (⌘ on Mac, Ctrl on Win)
  const ctrlMatch = IS_MACOS ? e.metaKey === parsed.ctrl : e.ctrlKey === parsed.ctrl;
  const altMatch = e.altKey === parsed.alt;
  const shiftMatch = e.shiftKey === parsed.shift;
  const metaMatch = IS_MACOS ? e.ctrlKey === parsed.meta : e.metaKey === parsed.meta;

  return {
    matched: codeMatch && ctrlMatch && altMatch && shiftMatch && metaMatch,
  };
}

/** Merge user overrides with defaults. Empty override string means unbound. */
export function resolveBindings(overrides: Record<string, string> | null | undefined): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const action of SHORTCUT_ACTIONS) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, action.id)) {
      resolved[action.id] = overrides[action.id] ?? "";
    } else {
      resolved[action.id] = action.defaultBinding;
    }
  }
  return resolved;
}

/** Resolved chord for one action (default if no override). */
export function getResolvedBinding(
  actionId: string,
  overrides?: Record<string, string> | null,
): string {
  const action = ACTION_BY_ID.get(actionId);
  if (!action) return "";
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, actionId)) {
    return overrides[actionId] ?? "";
  }
  return action.defaultBinding;
}

/**
 * Convert a registry binding string to a CodeMirror keymap key
 * (e.g. "Ctrl+S" → "Mod-s", "Shift+F12" → "Shift-F12").
 */
export function toCodeMirrorKey(binding: string): string {
  const parsed = parseBinding(binding);
  if (!parsed || !parsed.code) return "";

  const mods: string[] = [];
  // Primary modifier → Mod (Cmd on mac, Ctrl on win)
  if (parsed.ctrl) mods.push("Mod");
  if (parsed.alt) mods.push("Alt");
  if (parsed.shift) mods.push("Shift");
  if (parsed.meta) mods.push("Ctrl"); // secondary on mac when stored as Meta

  let key = codeToLabel(parsed.code);
  const arrowMap: Record<string, string> = {
    Up: "ArrowUp",
    Down: "ArrowDown",
    Left: "ArrowLeft",
    Right: "ArrowRight",
    Esc: "Escape",
  };
  if (arrowMap[key]) key = arrowMap[key];
  else if (key.length === 1 && /[A-Za-z]/.test(key)) key = key.toLowerCase();

  return [...mods, key].join("-");
}

export function findConflicts(bindings: Record<string, string>): ConflictEntry[] {
  const byBinding = new Map<string, string[]>();
  for (const [actionId, binding] of Object.entries(bindings)) {
    if (!binding || binding.trim() === "") continue;
    const existing = byBinding.get(binding);
    if (existing) {
      existing.push(actionId);
    } else {
      byBinding.set(binding, [actionId]);
    }
  }

  const conflicts: ConflictEntry[] = [];
  for (const [binding, actions] of byBinding) {
    if (actions.length > 1) {
      conflicts.push({ binding, actions });
    }
  }
  return conflicts;
}

export function isSwitchProjectBinding(binding: string): boolean {
  return binding.endsWith("+[1-9]");
}

export function isRecordableAction(action: ShortcutAction): boolean {
  return action.recordable !== false && !isSwitchProjectBinding(action.defaultBinding);
}
