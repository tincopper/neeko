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

export interface ShortcutAction {
  id: string;
  label: string;
  defaultBinding: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "cycleWorktree", label: "Cycle Worktree", defaultBinding: "Ctrl+N" },
  { id: "openIde", label: "Open in IDE", defaultBinding: "Ctrl+O" },
  { id: "refreshTerminal", label: "Refresh Terminal", defaultBinding: "Ctrl+Alt+R" },
  { id: "closeTab", label: "Close Tab", defaultBinding: "Ctrl+W" },
  { id: "cycleProject", label: "Next Project", defaultBinding: "Ctrl+Q" },
  { id: "switchProject", label: "Jump to Project", defaultBinding: "Ctrl+[1-9]" },
  { id: "toggleTerminal", label: "Toggle Terminal/File View", defaultBinding: "Ctrl+T" },
];

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

    if (e.ctrlKey !== hasCtrl || e.altKey !== hasAlt || e.shiftKey !== hasShift || e.metaKey !== hasMeta) {
      return { matched: false };
    }

    const digit = parseInt(match[1]);
    return { matched: true, digit };
  }

  const parsed = parseBinding(binding);
  if (!parsed) return { matched: false };

  const codeMatch = e.code === parsed.code;
  const ctrlMatch = IS_MACOS ? e.metaKey === parsed.ctrl : e.ctrlKey === parsed.ctrl;
  const altMatch = e.altKey === parsed.alt;
  const shiftMatch = e.shiftKey === parsed.shift;
  const metaMatch = IS_MACOS ? e.ctrlKey === parsed.meta : e.metaKey === parsed.meta;

  return {
    matched: codeMatch && ctrlMatch && altMatch && shiftMatch && metaMatch,
  };
}

export function resolveBindings(overrides: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const action of SHORTCUT_ACTIONS) {
    resolved[action.id] = (overrides && overrides[action.id]) || action.defaultBinding;
  }
  return resolved;
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
