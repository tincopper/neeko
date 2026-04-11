import { describe, it, expect } from "vitest";
import {
  detectLanguage,
  escapeHtml,
  tokenizeForDiff,
  computeLCS,
  computeWordDiff,
  buildSplitRows,
} from "../../components/DiffView";
import type { DiffHunk, DiffLine, DiffSource } from "../../components/DiffView";

describe("detectLanguage", () => {
  it(".ts 返回 typescript", () => {
    expect(detectLanguage("index.ts")).toBe("typescript");
  });

  it(".tsx 返回 typescript", () => {
    expect(detectLanguage("App.tsx")).toBe("typescript");
  });

  it(".js 返回 javascript", () => {
    expect(detectLanguage("main.js")).toBe("javascript");
  });

  it(".py 返回 python", () => {
    expect(detectLanguage("app.py")).toBe("python");
  });

  it(".rs 返回 rust", () => {
    expect(detectLanguage("lib.rs")).toBe("rust");
  });

  it("Dockerfile 返回 dockerfile", () => {
    expect(detectLanguage("Dockerfile")).toBe("dockerfile");
  });

  it("路径中包含 Dockerfile 返回 dockerfile", () => {
    expect(detectLanguage("deploy/Dockerfile")).toBe("dockerfile");
  });

  it(".xyz 未知扩展名返回 plaintext", () => {
    expect(detectLanguage("file.xyz")).toBe("plaintext");
  });

  it("无扩展名返回 plaintext", () => {
    expect(detectLanguage("Makefile")).toBe("plaintext");
  });

  it("大小写不敏感", () => {
    expect(detectLanguage("App.TS")).toBe("typescript");
    expect(detectLanguage("Style.CSS")).toBe("css");
  });
});

