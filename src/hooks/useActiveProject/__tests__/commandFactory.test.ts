import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from "@tauri-apps/api/core";
import { createUnifiedCommands } from "../commandFactory";
import type { GitTransportKind } from "../commandFactory";

// ────────────────────────────────────────────────────────────────────────────
// createUnifiedCommands — Local
// ────────────────────────────────────────────────────────────────────────────

describe("createUnifiedCommands (Local)", () => {
  const transport: GitTransportKind = {
    type: "Local",
    projectId: "proj-123",
    projectPath: "/home/user/project",
  };
  const commands = createUnifiedCommands(transport);
  const mockInvoke = vi.mocked(invoke);
  const tp = () => ({ transport: { Local: { project_path: "/home/user/project" } } });

  beforeEach(() => mockInvoke.mockClear());

  it("refreshGitInfo should call unified_get_git_info", async () => {
    await commands.refreshGitInfo();
    expect(mockInvoke).toHaveBeenCalledWith("unified_get_git_info", tp());
  });

  it("getAheadBehind should call unified_get_ahead_behind", async () => {
    await commands.getAheadBehind();
    expect(mockInvoke).toHaveBeenCalledWith("unified_get_ahead_behind", tp());
  });

  it("stageFiles should call unified_stage_files with filePaths", async () => {
    await commands.stageFiles(["src/foo.ts", "src/bar.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("unified_stage_files", {
      ...tp(),
      filePaths: ["src/foo.ts", "src/bar.ts"],
    });
  });

  it("unstageFiles should call unified_unstage_files", async () => {
    await commands.unstageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("unified_unstage_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
    });
  });

  it("discardFile should call unified_discard_file", async () => {
    await commands.discardFile("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("unified_discard_file", {
      ...tp(),
      filePath: "src/foo.ts",
    });
  });

  it("commitFiles should call unified_commit_files with message", async () => {
    await commands.commitFiles(["src/foo.ts"], "feat: add feature");
    expect(mockInvoke).toHaveBeenCalledWith("unified_commit_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
      message: "feat: add feature",
    });
  });

  it("fetch should call unified_fetch", async () => {
    await commands.fetch();
    expect(mockInvoke).toHaveBeenCalledWith("unified_fetch", tp());
  });

  it("pull should call unified_pull", async () => {
    await commands.pull();
    expect(mockInvoke).toHaveBeenCalledWith("unified_pull", tp());
  });

  it("push should default setUpstream to false", async () => {
    await commands.push();
    expect(mockInvoke).toHaveBeenCalledWith("unified_push", { ...tp(), setUpstream: false });
  });

  it("push should pass setUpstream=true when provided", async () => {
    await commands.push(true);
    expect(mockInvoke).toHaveBeenCalledWith("unified_push", { ...tp(), setUpstream: true });
  });

  it("checkoutBranch should call unified_checkout_branch", async () => {
    await commands.checkoutBranch("feature/new-ui");
    expect(mockInvoke).toHaveBeenCalledWith("unified_checkout_branch", {
      ...tp(),
      branchName: "feature/new-ui",
    });
  });

  it("createBranch should call unified_create_branch", async () => {
    await commands.createBranch("feature/new-ui", "main");
    expect(mockInvoke).toHaveBeenCalledWith("unified_create_branch", {
      ...tp(),
      branchName: "feature/new-ui",
      startPoint: "main",
    });
  });

  it("deleteBranch should call unified_delete_branch", async () => {
    await commands.deleteBranch("feature/old");
    expect(mockInvoke).toHaveBeenCalledWith("unified_delete_branch", {
      ...tp(),
      branchName: "feature/old",
    });
  });

  it("getCommitLog should call unified_get_commit_log", async () => {
    await commands.getCommitLog(50, 100);
    expect(mockInvoke).toHaveBeenCalledWith("unified_get_commit_log", {
      ...tp(),
      count: 50,
      skip: 100,
    });
  });

  it("getCommitDetail should call unified_get_commit_detail", async () => {
    await commands.getCommitDetail("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("unified_get_commit_detail", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("getCommitFiles should call unified_get_commit_files", async () => {
    await commands.getCommitFiles("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("unified_get_commit_files", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("getCommitFileDiff should call unified_get_commit_file_diff", async () => {
    await commands.getCommitFileDiff("abc123", "src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("unified_get_commit_file_diff", {
      ...tp(),
      commitHash: "abc123",
      filePath: "src/foo.ts",
    });
  });

  it("cherryPick should call unified_cherry_pick", async () => {
    await commands.cherryPick("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("unified_cherry_pick", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("revert should call unified_revert", async () => {
    await commands.revert("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("unified_revert", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("createTag should call unified_create_tag", async () => {
    await commands.createTag("v1.0.0", "Release v1.0.0");
    expect(mockInvoke).toHaveBeenCalledWith("unified_create_tag", {
      ...tp(),
      tagName: "v1.0.0",
      message: "Release v1.0.0",
    });
  });

  it("readDirTree (Local) should call read_dir_tree with projectId", async () => {
    await commands.readDirTree();
    expect(mockInvoke).toHaveBeenCalledWith("read_dir_tree", {
      projectId: "proj-123",
      rootPath: null,
      subPath: null,
      maxDepth: 4,
    });
  });

  it("readFileContent (Local) should call read_file_content", async () => {
    await commands.readFileContent("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("read_file_content", {
      projectId: "proj-123",
      filePath: "src/foo.ts",
      rootPath: undefined,
    });
  });

  it("writeFileContent (Local) should call write_file_content", async () => {
    await commands.writeFileContent("src/foo.ts", "const x = 1;");
    expect(mockInvoke).toHaveBeenCalledWith("write_file_content", {
      projectId: "proj-123",
      filePath: "src/foo.ts",
      content: "const x = 1;",
      rootPath: undefined,
    });
  });

  it("generateCommitMessage (Local) should call generate_commit_message_command", async () => {
    await commands.generateCommitMessage("opencode", ["src/foo.ts"], null);
    expect(mockInvoke).toHaveBeenCalledWith("generate_commit_message_command", {
      projectId: "proj-123",
      agentId: "opencode",
      agentCommandOverride: null,
      filePaths: ["src/foo.ts"],
    });
  });

  it("should return an object with all 23 ProjectCommands methods", () => {
    const expectedMethods = [
      "refreshGitInfo", "getAheadBehind", "stageFiles", "unstageFiles",
      "discardFile", "commitFiles", "fetch", "pull", "push",
      "checkoutBranch", "createBranch", "deleteBranch",
      "getCommitLog", "getCommitDetail", "getCommitFiles", "getCommitFileDiff",
      "cherryPick", "revert", "createTag",
      "readDirTree", "readFileContent", "writeFileContent", "generateCommitMessage",
    ];
    for (const method of expectedMethods) {
      expect(commands).toHaveProperty(method);
      expect(typeof commands[method as keyof typeof commands]).toBe("function");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// createUnifiedCommands — WSL
// ────────────────────────────────────────────────────────────────────────────

describe("createUnifiedCommands (WSL)", () => {
  const transport: GitTransportKind = {
    type: "Wsl",
    distro: "Ubuntu-22.04",
    projectPath: "/home/user/project",
  };
  const commands = createUnifiedCommands(transport);
  const mockInvoke = vi.mocked(invoke);
  const tp = () => ({ transport: { Wsl: { distro: "Ubuntu-22.04", project_path: "/home/user/project" } } });

  beforeEach(() => mockInvoke.mockClear());

  it("refreshGitInfo should call unified_get_git_info with WSL transport", async () => {
    await commands.refreshGitInfo();
    expect(mockInvoke).toHaveBeenCalledWith("unified_get_git_info", tp());
  });

  it("stageFiles should call unified_stage_files", async () => {
    await commands.stageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("unified_stage_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
    });
  });

  it("commitFiles should call unified_commit_files", async () => {
    await commands.commitFiles(["src/foo.ts"], "feat: commit");
    expect(mockInvoke).toHaveBeenCalledWith("unified_commit_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
      message: "feat: commit",
    });
  });

  it("pull should call unified_pull", async () => {
    await commands.pull();
    expect(mockInvoke).toHaveBeenCalledWith("unified_pull", tp());
  });

  it("push should call unified_push", async () => {
    await commands.push();
    expect(mockInvoke).toHaveBeenCalledWith("unified_push", { ...tp(), setUpstream: false });
  });

  it("cherryPick should call unified_cherry_pick", async () => {
    await commands.cherryPick("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("unified_cherry_pick", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("revert should call unified_revert", async () => {
    await commands.revert("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("unified_revert", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("createTag should call unified_create_tag", async () => {
    await commands.createTag("v1.0.0", "msg");
    expect(mockInvoke).toHaveBeenCalledWith("unified_create_tag", {
      ...tp(),
      tagName: "v1.0.0",
      message: "msg",
    });
  });

  it("readDirTree (WSL) should call wsl_read_dir_tree with distro + projectPath", async () => {
    await commands.readDirTree();
    expect(mockInvoke).toHaveBeenCalledWith("wsl_read_dir_tree", {
      distro: "Ubuntu-22.04",
      projectPath: "/home/user/project",
      rootPath: null,
      subPath: null,
      maxDepth: 4,
    });
  });

  it("readFileContent (WSL) should call wsl_read_file_content", async () => {
    await commands.readFileContent("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_read_file_content", {
      distro: "Ubuntu-22.04",
      projectPath: "/home/user/project",
      filePath: "src/foo.ts",
      rootPath: undefined,
    });
  });

  it("writeFileContent (WSL) should call wsl_write_file_content", async () => {
    await commands.writeFileContent("src/foo.ts", "content");
    expect(mockInvoke).toHaveBeenCalledWith("wsl_write_file_content", {
      distro: "Ubuntu-22.04",
      projectPath: "/home/user/project",
      filePath: "src/foo.ts",
      content: "content",
      rootPath: undefined,
    });
  });

  it("generateCommitMessage (WSL) should call wsl_generate_commit_message", async () => {
    await commands.generateCommitMessage("opencode", ["src/foo.ts"], null);
    expect(mockInvoke).toHaveBeenCalledWith("wsl_generate_commit_message", {
      distro: "Ubuntu-22.04",
      projectPath: "/home/user/project",
      agentId: "opencode",
      agentCommandOverride: null,
      filePaths: ["src/foo.ts"],
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// createUnifiedCommands — Remote
// ────────────────────────────────────────────────────────────────────────────

describe("createUnifiedCommands (Remote)", () => {
  const transport: GitTransportKind = {
    type: "Remote",
    host: "192.168.1.100",
    port: 22,
    username: "user",
    auth: { Password: "secret" },
    projectPath: "/home/user/project",
  };
  const commands = createUnifiedCommands(transport);
  const mockInvoke = vi.mocked(invoke);
  const tp = () => ({
    transport: {
      Remote: {
        host: "192.168.1.100",
        port: 22,
        username: "user",
        auth: { Password: "secret" },
        project_path: "/home/user/project",
      },
    },
  });

  beforeEach(() => mockInvoke.mockClear());

  it("refreshGitInfo should call unified_get_git_info with Remote transport", async () => {
    await commands.refreshGitInfo();
    expect(mockInvoke).toHaveBeenCalledWith("unified_get_git_info", tp());
  });

  it("stageFiles should call unified_stage_files", async () => {
    await commands.stageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("unified_stage_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
    });
  });

  it("commitFiles should call unified_commit_files", async () => {
    await commands.commitFiles(["src/foo.ts"], "feat: commit");
    expect(mockInvoke).toHaveBeenCalledWith("unified_commit_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
      message: "feat: commit",
    });
  });

  it("pull should call unified_pull", async () => {
    await commands.pull();
    expect(mockInvoke).toHaveBeenCalledWith("unified_pull", tp());
  });

  it("push should call unified_push", async () => {
    await commands.push();
    expect(mockInvoke).toHaveBeenCalledWith("unified_push", { ...tp(), setUpstream: false });
  });

  it("readDirTree (Remote) should call remote_read_dir_tree with SSH params", async () => {
    await commands.readDirTree();
    expect(mockInvoke).toHaveBeenCalledWith("remote_read_dir_tree", {
      host: "192.168.1.100",
      port: 22,
      username: "user",
      auth: { Password: "secret" },
      projectPath: "/home/user/project",
      rootPath: null,
      subPath: null,
      maxDepth: 4,
    });
  });

  it("readFileContent (Remote) should call remote_read_file_content", async () => {
    await commands.readFileContent("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("remote_read_file_content", {
      host: "192.168.1.100",
      port: 22,
      username: "user",
      auth: { Password: "secret" },
      projectPath: "/home/user/project",
      filePath: "src/foo.ts",
      rootPath: undefined,
    });
  });

  it("writeFileContent (Remote) should call remote_write_file_content", async () => {
    await commands.writeFileContent("src/foo.ts", "content");
    expect(mockInvoke).toHaveBeenCalledWith("remote_write_file_content", {
      host: "192.168.1.100",
      port: 22,
      username: "user",
      auth: { Password: "secret" },
      projectPath: "/home/user/project",
      filePath: "src/foo.ts",
      content: "content",
      rootPath: undefined,
    });
  });

  it("generateCommitMessage (Remote) should call remote_generate_commit_message", async () => {
    await commands.generateCommitMessage("opencode", ["src/foo.ts"], null);
    expect(mockInvoke).toHaveBeenCalledWith("remote_generate_commit_message", {
      host: "192.168.1.100",
      port: 22,
      username: "user",
      auth: { Password: "secret" },
      projectPath: "/home/user/project",
      agentId: "opencode",
      agentCommandOverride: null,
      filePaths: ["src/foo.ts"],
    });
  });
});
