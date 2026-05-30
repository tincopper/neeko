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

  it("refreshGitInfo should call get_git_info", async () => {
    await commands.refreshGitInfo();
    expect(mockInvoke).toHaveBeenCalledWith("get_git_info", tp());
  });

  it("getAheadBehind should call get_ahead_behind", async () => {
    await commands.getAheadBehind();
    expect(mockInvoke).toHaveBeenCalledWith("get_ahead_behind", tp());
  });

  it("stageFiles should call stage_files with filePaths", async () => {
    await commands.stageFiles(["src/foo.ts", "src/bar.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("stage_files", {
      ...tp(),
      filePaths: ["src/foo.ts", "src/bar.ts"],
    });
  });

  it("unstageFiles should call unstage_files", async () => {
    await commands.unstageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("unstage_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
    });
  });

  it("discardFile should call discard_file", async () => {
    await commands.discardFile("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("discard_file", {
      ...tp(),
      filePath: "src/foo.ts",
    });
  });

  it("commitFiles should call commit_files with message", async () => {
    await commands.commitFiles(["src/foo.ts"], "feat: add feature");
    expect(mockInvoke).toHaveBeenCalledWith("commit_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
      message: "feat: add feature",
    });
  });

  it("fetch should call fetch", async () => {
    await commands.fetch();
    expect(mockInvoke).toHaveBeenCalledWith("fetch", tp());
  });

  it("pull should call pull", async () => {
    await commands.pull();
    expect(mockInvoke).toHaveBeenCalledWith("pull", tp());
  });

  it("push should default setUpstream to false", async () => {
    await commands.push();
    expect(mockInvoke).toHaveBeenCalledWith("push", { ...tp(), setUpstream: false });
  });

  it("push should pass setUpstream=true when provided", async () => {
    await commands.push(true);
    expect(mockInvoke).toHaveBeenCalledWith("push", { ...tp(), setUpstream: true });
  });

  it("checkoutBranch should call checkout_branch", async () => {
    await commands.checkoutBranch("feature/new-ui");
    expect(mockInvoke).toHaveBeenCalledWith("checkout_branch", {
      ...tp(),
      branchName: "feature/new-ui",
    });
  });

  it("createBranch should call create_branch", async () => {
    await commands.createBranch("feature/new-ui", "main");
    expect(mockInvoke).toHaveBeenCalledWith("create_branch", {
      ...tp(),
      branchName: "feature/new-ui",
      startPoint: "main",
    });
  });

  it("deleteBranch should call delete_branch", async () => {
    await commands.deleteBranch("feature/old");
    expect(mockInvoke).toHaveBeenCalledWith("delete_branch", {
      ...tp(),
      branchName: "feature/old",
    });
  });

  it("getCommitLog should call get_commit_log", async () => {
    await commands.getCommitLog(50, 100);
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_log", {
      ...tp(),
      count: 50,
      skip: 100,
    });
  });

  it("getCommitDetail should call get_commit_detail", async () => {
    await commands.getCommitDetail("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_detail", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("getCommitFiles should call get_commit_files", async () => {
    await commands.getCommitFiles("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_files", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("getCommitFileDiff should call get_commit_file_diff", async () => {
    await commands.getCommitFileDiff("abc123", "src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("get_commit_file_diff", {
      ...tp(),
      commitHash: "abc123",
      filePath: "src/foo.ts",
    });
  });

  it("cherryPick should call cherry_pick", async () => {
    await commands.cherryPick("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("cherry_pick", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("revert should call revert", async () => {
    await commands.revert("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("revert", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("createTag should call create_tag", async () => {
    await commands.createTag("v1.0.0", "Release v1.0.0");
    expect(mockInvoke).toHaveBeenCalledWith("create_tag", {
      ...tp(),
      tagName: "v1.0.0",
      message: "Release v1.0.0",
    });
  });

  it("readDirTree (Local) should call read_dir_tree with transport", async () => {
    await commands.readDirTree();
    expect(mockInvoke).toHaveBeenCalledWith("read_dir_tree", {
      transport: { Local: { project_path: "/home/user/project" } },
      rootPath: null,
      subPath: null,
      maxDepth: 4,
    });
  });

  it("readFileContent (Local) should call read_file_content", async () => {
    await commands.readFileContent("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("read_file_content", {
      transport: { Local: { project_path: "/home/user/project" } },
      filePath: "src/foo.ts",
      rootPath: undefined,
    });
  });

  it("writeFileContent (Local) should call write_file_content", async () => {
    await commands.writeFileContent("src/foo.ts", "const x = 1;");
    expect(mockInvoke).toHaveBeenCalledWith("write_file_content", {
      transport: { Local: { project_path: "/home/user/project" } },
      filePath: "src/foo.ts",
      content: "const x = 1;",
      rootPath: undefined,
    });
  });

  it("generateCommitMessage (Local) should call generate_commit_message", async () => {
    await commands.generateCommitMessage("opencode", ["src/foo.ts"], null);
    expect(mockInvoke).toHaveBeenCalledWith("generate_commit_message", {
      transport: { Local: { project_path: "/home/user/project" } },
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

  it("refreshGitInfo should call get_git_info with WSL transport", async () => {
    await commands.refreshGitInfo();
    expect(mockInvoke).toHaveBeenCalledWith("get_git_info", tp());
  });

  it("stageFiles should call stage_files", async () => {
    await commands.stageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("stage_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
    });
  });

  it("commitFiles should call commit_files", async () => {
    await commands.commitFiles(["src/foo.ts"], "feat: commit");
    expect(mockInvoke).toHaveBeenCalledWith("commit_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
      message: "feat: commit",
    });
  });

  it("pull should call pull", async () => {
    await commands.pull();
    expect(mockInvoke).toHaveBeenCalledWith("pull", tp());
  });

  it("push should call push", async () => {
    await commands.push();
    expect(mockInvoke).toHaveBeenCalledWith("push", { ...tp(), setUpstream: false });
  });

  it("cherryPick should call cherry_pick", async () => {
    await commands.cherryPick("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("cherry_pick", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("revert should call revert", async () => {
    await commands.revert("abc123");
    expect(mockInvoke).toHaveBeenCalledWith("revert", {
      ...tp(),
      commitHash: "abc123",
    });
  });

  it("createTag should call create_tag", async () => {
    await commands.createTag("v1.0.0", "msg");
    expect(mockInvoke).toHaveBeenCalledWith("create_tag", {
      ...tp(),
      tagName: "v1.0.0",
      message: "msg",
    });
  });

  it("readDirTree (WSL) should call read_dir_tree with transport", async () => {
    await commands.readDirTree();
    expect(mockInvoke).toHaveBeenCalledWith("read_dir_tree", {
      transport: { Wsl: { distro: "Ubuntu-22.04", project_path: "/home/user/project" } },
      rootPath: null,
      subPath: null,
      maxDepth: 4,
    });
  });

  it("readFileContent (WSL) should call read_file_content", async () => {
    await commands.readFileContent("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("read_file_content", {
      transport: { Wsl: { distro: "Ubuntu-22.04", project_path: "/home/user/project" } },
      filePath: "src/foo.ts",
      rootPath: undefined,
    });
  });

  it("writeFileContent (WSL) should call write_file_content", async () => {
    await commands.writeFileContent("src/foo.ts", "content");
    expect(mockInvoke).toHaveBeenCalledWith("write_file_content", {
      transport: { Wsl: { distro: "Ubuntu-22.04", project_path: "/home/user/project" } },
      filePath: "src/foo.ts",
      content: "content",
      rootPath: undefined,
    });
  });

  it("generateCommitMessage (WSL) should call generate_commit_message", async () => {
    await commands.generateCommitMessage("opencode", ["src/foo.ts"], null);
    expect(mockInvoke).toHaveBeenCalledWith("generate_commit_message", {
      transport: { Wsl: { distro: "Ubuntu-22.04", project_path: "/home/user/project" } },
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

  it("refreshGitInfo should call get_git_info with Remote transport", async () => {
    await commands.refreshGitInfo();
    expect(mockInvoke).toHaveBeenCalledWith("get_git_info", tp());
  });

  it("stageFiles should call stage_files", async () => {
    await commands.stageFiles(["src/foo.ts"]);
    expect(mockInvoke).toHaveBeenCalledWith("stage_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
    });
  });

  it("commitFiles should call commit_files", async () => {
    await commands.commitFiles(["src/foo.ts"], "feat: commit");
    expect(mockInvoke).toHaveBeenCalledWith("commit_files", {
      ...tp(),
      filePaths: ["src/foo.ts"],
      message: "feat: commit",
    });
  });

  it("pull should call pull", async () => {
    await commands.pull();
    expect(mockInvoke).toHaveBeenCalledWith("pull", tp());
  });

  it("push should call push", async () => {
    await commands.push();
    expect(mockInvoke).toHaveBeenCalledWith("push", { ...tp(), setUpstream: false });
  });

  it("readDirTree (Remote) should call read_dir_tree with transport", async () => {
    await commands.readDirTree();
    expect(mockInvoke).toHaveBeenCalledWith("read_dir_tree", {
      transport: {
        Remote: {
          host: "192.168.1.100",
          port: 22,
          username: "user",
          auth: { Password: "secret" },
          project_path: "/home/user/project",
        },
      },
      rootPath: null,
      subPath: null,
      maxDepth: 4,
    });
  });

  it("readFileContent (Remote) should call read_file_content", async () => {
    await commands.readFileContent("src/foo.ts");
    expect(mockInvoke).toHaveBeenCalledWith("read_file_content", {
      transport: {
        Remote: {
          host: "192.168.1.100",
          port: 22,
          username: "user",
          auth: { Password: "secret" },
          project_path: "/home/user/project",
        },
      },
      filePath: "src/foo.ts",
      rootPath: undefined,
    });
  });

  it("writeFileContent (Remote) should call write_file_content", async () => {
    await commands.writeFileContent("src/foo.ts", "content");
    expect(mockInvoke).toHaveBeenCalledWith("write_file_content", {
      transport: {
        Remote: {
          host: "192.168.1.100",
          port: 22,
          username: "user",
          auth: { Password: "secret" },
          project_path: "/home/user/project",
        },
      },
      filePath: "src/foo.ts",
      content: "content",
      rootPath: undefined,
    });
  });

  it("generateCommitMessage (Remote) should call generate_commit_message", async () => {
    await commands.generateCommitMessage("opencode", ["src/foo.ts"], null);
    expect(mockInvoke).toHaveBeenCalledWith("generate_commit_message", {
      transport: {
        Remote: {
          host: "192.168.1.100",
          port: 22,
          username: "user",
          auth: { Password: "secret" },
          project_path: "/home/user/project",
        },
      },
      agentId: "opencode",
      agentCommandOverride: null,
      filePaths: ["src/foo.ts"],
    });
  });
});
