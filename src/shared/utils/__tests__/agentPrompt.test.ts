import { describe, expect, it } from "vitest";
import { buildDiffMessage } from "../agentPrompt";

describe("buildDiffMessage", () => {
  it("should_review_single_full_diff", () => {
    expect(
      buildDiffMessage("review", { filePath: "src/a.ts", isFullDiff: true }),
    ).toBe("review the changes in src/a.ts");
  });

  it("should_review_single_selection", () => {
    expect(
      buildDiffMessage("review", { filePath: "src/a.ts", lineCount: 4 }),
    ).toBe("review the selected changes in src/a.ts (4 lines)");
  });

  it("should_review_combined_full_diff", () => {
    expect(
      buildDiffMessage("review", {
        filePath: "combined",
        isFullDiff: true,
        combined: true,
        fileCount: 12,
      }),
    ).toBe("review this commit diff across 12 files");
  });

  it("should_review_combined_selection_with_file_list", () => {
    expect(
      buildDiffMessage("review", {
        filePath: "combined",
        lineCount: 7,
        combined: true,
        fileCount: 2,
        filePaths: ["src/a.ts", "src/b.ts"],
      }),
    ).toBe("review the selected changes across src/a.ts, src/b.ts (7 lines)");
  });
});
