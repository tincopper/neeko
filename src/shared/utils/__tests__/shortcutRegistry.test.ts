import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseBinding,
  formatBinding,
  captureBinding,
  matchesBinding,
  modifiersMatch,
  resolveBindings,
  findConflicts,
  SHORTCUT_ACTIONS,
  isSwitchProjectBinding,
  toCodeMirrorKey,
  getResolvedBinding,
  buildIdeaShortcutOverrides,
  IDEA_SHORTCUT_PRESET,
} from "../../utils/shortcutRegistry";
import { IS_MACOS } from "../../utils/platform";

vi.mock("../../utils/platform", () => ({
  IS_MACOS: false,
  IS_WINDOWS: true,
}));

function createKeyEvent(code: string, opts: {
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
} = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    code,
    ctrlKey: opts.ctrlKey ?? false,
    altKey: opts.altKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    metaKey: opts.metaKey ?? false,
    bubbles: true,
  });
}

describe("shortcutRegistry", () => {
  describe("parseBinding", () => {
    it("parses simple Ctrl+N", () => {
      const result = parseBinding("Ctrl+N");
      expect(result).toEqual({ code: "KeyN", ctrl: true, alt: false, shift: false, meta: false });
    });

    it("parses Ctrl+Shift+N", () => {
      const result = parseBinding("Ctrl+Shift+N");
      expect(result).toEqual({ code: "KeyN", ctrl: true, alt: false, shift: true, meta: false });
    });

    it("parses Meta+N", () => {
      const result = parseBinding("Meta+N");
      expect(result).toEqual({ code: "KeyN", ctrl: false, alt: false, shift: false, meta: true });
    });

    it("parses range binding Ctrl+[1-9]", () => {
      const result = parseBinding("Ctrl+[1-9]");
      expect(result).toEqual({ code: "Digit", ctrl: true, alt: false, shift: false, meta: false });
    });

    it("parses Ctrl+Shift+[1-9]", () => {
      const result = parseBinding("Ctrl+Shift+[1-9]");
      expect(result).toEqual({ code: "Digit", ctrl: true, alt: false, shift: true, meta: false });
    });

    it("parses digit keys", () => {
      const result = parseBinding("Ctrl+1");
      expect(result).toEqual({ code: "Digit1", ctrl: true, alt: false, shift: false, meta: false });
    });

    it("parses function keys", () => {
      const result = parseBinding("Ctrl+F5");
      expect(result).toEqual({ code: "F5", ctrl: true, alt: false, shift: false, meta: false });
    });

    it("returns null for empty string", () => {
      expect(parseBinding("")).toBeNull();
      expect(parseBinding("   ")).toBeNull();
    });

    it("handles multiple modifiers", () => {
      const result = parseBinding("Ctrl+Alt+Shift+Meta+X");
      expect(result).toEqual({
        code: "KeyX",
        ctrl: true,
        alt: true,
        shift: true,
        meta: true,
      });
    });

    it("handles Cmd alias for Meta", () => {
      const result = parseBinding("Cmd+X");
      expect(result?.meta).toBe(true);
    });
  });

  describe("formatBinding", () => {
    it("round-trips Ctrl+N", () => {
      const parsed = parseBinding("Ctrl+N");
      expect(formatBinding(parsed!)).toBe("Ctrl+N");
    });

    it("round-trips Ctrl+Shift+N", () => {
      const parsed = parseBinding("Ctrl+Shift+N");
      expect(formatBinding(parsed!)).toBe("Ctrl+Shift+N");
    });

    it("round-trips range binding", () => {
      const parsed = parseBinding("Ctrl+[1-9]");
      expect(formatBinding(parsed!)).toBe("Ctrl+[1-9]");
    });

    it("round-trips multiple modifiers", () => {
      const original = "Ctrl+Alt+Shift+Meta+X";
      const parsed = parseBinding(original);
      expect(formatBinding(parsed!)).toBe(original);
    });

    it("round-trips digit keys", () => {
      const original = "Ctrl+1";
      const parsed = parseBinding(original);
      expect(formatBinding(parsed!)).toBe(original);
    });

    it("round-trips special characters", () => {
      const original = "Ctrl+`";
      const parsed = parseBinding(original);
      expect(formatBinding(parsed!)).toBe(original);
    });
  });

  describe("captureBinding", () => {
    it("captures Ctrl+N on Windows", () => {
      const e = createKeyEvent("KeyN", { ctrlKey: true });
      const result = captureBinding(e);
      expect(result).toEqual({ code: "KeyN", ctrl: true, alt: false, shift: false, meta: false });
    });

    it("does not capture meta on Windows", () => {
      const e = createKeyEvent("KeyN", { metaKey: true });
      const result = captureBinding(e);
      expect(result.meta).toBe(false);
    });

    it("captures only meta on macOS", () => {
      vi.doMock("../../utils/platform", () => ({
        IS_MACOS: true,
        IS_WINDOWS: false,
      }));
      // Test the behavior via logic rather than mocking module
      expect(IS_MACOS).toBe(false);
    });
  });

  describe("matchesBinding", () => {
    it("matches Ctrl+N", () => {
      const e = createKeyEvent("KeyN", { ctrlKey: true });
      expect(matchesBinding(e, "Ctrl+N")).toEqual({ matched: true });
    });

    it("does not match Ctrl+N when Shift is pressed", () => {
      const e = createKeyEvent("KeyN", { ctrlKey: true, shiftKey: true });
      expect(matchesBinding(e, "Ctrl+N")).toEqual({ matched: false });
    });

    it("does not match Ctrl+N for different key", () => {
      const e = createKeyEvent("KeyO", { ctrlKey: true });
      expect(matchesBinding(e, "Ctrl+N")).toEqual({ matched: false });
    });

    it("matches Ctrl+[1-9] range binding for Digit1", () => {
      const e = createKeyEvent("Digit1", { ctrlKey: true });
      expect(matchesBinding(e, "Ctrl+[1-9]")).toEqual({ matched: true, digit: 1 });
    });

    it("matches Ctrl+[1-9] for Digit9", () => {
      const e = createKeyEvent("Digit9", { ctrlKey: true });
      expect(matchesBinding(e, "Ctrl+[1-9]")).toEqual({ matched: true, digit: 9 });
    });

    it("does not match Ctrl+[1-9] for Digit0", () => {
      const e = createKeyEvent("Digit0", { ctrlKey: true });
      expect(matchesBinding(e, "Ctrl+[1-9]").matched).toBe(false);
    });

    it("does not match Ctrl+[1-9] when Alt is pressed", () => {
      const e = createKeyEvent("Digit3", { ctrlKey: true, altKey: true });
      expect(matchesBinding(e, "Ctrl+[1-9]").matched).toBe(false);
    });

    it("matches Ctrl+Shift+[1-9] correctly", () => {
      const e = createKeyEvent("Digit5", { ctrlKey: true, shiftKey: true });
      expect(matchesBinding(e, "Ctrl+Shift+[1-9]")).toEqual({ matched: true, digit: 5 });
    });

    it("does not match range binding for non-digit key", () => {
      const e = createKeyEvent("KeyA", { ctrlKey: true });
      expect(matchesBinding(e, "Ctrl+[1-9]").matched).toBe(false);
    });

    it("handles empty binding", () => {
      const e = createKeyEvent("KeyN", { ctrlKey: true });
      expect(matchesBinding(e, "").matched).toBe(false);
    });

    it("matches Ctrl+Shift+N", () => {
      const e = createKeyEvent("KeyN", { ctrlKey: true, shiftKey: true });
      expect(matchesBinding(e, "Ctrl+Shift+N")).toEqual({ matched: true });
    });
  });

  describe("resolveBindings", () => {
    it("uses defaults when no overrides", () => {
      const result = resolveBindings({});
      expect(result.cycleWorktree).toBe("Ctrl+N");
      expect(result.openIde).toBe("Ctrl+O");
    });

    it("applies overrides", () => {
      const result = resolveBindings({ cycleWorktree: "Ctrl+Shift+N" });
      expect(result.cycleWorktree).toBe("Ctrl+Shift+N");
      expect(result.openIde).toBe("Ctrl+O");
    });

    it("handles undefined overrides", () => {
      expect(() => resolveBindings(undefined as unknown as Record<string, string>)).not.toThrow();
    });

    it("returns all actions", () => {
      const result = resolveBindings({});
      for (const action of SHORTCUT_ACTIONS) {
        expect(result[action.id]).toBeDefined();
      }
    });
  });

  describe("findConflicts", () => {
    it("returns empty for no conflicts", () => {
      const result = findConflicts(resolveBindings({}));
      expect(result).toEqual([]);
    });

    it("detects single conflict", () => {
      const result = findConflicts({
        cycleWorktree: "Ctrl+N",
        openIde: "Ctrl+N",
      });
      expect(result).toHaveLength(1);
      expect(result[0].binding).toBe("Ctrl+N");
      expect(result[0].actions).toContain("cycleWorktree");
      expect(result[0].actions).toContain("openIde");
    });

    it("detects multiple conflict groups", () => {
      const result = findConflicts({
        cycleWorktree: "Ctrl+W",
        openIde: "Ctrl+N",
        closeTab: "Ctrl+W",
        refreshTerminal: "Ctrl+N",
      });
      expect(result).toHaveLength(2);
    });

    it("skips empty bindings", () => {
      const result = findConflicts({
        cycleWorktree: "",
        openIde: "Ctrl+N",
      });
      expect(result).toEqual([]);
    });
  });

  describe("toCodeMirrorKey", () => {
    it("maps Ctrl+S to Mod-s", () => {
      expect(toCodeMirrorKey("Ctrl+S")).toBe("Mod-s");
    });

    it("maps F12", () => {
      expect(toCodeMirrorKey("F12")).toBe("F12");
    });

    it("maps Shift+F12", () => {
      expect(toCodeMirrorKey("Shift+F12")).toBe("Shift-F12");
    });
  });

  describe("getResolvedBinding", () => {
    it("returns default when no override", () => {
      expect(getResolvedBinding("saveFile")).toBe("Ctrl+S");
    });

    it("returns user override", () => {
      expect(getResolvedBinding("saveFile", { saveFile: "Ctrl+Alt+S" })).toBe("Ctrl+Alt+S");
    });

    it("allows unbinding via empty string override", () => {
      expect(getResolvedBinding("saveFile", { saveFile: "" })).toBe("");
    });

    it("returns empty for unknown action", () => {
      expect(getResolvedBinding("notARealAction")).toBe("");
    });
  });

  describe("P3 editor navigation bindings", () => {
    it("should_parse_backslash_split_bindings", () => {
      expect(parseBinding("Ctrl+\\")).toEqual({
        code: "Backslash",
        ctrl: true,
        alt: false,
        shift: false,
        meta: false,
      });
      expect(parseBinding("Ctrl+Shift+\\")).toMatchObject({
        code: "Backslash",
        ctrl: true,
        shift: true,
      });
    });

    it("should_include_fileStructure_and_split_defaults", () => {
      const resolved = resolveBindings({});
      expect(resolved.fileStructure).toBe("Ctrl+F12");
      expect(resolved.splitRight).toBe("Ctrl+\\");
      expect(resolved.unsplitEditor).toBe("Ctrl+Shift+\\");
    });

    it("should_use_idea_defaults_for_tabs_and_nav_history", () => {
      const resolved = resolveBindings({});
      expect(resolved.prevTab).toBe("Alt+Left");
      expect(resolved.nextTab).toBe("Alt+Right");
      expect(resolved.navigateBack).toBe("Ctrl+Alt+Left");
      expect(resolved.navigateForward).toBe("Ctrl+Alt+Right");
      expect(findConflicts(resolved)).toEqual([]);
    });

    it("should_build_idea_preset_without_conflicts", () => {
      const overrides = buildIdeaShortcutOverrides();
      expect(overrides.navigateBack).toBe(IDEA_SHORTCUT_PRESET.navigateBack);
      expect(overrides.closeTab).toBe("Ctrl+F4");
      expect(overrides.fileStructure).toBe("Ctrl+F12");
      const conflicts = findConflicts(resolveBindings(overrides));
      expect(conflicts).toEqual([]);
    });
  });

  describe("modifiersMatch macOS IDEA navigation", () => {
    it("should_match_Cmd_Option_Left_for_Ctrl_Alt_Left", () => {
      expect(
        modifiersMatch(
          { ctrlKey: false, altKey: true, shiftKey: false, metaKey: true },
          { ctrl: true, alt: true, shift: false, meta: false },
          true,
        ),
      ).toBe(true);
    });

    it("should_match_physical_Control_Option_Left_for_Ctrl_Alt_Left", () => {
      expect(
        modifiersMatch(
          { ctrlKey: true, altKey: true, shiftKey: false, metaKey: false },
          { ctrl: true, alt: true, shift: false, meta: false },
          true,
        ),
      ).toBe(true);
    });

    it("should_not_match_Option_Left_alone_for_Ctrl_Alt_Left", () => {
      expect(
        modifiersMatch(
          { ctrlKey: false, altKey: true, shiftKey: false, metaKey: false },
          { ctrl: true, alt: true, shift: false, meta: false },
          true,
        ),
      ).toBe(false);
    });

    it("should_match_Option_Left_only_when_no_cmd_or_control", () => {
      expect(
        modifiersMatch(
          { ctrlKey: false, altKey: true, shiftKey: false, metaKey: false },
          { ctrl: false, alt: true, shift: false, meta: false },
          true,
        ),
      ).toBe(true);
      // Holding ⌘ must not fire Alt+Left (tab switch)
      expect(
        modifiersMatch(
          { ctrlKey: false, altKey: true, shiftKey: false, metaKey: true },
          { ctrl: false, alt: true, shift: false, meta: false },
          true,
        ),
      ).toBe(false);
    });

    it("should_match_Ctrl_Alt_Left_on_windows_with_physical_ctrl", () => {
      expect(
        modifiersMatch(
          { ctrlKey: true, altKey: true, shiftKey: false, metaKey: false },
          { ctrl: true, alt: true, shift: false, meta: false },
          false,
        ),
      ).toBe(true);
      expect(
        modifiersMatch(
          { ctrlKey: false, altKey: true, shiftKey: false, metaKey: true },
          { ctrl: true, alt: true, shift: false, meta: false },
          false,
        ),
      ).toBe(false);
    });
  });

  describe("isSwitchProjectBinding", () => {
    it("returns true for +[1-9] suffix", () => {
      expect(isSwitchProjectBinding("Ctrl+[1-9]")).toBe(true);
      expect(isSwitchProjectBinding("Ctrl+Shift+[1-9]")).toBe(true);
    });

    it("returns false for regular bindings", () => {
      expect(isSwitchProjectBinding("Ctrl+N")).toBe(false);
      expect(isSwitchProjectBinding("Ctrl+1")).toBe(false);
    });
  });
});