describe("escapeHtml", () => {
  it("转义 & < > \"", () => {
    expect(escapeHtml('<b class="x">&</b>')).toBe("&lt;b class=&quot;x&quot;&gt;&amp;&lt;/b&gt;");
  });

  it("没有特殊字符时返回原字符串", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("空字符串返回空字符串", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("tokenizeForDiff", () => {
  it("按单词和空白分词", () => {
    expect(tokenizeForDiff("hello world")).toEqual(["hello", " ", "world"]);
  });

  it("标点符号单独成 token", () => {
    expect(tokenizeForDiff("a+b")).toEqual(["a", "+", "b"]);
  });

  it("CJK 字符被分组", () => {
    const tokens = tokenizeForDiff("你好 world");
    expect(tokens).toContain("你好");
    expect(tokens).toContain("world");
  });

  it("空字符串返回空数组", () => {
    expect(tokenizeForDiff("")).toEqual([]);
  });

  it("连续空格被保留", () => {
    expect(tokenizeForDiff("a  b")).toEqual(["a", " ", " ", "b"]);
  });
});

describe("computeLCS", () => {
  it("完全相同返回完整对角线", () => {
    const a = ["a", "b", "c"];
    const lcs = computeLCS(a, a);
    expect(lcs[0][0]).toBe(true);
    expect(lcs[1][1]).toBe(true);
    expect(lcs[2][2]).toBe(true);
  });

  it("完全不同返回空 LCS", () => {
    const lcs = computeLCS(["a", "b"], ["c", "d"]);
    expect(lcs.flat().every((v) => !v)).toBe(true);
  });

  it("部分相同", () => {
    const lcs = computeLCS(["a", "b", "c"], ["a", "x", "c"]);
    expect(lcs[0][0]).toBe(true); // a
    expect(lcs[2][2]).toBe(true); // c
  });

  it("空数组返回空", () => {
    const lcs = computeLCS([], ["a"]);
    expect(lcs).toEqual([]);
  });
});

describe("computeWordDiff", () => {
  it("相同文本返回全 equal", () => {
    const { oldParts, newParts } = computeWordDiff("hello", "hello");
    expect(oldParts).toEqual([{ value: "hello", type: "equal" }]);
    expect(newParts).toEqual([{ value: "hello", type: "equal" }]);
  });

  it("单词替换产生 removed + added", () => {
    const { oldParts, newParts } = computeWordDiff("hello", "world");
    expect(oldParts).toEqual([{ value: "hello", type: "removed" }]);
    expect(newParts).toEqual([{ value: "world", type: "added" }]);
  });

  it("空字符串 vs 有内容", () => {
    const { oldParts, newParts } = computeWordDiff("", "new");
    expect(oldParts).toEqual([]);
    expect(newParts).toEqual([{ value: "new", type: "added" }]);
  });

  it("添加后缀时保留相等部分", () => {
    const { oldParts, newParts } = computeWordDiff("hello", "hello world");
    // old 全部 equal
    expect(oldParts).toEqual([{ value: "hello", type: "equal" }]);
    // new 有 equal + added
    expect(newParts[0]).toEqual({ value: "hello", type: "equal" });
    const addedParts = newParts.filter(p => p.type === "added");
    expect(addedParts.length).toBeGreaterThan(0);
    const addedText = addedParts.map(p => p.value).join("");
    expect(addedText).toContain("world");
  });
});

describe("buildSplitRows", () => {
  const hunk = (lines: DiffLine[]): DiffHunk => ({
    old_start: 1,
    old_lines: lines.length,
    new_start: 1,
    new_lines: lines.length,
    lines,
  });

  it("第一行是 hunk-header", () => {
    const rows = buildSplitRows(hunk([{ Context: "line1" }]));
    expect(rows[0].type).toBe("hunk-header");
    expect(rows[0].hunkHeader).toContain("@@");
  });

  it("context 行产生单行", () => {
    const rows = buildSplitRows(hunk([{ Context: "unchanged" }]));
    expect(rows).toHaveLength(2); // header + 1 context
    expect(rows[1]).toMatchObject({
      type: "context",
      oldContent: "unchanged",
      newContent: "unchanged",
      oldType: "context",
      newType: "context",
    });
  });

  it("removed + added 配对在同一行", () => {
    const rows = buildSplitRows(hunk([
      { Removed: "old line" },
      { Added: "new line" },
    ]));
    // header + 1 change row
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      type: "change",
      oldContent: "old line",
      newContent: "new line",
      oldType: "removed",
      newType: "added",
    });
  });

  it("removed 比 added 多时，多出的行标记为 empty", () => {
    const rows = buildSplitRows(hunk([
      { Removed: "old1" },
      { Removed: "old2" },
      { Added: "new1" },
    ]));
    // header + 2 change rows
    expect(rows).toHaveLength(3);
    expect(rows[1].oldType).toBe("removed");
    expect(rows[1].newType).toBe("added");
    expect(rows[2].oldType).toBe("removed");
    expect(rows[2].newType).toBe("empty");
  });

  it("added 比 removed 多时，多出的行标记为 empty", () => {
    const rows = buildSplitRows(hunk([
      { Removed: "old1" },
      { Added: "new1" },
      { Added: "new2" },
    ]));
    expect(rows).toHaveLength(3);
    expect(rows[1].newType).toBe("added");
    expect(rows[2].oldType).toBe("empty");
    expect(rows[2].newType).toBe("added");
  });

  it("行号递增正确", () => {
    const rows = buildSplitRows(hunk([
      { Context: "c1" },
      { Context: "c2" },
    ]));
    expect(rows[1].oldLineNum).toBe(1);
    expect(rows[1].newLineNum).toBe(1);
    expect(rows[2].oldLineNum).toBe(2);
    expect(rows[2].newLineNum).toBe(2);
  });
});

describe("DiffSource worktree type", () => {
  it("worktree DiffSource 应有正确的类型结构", () => {
    const source: DiffSource = {
      type: "worktree",
      projectId: "proj-123",
      worktreePath: "/path/to/worktree",
    };
    expect(source.type).toBe("worktree");
    expect(source.projectId).toBe("proj-123");
    expect(source.worktreePath).toBe("/path/to/worktree");
  });

  it("worktree DiffSource 与其他类型可区分", () => {
    const local: DiffSource = { type: "local", projectId: "p1" };
    const wt: DiffSource = { type: "worktree", projectId: "p1", worktreePath: "/wt" };
    const wsl: DiffSource = { type: "wsl", distro: "Ubuntu", projectPath: "/home" };

    expect(local.type).toBe("local");
    expect(wt.type).toBe("worktree");
    expect(wsl.type).toBe("wsl");
  });
});
