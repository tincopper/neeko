/**
 * commandFactory.test.ts — 命令工厂单元测试
 *
 * Step 2: 真实测试，mock invoke，验证参数绑定正确
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from "@tauri-apps/api/core";
import { createLocalCommands, createWslCommands, createRemoteCommands } from "../commandFactory";

// ────────────────────────────────────────────────────────────────────────────
// createLocalCommands
// ────────────────────────────────────────────────────────────────────────────

describe("createLocalCommands", () => {
  const projectId = "proj-123";
  const commands = createLocalCommands(projectId);
  const mockInvoke = vi.mocked(invoke);

  beforeEach(() => mockInvoke.mockClear());

  it("refreshGitInfo should call refresh_git_info with projectId", async () => {
    await commands.refreshGitInfo();
    expect(mockInvoke).toHaveBeenCalledWith("refresh_git_info", { projectId });
  });

  it("getAheadBehind should call get_ahead_behind_command with projectId", async () => {
    await commands.getAheadBehind();
    expect(mockInvoke).toHaveBeenCalledWith("get_ahead_behind_command", { projectId });
  });

  it("stageFiles should call stage_files_command with projectId and filePaths", async () => {
    await commands.stageFiles(["src/foo.ts", "src/bar.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("stage_files_command", {
      projectId,
      filePaths: ["src/foo.ts", "src/bar.ts"],
    });
  });

  it("unstageFiles should call unstage_files_command with projectId and filePaths", async () => {
    await commands.unstageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("unstage_files_command", {
      projectId,
      filePaths: ["src/foo.ts"],
    });
  });

  it("discardFile should call discard_file_command with projectId and filePath", async () => {
    await commands.discardFile("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("discard_file_command", {
      projectId,
      filePath: "src/foo.ts",
    });
  });

  it("commitFiles should call commit_files_command with correct args", async () => {
    await commands.commitFiles(["src/foo.ts"], "feat: add feature");
    expect(mockInvoke).toHaveBeenCalledWith("commit_files_command", {
      projectId,
      filePaths: ["src/foo.ts"],
      message: "feat: add feature",
    });
  });

  it("fetch should call fetch_command with projectId", async () => {
    await commands.fetch();
    expect(mockInvoke).toHaveBeenCalledWith("fetch_command", { projectId });
  });

  it("pull should call pull_command with projectId", async () => {
    await commands.pull();
    expect(mockInvoke).toHaveBeenCalledWith("pull_command", { projectId });
  });

  it("push should default setUpstream to false", async () => {
    await commands.push();
    expect(mockInvoke).toHaveBeenCalledWith("push_command", {
      projectId,
      setUpstream: false,
    });
  });

  it("push should pass setUpstream=true when provided", async () => {
    await commands.push(true);
    expect(mockInvoke).toHaveBeenCalledWith("push_command", {
      projectId,
      setUpstream: true,
    });
  });

  it("checkoutBranch should call checkout_branch with projectId and branchName", async () => {
    await commands.checkoutBranch("feature/new-ui");
    expect(mockInvoke).toHaveBeenCalledWith("checkout_branch", {
      projectId,
      branchName: "feature/new-ui",
    });
  });

  it("createBranch should call create_branch with projectId and branchName", async () => {
    await commands.createBranch("feature/new-ui");
    expect(mockInvoke).toHaveBeenCalledWith("create_branch", {
      projectId,
      branchName: "feature/new-ui",
      startPoint: undefined,
    });
  });

  it("createBranch should pass startPoint when provided", async () => {
    await commands.createBranch("feature/new-ui", "main");
    expect(mockInvoke).toHaveBeenCalledWith("create_branch", {
      projectId,
      branchName: "feature/new-ui",
      startPoint: "main",
    });
  });

  it("deleteBranch should call delete_branch with projectId and branchName", async () => {
    await commands.deleteBranch("feature/old");
    expect(mockInvoke).toHaveBeenCalledWith("delete_branch", {
      projectId,
      branchName: "feature/old",
    });
  });

  it("getCommitLog should pass count and skip", async () => {
    await commands.getCommitLog(50, 100);
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_log_command", {
      projectId,
      count: 50,
      skip: 100,
    });
  });

  it("getCommitLog should pass undefined skip when omitted", async () => {
    await commands.getCommitLog(20);
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_log_command", {
      projectId,
      count: 20,
      skip: undefined,
    });
  });

  it("getCommitDetail should call get_commit_detail_command with commitHash", async () => {
    await commands.getCommitDetail("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_detail_command", {
      projectId,
      commitHash: "abc123",
    });
  });

  it("getCommitFiles should call get_commit_files_command with commitHash", async () => {
    await commands.getCommitFiles("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_files_command", {
      projectId,
      commitHash: "abc123",
    });
  });

  it("getCommitFileDiff should call get_commit_file_diff_command with all args", async () => {
    await commands.getCommitFileDiff("abc123", "src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_file_diff_command", {
      projectId,
      commitHash: "abc123",
      filePath: "src/foo.ts",
    });
  });

  it("cherryPick should call cherry_pick_command with commitHash", async () => {
    await commands.cherryPick("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("cherry_pick_command", {
      projectId,
      commitHash: "abc123",
    });
  });

  it("revert should call revert_command with commitHash", async () => {
    await commands.revert("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("revert_command", {
      projectId,
      commitHash: "abc123",
    });
  });

  it("createTag should call create_tag_command with tagName", async () => {
    await commands.createTag("v1.0.0");
    expect(mockInvoke).toHaveBeenCalledWith("create_tag_command", {
      projectId,
      tagName: "v1.0.0",
      message: undefined,
    });
  });

  it("createTag should pass message when provided", async () => {
    await commands.createTag("v1.0.0", "Release v1.0.0");
    expect(mockInvoke).toHaveBeenCalledWith("create_tag_command", {
      projectId,
      tagName: "v1.0.0",
      message: "Release v1.0.0",
    });
  });

  it("readDirTree should call read_dir_tree with defaults", async () => {
    await commands.readDirTree();
    expect(mockInvoke).toHaveBeenCalledWith("read_dir_tree", {
      projectId,
      rootPath: null,
      subPath: null,
      maxDepth: 4,
    });
  });

  it("readDirTree should pass rootPath, subPath, maxDepth when provided", async () => {
    await commands.readDirTree("/home/user/project", "src", 3);
    expect(mockInvoke).toHaveBeenCalledWith("read_dir_tree", {
      projectId,
      rootPath: "/home/user/project",
      subPath: "src",
      maxDepth: 3,
    });
  });

  it("readFileContent should call read_file_content with filePath", async () => {
    await commands.readFileContent("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("read_file_content", {
      projectId,
      filePath: "src/foo.ts",
      rootPath: undefined,
    });
  });

  it("writeFileContent should call write_file_content with all args", async () => {
    await commands.writeFileContent("src/foo.ts", "const x = 1;");
    expect(mockInvoke).toHaveBeenCalledWith("write_file_content", {
      projectId,
      filePath: "src/foo.ts",
      content: "const x = 1;",
      rootPath: undefined,
    });
  });

  it("generateCommitMessage should call generate_commit_message_command with filePaths", async () => {
    await commands.generateCommitMessage("opencode", ["src/foo.ts", "src/bar.ts"], null);
    expect(mockInvoke).toHaveBeenCalledWith("generate_commit_message_command", {
      projectId,
      agentId: "opencode",
      agentCommandOverride: null,
      filePaths: ["src/foo.ts", "src/bar.ts"],
    });
  });

  it("should return an object with all 23 ProjectCommands methods", () => {
    const expectedMethods = [
      "refreshGitInfo",
      "getAheadBehind",
      "stageFiles",
      "unstageFiles",
      "discardFile",
      "commitFiles",
      "fetch",
      "pull",
      "push",
      "checkoutBranch",
      "createBranch",
      "deleteBranch",
      "getCommitLog",
      "getCommitDetail",
      "getCommitFiles",
      "getCommitFileDiff",
      "cherryPick",
      "revert",
      "createTag",
      "readDirTree",
      "readFileContent",
      "writeFileContent",
      "generateCommitMessage",
    ];
    for (const method of expectedMethods) {
      expect(commands).toHaveProperty(method);
      expect(typeof commands[method as keyof typeof commands]).toBe("function");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// createWslCommands
// ────────────────────────────────────────────────────────────────────────────

describe("createWslCommands", () => {
  const distro = "Ubuntu-22.04";
  const projectPath = "/home/user/project";
  const commands = createWslCommands(distro, projectPath);
  const mockInvoke = vi.mocked(invoke);

  beforeEach(() => mockInvoke.mockClear());

  it("refreshGitInfo should call refresh_wsl_git_info with distro and projectPath", async () => {
    await commands.refreshGitInfo();
    expect(mockInvoke).toHaveBeenCalledWith("refresh_wsl_git_info", { distro, projectPath });
  });

  it("getAheadBehind should call wsl_get_ahead_behind", async () => {
    await commands.getAheadBehind();
    expect(mockInvoke).toHaveBeenCalledWith("wsl_get_ahead_behind", { distro, projectPath });
  });

  it("stageFiles should call wsl_stage_files with distro and projectPath", async () => {
    await commands.stageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("wsl_stage_files", {
      distro,
      projectPath,
      filePaths: ["src/foo.ts"],
    });
  });

  it("unstageFiles should call wsl_unstage_files", async () => {
    await commands.unstageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("wsl_unstage_files", {
      distro,
      projectPath,
      filePaths: ["src/foo.ts"],
    });
  });

  it("discardFile should call wsl_discard_file", async () => {
    await commands.discardFile("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_discard_file", {
      distro,
      projectPath,
      filePath: "src/foo.ts",
    });
  });

  it("commitFiles should call wsl_commit_files", async () => {
    await commands.commitFiles(["src/foo.ts"], "feat: wsl commit");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_commit_files", {
      distro,
      projectPath,
      filePaths: ["src/foo.ts"],
      message: "feat: wsl commit",
    });
  });

  it("fetch should call wsl_fetch", async () => {
    await commands.fetch();
    expect(mockInvoke).toHaveBeenCalledWith("wsl_fetch", { distro, projectPath });
  });

  it("pull should call wsl_pull", async () => {
    await commands.pull();
    expect(mockInvoke).toHaveBeenCalledWith("wsl_pull", { distro, projectPath });
  });

  it("push should default setUpstream to false", async () => {
    await commands.push();
    expect(mockInvoke).toHaveBeenCalledWith("wsl_push", {
      distro,
      projectPath,
      setUpstream: false,
    });
  });

  it("checkoutBranch should call wsl_checkout_branch (already implemented)", async () => {
    await commands.checkoutBranch("main");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_checkout_branch", {
      distro,
      projectPath,
      branchName: "main",
    });
  });

  it("createBranch should call wsl_create_branch (already implemented)", async () => {
    await commands.createBranch("feature/new");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_create_branch", {
      distro,
      projectPath,
      branchName: "feature/new",
    });
  });

  it("deleteBranch should call wsl_delete_branch", async () => {
    await commands.deleteBranch("old-branch");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_delete_branch", {
      distro,
      projectPath,
      branchName: "old-branch",
    });
  });

  it("getCommitLog should call wsl_get_commit_log with count and skip", async () => {
    await commands.getCommitLog(50, 0);
    expect(mockInvoke).toHaveBeenCalledWith("wsl_get_commit_log", {
      distro,
      projectPath,
      count: 50,
      skip: 0,
    });
  });

  it("cherryPick should call wsl_cherry_pick", async () => {
    await commands.cherryPick("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_cherry_pick", {
      distro,
      projectPath,
      commitHash: "abc123",
    });
  });

  it("revert should call wsl_revert", async () => {
    await commands.revert("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_revert", {
      distro,
      projectPath,
      commitHash: "abc123",
    });
  });

  it("createTag should call wsl_create_tag", async () => {
    await commands.createTag("v1.0.0", "tag msg");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_create_tag", {
      distro,
      projectPath,
      tagName: "v1.0.0",
      message: "tag msg",
    });
  });

  it("readDirTree should call wsl_read_dir_tree", async () => {
    await commands.readDirTree();
    expect(mockInvoke).toHaveBeenCalledWith("wsl_read_dir_tree", {
      distro,
      projectPath,
      rootPath: null,
      subPath: null,
      maxDepth: 4,
    });
  });

  it("readFileContent should call wsl_read_file_content", async () => {
    await commands.readFileContent("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_read_file_content", {
      distro,
      projectPath,
      filePath: "src/foo.ts",
      rootPath: undefined,
    });
  });

  it("writeFileContent should call wsl_write_file_content", async () => {
    await commands.writeFileContent("src/foo.ts", "content");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_write_file_content", {
      distro,
      projectPath,
      filePath: "src/foo.ts",
      content: "content",
      rootPath: undefined,
    });
  });

  it("generateCommitMessage should call wsl_generate_commit_message", async () => {
    await commands.generateCommitMessage("opencode", ["src/foo.ts"], null);
    expect(mockInvoke).toHaveBeenCalledWith("wsl_generate_commit_message", {
      distro,
      projectPath,
      agentId: "opencode",
      agentCommandOverride: null,
      filePaths: ["src/foo.ts"],
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// createRemoteCommands
// ────────────────────────────────────────────────────────────────────────────

describe("createRemoteCommands", () => {
  const host = "192.168.1.100";
  const port = 22;
  const username = "user";
  const auth: { Password: string } = { Password: "secret" };
  const projectPath = "/home/user/project";
  const commands = createRemoteCommands(host, port, username, auth, projectPath);
  const mockInvoke = vi.mocked(invoke);
  const conn = { host, port, username, auth };

  beforeEach(() => mockInvoke.mockClear());

  it("refreshGitInfo should call refresh_remote_git_info with all SSH params", async () => {
    await commands.refreshGitInfo();
    expect(mockInvoke).toHaveBeenCalledWith("refresh_remote_git_info", {
      ...conn,
      projectPath,
    });
  });

  it("getAheadBehind should call remote_get_ahead_behind", async () => {
    await commands.getAheadBehind();
    expect(mockInvoke).toHaveBeenCalledWith("remote_get_ahead_behind", {
      ...conn,
      projectPath,
    });
  });

  it("stageFiles should call remote_stage_files with all SSH params", async () => {
    await commands.stageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("remote_stage_files", {
      ...conn,
      projectPath,
      filePaths: ["src/foo.ts"],
    });
  });

  it("unstageFiles should call remote_unstage_files", async () => {
    await commands.unstageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("remote_unstage_files", {
      ...conn,
      projectPath,
      filePaths: ["src/foo.ts"],
    });
  });

  it("discardFile should call remote_discard_file", async () => {
    await commands.discardFile("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("remote_discard_file", {
      ...conn,
      projectPath,
      filePath: "src/foo.ts",
    });
  });

  it("commitFiles should call remote_commit_files", async () => {
    await commands.commitFiles(["src/foo.ts"], "feat: remote commit");
    expect(mockInvoke).toHaveBeenCalledWith("remote_commit_files", {
      ...conn,
      projectPath,
      filePaths: ["src/foo.ts"],
      message: "feat: remote commit",
    });
  });

  it("fetch should call remote_fetch", async () => {
    await commands.fetch();
    expect(mockInvoke).toHaveBeenCalledWith("remote_fetch", { ...conn, projectPath });
  });

  it("pull should call remote_pull", async () => {
    await commands.pull();
    expect(mockInvoke).toHaveBeenCalledWith("remote_pull", { ...conn, projectPath });
  });

  it("push should default setUpstream to false", async () => {
    await commands.push();
    expect(mockInvoke).toHaveBeenCalledWith("remote_push", {
      ...conn,
      projectPath,
      setUpstream: false,
    });
  });

  it("push should pass setUpstream=true when provided", async () => {
    await commands.push(true);
    expect(mockInvoke).toHaveBeenCalledWith("remote_push", {
      ...conn,
      projectPath,
      setUpstream: true,
    });
  });

  it("checkoutBranch should call remote_checkout_branch (already implemented)", async () => {
    await commands.checkoutBranch("main");
    expect(mockInvoke).toHaveBeenCalledWith("remote_checkout_branch", {
      ...conn,
      projectPath,
      branchName: "main",
    });
  });

  it("createBranch should call remote_create_branch (already implemented)", async () => {
    await commands.createBranch("feature/new");
    expect(mockInvoke).toHaveBeenCalledWith("remote_create_branch", {
      ...conn,
      projectPath,
      branchName: "feature/new",
    });
  });

  it("deleteBranch should call remote_delete_branch", async () => {
    await commands.deleteBranch("old-branch");
    expect(mockInvoke).toHaveBeenCalledWith("remote_delete_branch", {
      ...conn,
      projectPath,
      branchName: "old-branch",
    });
  });

  it("getCommitLog should call remote_get_commit_log with count and skip", async () => {
    await commands.getCommitLog(50, 0);
    expect(mockInvoke).toHaveBeenCalledWith("remote_get_commit_log", {
      ...conn,
      projectPath,
      count: 50,
      skip: 0,
    });
  });

  it("getCommitDetail should call remote_get_commit_detail", async () => {
    await commands.getCommitDetail("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("remote_get_commit_detail", {
      ...conn,
      projectPath,
      commitHash: "abc123",
    });
  });

  it("getCommitFiles should call remote_get_commit_files", async () => {
    await commands.getCommitFiles("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("remote_get_commit_files", {
      ...conn,
      projectPath,
      commitHash: "abc123",
    });
  });

  it("getCommitFileDiff should call remote_get_commit_file_diff", async () => {
    await commands.getCommitFileDiff("abc123", "src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("remote_get_commit_file_diff", {
      ...conn,
      projectPath,
      commitHash: "abc123",
      filePath: "src/foo.ts",
    });
  });

  it("cherryPick should call remote_cherry_pick", async () => {
    await commands.cherryPick("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("remote_cherry_pick", {
      ...conn,
      projectPath,
      commitHash: "abc123",
    });
  });

  it("revert should call remote_revert", async () => {
    await commands.revert("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("remote_revert", {
      ...conn,
      projectPath,
      commitHash: "abc123",
    });
  });

  it("createTag should call remote_create_tag", async () => {
    await commands.createTag("v2.0.0", "Release");
    expect(mockInvoke).toHaveBeenCalledWith("remote_create_tag", {
      ...conn,
      projectPath,
      tagName: "v2.0.0",
      message: "Release",
    });
  });

  it("readDirTree should call remote_read_dir_tree", async () => {
    await commands.readDirTree();
    expect(mockInvoke).toHaveBeenCalledWith("remote_read_dir_tree", {
      ...conn,
      projectPath,
      rootPath: null,
      subPath: null,
      maxDepth: 4,
    });
  });

  it("readFileContent should call remote_read_file_content", async () => {
    await commands.readFileContent("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("remote_read_file_content", {
      ...conn,
      projectPath,
      filePath: "src/foo.ts",
      rootPath: undefined,
    });
  });

  it("writeFileContent should call remote_write_file_content", async () => {
    await commands.writeFileContent("src/foo.ts", "content");
    expect(mockInvoke).toHaveBeenCalledWith("remote_write_file_content", {
      ...conn,
      projectPath,
      filePath: "src/foo.ts",
      content: "content",
      rootPath: undefined,
    });
  });

  it("generateCommitMessage should call remote_generate_commit_message", async () => {
    await commands.generateCommitMessage("opencode", ["src/foo.ts"], null);
    expect(mockInvoke).toHaveBeenCalledWith("remote_generate_commit_message", {
      ...conn,
      projectPath,
      agentId: "opencode",
      agentCommandOverride: null,
      filePaths: ["src/foo.ts"],
    });
  });
});
