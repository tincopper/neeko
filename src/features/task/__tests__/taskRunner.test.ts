import { describe, it, expect } from "vitest";
import { formatTaskExit, formatTaskHeader } from "../taskRunner";

describe("formatTaskHeader", () => {
  it("should_include_command_and_cwd", () => {
    const text = formatTaskHeader("pnpm test", "/tmp/proj");
    expect(text).toContain("pnpm test");
    expect(text).toContain("/tmp/proj");
    expect(text).toContain(">");
  });

  it("should_omit_cwd_line_when_empty", () => {
    const text = formatTaskHeader("echo hi", "");
    expect(text).toContain("echo hi");
    expect(text).not.toContain("cwd:");
  });
});

describe("formatTaskExit", () => {
  it("should_mark_success_exit", () => {
    expect(formatTaskExit(0)).toContain("code 0");
  });

  it("should_mark_failure_exit", () => {
    expect(formatTaskExit(1)).toContain("code 1");
  });
});
