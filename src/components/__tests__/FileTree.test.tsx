import { describe, it, expect } from "vitest";
import { buildTree } from "../../components/files";
import type { FileChange } from "../../types";

const file = (path: string, status: FileChange["status"] = "Modified"): FileChange => ({
  path,
  status,
  additions: 0,
  deletions: 0,
});

describe("buildTree", () => {
  it("空数组返回空树", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("单个文件生成一个叶子节点", () => {
    const result = buildTree([file("README.md")]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "README.md",
      path: "README.md",
      isDir: false,
      file: expect.objectContaining({ path: "README.md" }),
    });
  });

  it("嵌套路径产生正确的层级结构", () => {
    const result = buildTree([file("a/b/c.txt")]);
    // buildTree 应用 compactTree，但单文件叶子不需要压缩
    expect(result).toHaveLength(1);

    const a = result[0];
    expect(a.name).toBe("a");
    expect(a.isDir).toBe(true);
    // a/b 都是单子目录链 → a 的 compactName 应为 "a.b"
    expect(a.compactName).toBe("a.b");
    expect(a.children).toHaveLength(1);

    const leaf = a.children[0];
    expect(leaf.name).toBe("c.txt");
    expect(leaf.isDir).toBe(false);
    expect(leaf.file).toBeDefined();
  });

  it("同目录下多个文件共享父节点", () => {
    const result = buildTree([file("src/a.ts"), file("src/b.ts")]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src");
    expect(result[0].children).toHaveLength(2);
  });

  it("反斜杠路径被归一化为正斜杠", () => {
    const result = buildTree([file("a\\b\\c.txt")]);
    // compactTree 会压缩单子目录链
    const top = result[0];
    expect(top.compactName).toBe("a.b");
    expect(top.children[0].name).toBe("c.txt");
  });

  it("目录排在文件前面", () => {
    const result = buildTree([file("z_file.ts"), file("a_dir/inner.ts")]);
    expect(result).toHaveLength(2);
    expect(result[0].isDir).toBe(true);
    expect(result[0].name).toBe("a_dir");
    expect(result[1].isDir).toBe(false);
    expect(result[1].name).toBe("z_file.ts");
  });

  it("同类型节点按字母排序", () => {
    const result = buildTree([file("c.ts"), file("a.ts"), file("b.ts")]);
    expect(result.map((n) => n.name)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("单子目录链被压缩为 compactName", () => {
    const result = buildTree([file("com/tomgs/app/Main.java")]);
    // com -> tomgs -> app 都是单子目录链，应压缩
    const top = result[0];
    expect(top.compactName).toBe("com.tomgs.app");
    expect(top.children).toHaveLength(1);
    expect(top.children[0].name).toBe("Main.java");
  });

  it("多子目录不压缩", () => {
    const result = buildTree([file("a/b.txt"), file("a/c/file.txt")]);
    const a = result[0];
    // a 有两个子节点（b.txt 文件 + c 目录），不应压缩
    expect(a.compactName).toBeUndefined();
    expect(a.children).toHaveLength(2);
  });

  it("单个目录有多个文件不压缩", () => {
    const result = buildTree([file("a/b/c.ts"), file("a/b/d.ts")]);
    // a 有 1 个子目录 b，b 有 2 个文件 → a 应压缩为 "a.b"
    const top = result[0];
    expect(top.compactName).toBe("a.b");
    expect(top.children).toHaveLength(2);
  });

  it("叶子节点保留 FileChange 对象", () => {
    const f = file("src/index.ts", "Added");
    const result = buildTree([f]);
    const leaf = result[0].children[0];
    expect(leaf.file).toBe(f);
  });

  it("各种 status 映射到正确的 badge", () => {
    const statuses: FileChange["status"][] = ["Modified", "Added", "Deleted", "Renamed", "Untracked"];
    for (const status of statuses) {
      const result = buildTree([file(`test_${status}.txt`, status)]);
      expect(result[0].file?.status).toBe(status);
    }
  });

  it("过滤掉 .neeko/ 路径", () => {
    const result = buildTree([
      file("src/main.ts"),
      file(".neeko/config.json"),
      file(".neeko/sessions.json"),
      file("README.md"),
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.name)).toEqual(["src", "README.md"]);
  });

  it("过滤掉子目录中的 .neeko/ 路径", () => {
    const result = buildTree([
      file("src/index.ts"),
      file("some/path/.neeko/secret.json"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src");
  });

  it("worktree 变更文件正确构建树", () => {
    const wtFiles: FileChange[] = [
      { path: "src/main.rs", status: "Modified", additions: 5, deletions: 2 },
      { path: "src/lib.rs", status: "Added", additions: 10, deletions: 0 },
      { path: "README.md", status: "Deleted", additions: 0, deletions: 3 },
    ];
    const result = buildTree(wtFiles);
    // Should have src dir and README.md file
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("src");
    expect(result[0].isDir).toBe(true);
    expect(result[1].name).toBe("README.md");
    expect(result[1].file?.status).toBe("Deleted");
    expect(result[1].file?.deletions).toBe(3);
  });

  it("worktree 文件统计信息正确传递", () => {
    const wtFiles: FileChange[] = [
      { path: "app.ts", status: "Modified", additions: 8, deletions: 4 },
    ];
    const result = buildTree(wtFiles);
    expect(result[0].file?.additions).toBe(8);
    expect(result[0].file?.deletions).toBe(4);
  });
});
