/**
 * Pure navigation history (IDEA-like Back / Forward).
 * No React / store deps — unit-tested in isolation.
 */

export interface NavLocation {
  projectId: string;
  tabKey: string;
  filePath: string;
  /** 1-based line (matches pendingNavigateTarget). */
  line: number;
  /** 0-based column. */
  column: number;
}

export function sameNavLocation(a: NavLocation, b: NavLocation): boolean {
  return (
    a.projectId === b.projectId &&
    a.tabKey === b.tabKey &&
    a.filePath === b.filePath &&
    a.line === b.line &&
    a.column === b.column
  );
}

/** True if same file (ignore caret) — used to avoid noise on tiny cursor moves. */
export function sameNavFile(a: NavLocation, b: NavLocation): boolean {
  return (
    a.projectId === b.projectId &&
    a.tabKey === b.tabKey &&
    a.filePath === b.filePath
  );
}

export interface NavigationHistory {
  push(loc: NavLocation): void;
  /** Replace tip without growing stack (after landing from a navigate). */
  replaceTip(loc: NavLocation): void;
  back(): NavLocation | null;
  forward(): NavLocation | null;
  canBack(): boolean;
  canForward(): boolean;
  current(): NavLocation | null;
  clear(): void;
  /** Test / debug snapshot. */
  snapshot(): { stack: NavLocation[]; index: number };
}

export function createNavigationHistory(maxEntries = 100): NavigationHistory {
  let stack: NavLocation[] = [];
  let index = -1;

  return {
    push(loc: NavLocation) {
      if (index >= 0 && sameNavLocation(stack[index], loc)) {
        return;
      }
      // Drop any forward entries after branching.
      if (index < stack.length - 1) {
        stack = stack.slice(0, index + 1);
      }
      stack.push(loc);
      if (stack.length > maxEntries) {
        stack = stack.slice(stack.length - maxEntries);
      }
      index = stack.length - 1;
    },

    replaceTip(loc: NavLocation) {
      if (index < 0) {
        this.push(loc);
        return;
      }
      stack[index] = loc;
    },

    back() {
      if (index <= 0) return null;
      index -= 1;
      return stack[index] ?? null;
    },

    forward() {
      if (index < 0 || index >= stack.length - 1) return null;
      index += 1;
      return stack[index] ?? null;
    },

    canBack() {
      return index > 0;
    },

    canForward() {
      return index >= 0 && index < stack.length - 1;
    },

    current() {
      return index >= 0 ? (stack[index] ?? null) : null;
    },

    clear() {
      stack = [];
      index = -1;
    },

    snapshot() {
      return { stack: stack.map((l) => ({ ...l })), index };
    },
  };
}
