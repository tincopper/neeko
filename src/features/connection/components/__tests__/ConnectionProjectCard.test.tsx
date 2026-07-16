import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import ConnectionProjectCard from "@/features/connection/components/ConnectionProjectCard";
import { useWorktreeStore } from "@/features/project/worktreeStore";
import { useGitStore } from "@/features/git/store";
import type { WSLProject } from '@/shared/types';

function makeWslProject(overrides: Partial<WSLProject> = {}): WSLProject {
  return {
    id: "wsl-p1",
    name: "demo",
    path: "/home/user/demo",
    distro: "Ubuntu",
    entry_id: "entry-1",
    selected_agent: null,
    selected_ide: null,
    git_info: {
      current_branch: "main",
      branches: ["main"],
      worktrees: [
        {
          path: "/home/user/wts/feature-x",
          branch: "feature/x",
          head: "abc",
        },
      ],
      changed_files: [
        { path: "src/A.tsx", status: "Modified", additions: 4, deletions: 1 },
      ],
      is_clean: false,
    },
    ...overrides,
  };
}

describe("ConnectionProjectCard (WSL)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue([]);
    // reset store
    useWorktreeStore.setState({
      activeWslWorktreePath: null,
      activeRemoteWorktreePath: null,
    });
    useGitStore.setState({
      aheadBehind: {},
    });
  });

  it("展开后渲染 local 主终端行（branch + 聚合 +A -D）和 worktree 行", () => {
    const project = makeWslProject();
    render(
      <ConnectionProjectCard
        project={project}
        entryId="entry-1"
        source={{ type: "wsl", distro: "Ubuntu" }}
        isActive={false}
        onSelectProject={vi.fn()}
        onRemoveProject={vi.fn()}
      />,
    );

    // git_info 存在 → 自动展开
    expect(screen.getByText("local")).toBeInTheDocument();
    // worktree 目录名
    expect(screen.getByText("feature-x")).toBeInTheDocument();
    // local 行 changed_files 聚合：+4 -1
    expect(screen.getByText("+4")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("点击 local 行触发 onSelectProject (传入 distro + project)", () => {
    const project = makeWslProject();
    const onSelectProject = vi.fn();
    render(
      <ConnectionProjectCard
        project={project}
        entryId="entry-1"
        source={{ type: "wsl", distro: "Ubuntu" }}
        isActive={false}
        onSelectProject={onSelectProject}
        onRemoveProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("local"));
    expect(onSelectProject).toHaveBeenCalledWith(project.id);
  });

  it("点击 worktree 行触发 onOpenWorktreeTerminal (传入 distro)", () => {
    const project = makeWslProject();
    const onOpenWorktreeTerminal = vi.fn();
    render(
      <ConnectionProjectCard
        project={project}
        entryId="entry-1"
        source={{ type: "wsl", distro: "Ubuntu" }}
        isActive={false}
        onSelectProject={vi.fn()}
        onRemoveProject={vi.fn()}
        onOpenWorktreeTerminal={onOpenWorktreeTerminal}
      />,
    );

    fireEvent.click(screen.getByText("feature-x"));
    expect(onOpenWorktreeTerminal).toHaveBeenCalledWith(
      "Ubuntu",
      "/home/user/wts/feature-x",
      "feature/x",
    );
  });

  it("active + 无 active worktree 时 local 行显示 ↑N（来自 store 的 aheadBehind）", () => {
    const project = makeWslProject();
    useGitStore.setState({
      aheadBehind: { "wsl:Ubuntu:wsl-p1": { ahead: 3, behind: 0 } },
    });
    render(
      <ConnectionProjectCard
        project={project}
        entryId="entry-1"
        source={{ type: "wsl", distro: "Ubuntu" }}
        isActive
        onSelectProject={vi.fn()}
        onRemoveProject={vi.fn()}
      />,
    );

    expect(screen.getByText("↑3")).toBeInTheDocument();
  });

  it("active worktree 与 isActive 都成立时 local 行不显示 ↑N", () => {
    const project = makeWslProject();
    useWorktreeStore.setState({
      activeWorktreePath: "/home/user/wts/feature-x",
    });
    useGitStore.setState({
      aheadBehind: { "wsl:Ubuntu:wsl-p1": { ahead: 3, behind: 0 } },
    });
    render(
      <ConnectionProjectCard
        project={project}
        entryId="entry-1"
        source={{ type: "wsl", distro: "Ubuntu" }}
        isActive
        onSelectProject={vi.fn()}
        onRemoveProject={vi.fn()}
      />,
    );

    expect(screen.queryByText("↑3")).toBeNull();
  });
});
