import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from "@tauri-apps/api/core";
import { createProjectCommands } from "../commandFactory";

// ────────────────────────────────────────────────────────────────────────────
// createProjectCommands — unified (projectId: string)
// ────────────────────────────────────────────────────────────────────────────

describe("createProjectCommands (Local)", () => {
  const projectId = "proj-123";
  const commands = createProjectCommands(projectId);
  const mockInvoke = vi.mocked(invoke);
  const payload = () => ({ projectId });

  beforeEach(() => mockInvoke.mockClear());

  it("refreshGitInfo should call get_git_info", async () => {
    await commands.refreshGitInfo();
    expect(mockInvoke).toHaveBeenCalledWith("get_git_info", payload());
  });

  it("getAheadBehind should call get_ahead_behind", async () => {
    await commands.getAheadBehind();
    expect(mockInvoke).toHaveBeenCalledWith("get_ahead_behind", payload());
  });

  it("stageFiles should call stage_files with filePaths", async () => {
    await commands.stageFiles(["src/foo.ts", "src/bar.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("stage_files", {
      ...payload(),
      filePaths: ["src/foo.ts", "src/bar.ts"],
    });
  });

  it("unstageFiles should call unstage_files", async () => {
    await commands.unstageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("unstage_files", {
      ...payload(),
      filePaths: ["src/foo.ts"],
    });
  });

  it("discardFile should call discard_file", async () => {
    await commands.discardFile("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("discard_file", {
      ...payload(),
      filePath: "src/foo.ts",
    });
  });

  it("commitFiles should call commit_files", async () => {
    await commands.commitFiles(["src/foo.ts"], "fix: foo");
    expect(mockInvoke).toHaveBeenCalledWith("commit_files", {
      ...payload(),
      filePaths: ["src/foo.ts"],
      message: "fix: foo",
    });
  });

  it("fetch should call fetch", async () => {
    await commands.fetch();
    expect(mockInvoke).toHaveBeenCalledWith("fetch", payload());
  });

  it("pull should call pull", async () => {
    await commands.pull();
    expect(mockInvoke).toHaveBeenCalledWith("pull", payload());
  });

  it("push should call push with setUpstream default false", async () => {
    await commands.push();
    expect(mockInvoke).toHaveBeenCalledWith("push", {
      ...payload(),
      setUpstream: false,
    });
  });

  it("push(true) should call push with setUpstream true", async () => {
    await commands.push(true);
    expect(mockInvoke).toHaveBeenCalledWith("push", {
      ...payload(),
      setUpstream: true,
    });
  });

  it("fetchWithCredentials should call fetch_with_credentials", async () => {
    await commands.fetchWithCredentials("user", "pass");
    expect(mockInvoke).toHaveBeenCalledWith("fetch_with_credentials", {
      ...payload(),
      username: "user",
      password: "pass",
    });
  });

  it("pullWithCredentials should call pull_with_credentials", async () => {
    await commands.pullWithCredentials("user", "pass");
    expect(mockInvoke).toHaveBeenCalledWith("pull_with_credentials", {
      ...payload(),
      username: "user",
      password: "pass",
    });
  });

  it("pushWithCredentials should call push_with_credentials", async () => {
    await commands.pushWithCredentials(false, "user", "pass");
    expect(mockInvoke).toHaveBeenCalledWith("push_with_credentials", {
      ...payload(),
      setUpstream: false,
      username: "user",
      password: "pass",
    });
  });

  it("checkoutBranch should call checkout_branch", async () => {
    await commands.checkoutBranch("main");
    expect(mockInvoke).toHaveBeenCalledWith("checkout_branch", {
      ...payload(),
      branchName: "main",
    });
  });

  it("createBranch should call create_branch", async () => {
    await commands.createBranch("feature/foo", "main");
    expect(mockInvoke).toHaveBeenCalledWith("create_branch", {
      ...payload(),
      branchName: "feature/foo",
      startPoint: "main",
    });
  });

  it("deleteBranch should call delete_branch", async () => {
    await commands.deleteBranch("feature/foo");
    expect(mockInvoke).toHaveBeenCalledWith("delete_branch", {
      ...payload(),
      branchName: "feature/foo",
    });
  });

  it("getCommitLog should call get_commit_log", async () => {
    await commands.getCommitLog(10, 0);
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_log", {
      ...payload(),
      count: 10,
      skip: 0,
    });
  });

  it("getCommitDetail should call get_commit_detail", async () => {
    await commands.getCommitDetail("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_detail", {
      ...payload(),
      commitHash: "abc123",
    });
  });

  it("getCommitFiles should call get_commit_files", async () => {
    await commands.getCommitFiles("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_files", {
      ...payload(),
      commitHash: "abc123",
    });
  });

  it("getCommitFileDiff should call get_commit_file_diff", async () => {
    await commands.getCommitFileDiff("abc123", "src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_file_diff", {
      ...payload(),
      commitHash: "abc123",
      filePath: "src/foo.ts",
    });
  });

  it("cherryPick should call cherry_pick", async () => {
    await commands.cherryPick("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("cherry_pick", {
      ...payload(),
      commitHash: "abc123",
    });
  });

  it("revert should call revert", async () => {
    await commands.revert("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("revert", {
      ...payload(),
      commitHash: "abc123",
    });
  });

  it("createTag should call create_tag", async () => {
    await commands.createTag("v1.0");
    expect(mockInvoke).toHaveBeenCalledWith("create_tag", {
      ...payload(),
      tagName: "v1.0",
    });
  });

  it("readDirTree should call read_dir_tree", async () => {
    await commands.readDirTree();
    expect(mockInvoke).toHaveBeenCalledWith("read_dir_tree", {
      ...payload(),
      rootPath: null,
      subPath: null,
      maxDepth: 4,
    });
  });

  it("readFileContent should call read_file_content", async () => {
    await commands.readFileContent("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("read_file_content", {
      ...payload(),
      filePath: "src/foo.ts",
      rootPath: undefined,
    });
  });

  it("writeFileContent should call write_file_content", async () => {
    await commands.writeFileContent("src/foo.ts", "content");
    expect(mockInvoke).toHaveBeenCalledWith("write_file_content", {
      ...payload(),
      filePath: "src/foo.ts",
      content: "content",
      rootPath: undefined,
    });
  });

  it("generateCommitMessage should call generate_commit_message", async () => {
    await commands.generateCommitMessage("opencode", ["src/foo.ts"], null);
    expect(mockInvoke).toHaveBeenCalledWith("generate_commit_message", {
      ...payload(),
      agentId: "opencode",
      filePaths: ["src/foo.ts"],
      agentCommandOverride: null,
    });
  });
});
