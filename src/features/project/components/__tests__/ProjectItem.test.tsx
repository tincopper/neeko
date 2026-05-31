import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import ProjectItem from "@/features/project/components/ProjectItem";
import type { Project } from '@/shared/types';
import type { ProjectItemActions } from "@/features/project/components/projectItemTypes";

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-1",
    name: "neeko",
    path: "/tmp/neeko",
    git_info: {
      current_branch: "main",
      branches: ["main", "feature/a"],
      worktrees: [
        {
          path: "/tmp/neeko-worktrees/feature-a",
          branch: "feature/a",
          head: "abc",
        },
      ],
      changed_files: [
        {
          path: "src/App.tsx",
          status: "Modified",
          additions: 3,
          deletions: 1,
        },
      ],
      is_clean: false,
    },
    terminal: {
      id: "t-1",
      pid: null,
      status: "Idle",
      history: [],
      agent: null,
    },
    selected_agent: null,
    selected_ide: null,
    active_view: "Terminal",
    collapsed: false,
    ...overrides,
  };
}

function createActions(
  overrides: Partial<ProjectItemActions> = {},
): ProjectItemActions {
  return {
    onSelectProject: vi.fn(),
    onRemoveProject: vi.fn(),
    onSelectFile: vi.fn(),
    onRefreshGit: vi.fn(),
    onBackToMainTerminal: vi.fn(),
    onOpenDialog: vi.fn(),
    ...overrides,
  };
}

describe("ProjectItem", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("点击组头只切换折叠状态，不触发项目选中", () => {
    const project = createProject({ collapsed: true });
    const onSelectProject = vi.fn();
    const actions = createActions({ onSelectProject });

    render(
      <ProjectItem
        project={project}
        isActive={false}
        actions={actions}
      />,
    );

    expect(screen.queryByText("local")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("neeko"));

    expect(screen.getByText("local")).toBeInTheDocument();
    expect(onSelectProject).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith("set_project_collapsed", {
      projectId: "p-1",
      collapsed: false,
    });
  });

  it("点击 local 行触发主项目选中", () => {
    const project = createProject();
    const onSelectProject = vi.fn();
    const actions = createActions({ onSelectProject });

    render(
      <ProjectItem
        project={project}
        isActive={false}
        actions={actions}
      />,
    );

    fireEvent.click(screen.getByText("local"));

    expect(onSelectProject).toHaveBeenCalledWith("p-1");
  });

  it("点击 worktree 行触发 worktree terminal 打开", () => {
    const project = createProject();
    const onOpenWorktreeTerminal = vi.fn();
    const actions = createActions({ onOpenWorktreeTerminal });

    render(
      <ProjectItem
        project={project}
        isActive={false}
        actions={actions}
      />,
    );

    fireEvent.click(screen.getByText("feature-a"));

    expect(onOpenWorktreeTerminal).toHaveBeenCalledWith(
      "p-1",
      "/tmp/neeko-worktrees/feature-a",
      "feature/a",
    );
  });

  it("非 Git 项目仍显示 local 行且不显示分支徽标", () => {
    const project = createProject({ git_info: null });
    const actions = createActions();

    render(
      <ProjectItem
        project={project}
        isActive={false}
        actions={actions}
      />,
    );

    expect(screen.getByText("local")).toBeInTheDocument();
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });
});
