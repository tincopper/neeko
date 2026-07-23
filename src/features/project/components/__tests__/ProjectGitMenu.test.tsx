import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createProject } from "@/testing/factories";

import ProjectGitMenu from "../ProjectGitMenu";

describe("ProjectGitMenu", () => {
  const project = createProject({
    id: "p1",
    name: "demo",
    git_info: {
      current_branch: "main",
      branches: ["main"],
      changed_files: [],
      worktrees: [],
      ahead: 0,
      behind: 0,
      is_dirty: false,
    } as never,
  });

  it("should_render_git_actions_in_portal_menu_when_open", async () => {
    const user = userEvent.setup();
    const setOpen = vi.fn();
    const onCommit = vi.fn();
    const onPush = vi.fn();
    const onPull = vi.fn();
    const onOpenDialog = vi.fn();

    render(
      <ProjectGitMenu
        project={project}
        open={false}
        setOpen={setOpen}
        trigger={<span>Git</span>}
        onCommit={onCommit}
        onPush={onPush}
        onPull={onPull}
        onOpenDialog={onOpenDialog}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Git actions/i }));
    // Controlled open: parent would set open=true; simulate by re-render
  });

  it("should_call_commit_and_close_when_selecting_commit", async () => {
    const user = userEvent.setup();
    let open = true;
    const setOpen = vi.fn((v: boolean | ((p: boolean) => boolean)) => {
      open = typeof v === "function" ? v(open) : v;
    });
    const onCommit = vi.fn();
    const onOpenDialog = vi.fn();

    const { rerender } = render(
      <ProjectGitMenu
        project={project}
        open={open}
        setOpen={setOpen}
        trigger={<span>Git</span>}
        onCommit={onCommit}
        onPush={vi.fn()}
        onPull={vi.fn()}
        onOpenDialog={onOpenDialog}
      />,
    );

    expect(screen.getByTestId("project-git-menu")).toBeInTheDocument();
    await user.click(screen.getByText("Commit Changes"));
    expect(onCommit).toHaveBeenCalledWith("p1");

    // Re-render closed state after setOpen(false)
    rerender(
      <ProjectGitMenu
        project={project}
        open={false}
        setOpen={setOpen}
        trigger={<span>Git</span>}
        onCommit={onCommit}
        onPush={vi.fn()}
        onPull={vi.fn()}
        onOpenDialog={onOpenDialog}
      />,
    );
    expect(screen.queryByTestId("project-git-menu")).not.toBeInTheDocument();
  });

  it("should_open_new_branch_dialog_from_menu", async () => {
    const user = userEvent.setup();
    const onOpenDialog = vi.fn();
    render(
      <ProjectGitMenu
        project={project}
        open
        setOpen={vi.fn()}
        trigger={<span>Git</span>}
        onCommit={vi.fn()}
        onPush={vi.fn()}
        onPull={vi.fn()}
        onOpenDialog={onOpenDialog}
      />,
    );

    await user.click(screen.getByText("New Branch"));
    expect(onOpenDialog).toHaveBeenCalledWith("new-branch");
  });
});
