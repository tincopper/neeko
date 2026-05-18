import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ProjectGroup from "../project/ProjectGroup";

function setup(overrides: Partial<React.ComponentProps<typeof ProjectGroup>> = {}) {
  const onToggle = vi.fn();
  const props: React.ComponentProps<typeof ProjectGroup> = {
    name: "neeko",
    sessionCount: 3,
    expanded: true,
    actions: { onToggle, ...overrides.actions },
    ...overrides,
  };
  render(<ProjectGroup {...props}>{props.children}</ProjectGroup>);
  return { onToggle };
}

describe("ProjectGroup header", () => {
  it("渲染项目名与会话数 (N)", () => {
    setup({ sessionCount: 2 });
    expect(screen.getByText("neeko")).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("渲染基于 name 派生的字母 avatar", () => {
    setup({ name: "neeko" });
    expect(screen.getByText("N")).toBeInTheDocument();
  });

  it("点击 header 主体触发 onToggle", () => {
    const { onToggle } = setup();
    fireEvent.click(screen.getByTestId("project-group-header"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("展开时渲染 children；折叠时隐藏 children", () => {
    const { rerender } = render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded
        actions={{ onToggle: vi.fn() }}
      >
        <span data-testid="session-child">child</span>
      </ProjectGroup>,
    );
    expect(screen.getByTestId("session-child")).toBeInTheDocument();

    rerender(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded={false}
        actions={{ onToggle: vi.fn() }}
      >
        <span data-testid="session-child">child</span>
      </ProjectGroup>,
    );
    expect(screen.queryByTestId("session-child")).toBeNull();
  });
});

describe("ProjectGroup hover actions", () => {
  it("提供 onAddWorktree 时渲染 + 按钮，点击不触发 onToggle 但触发 callback", () => {
    const onToggle = vi.fn();
    const onAddWorktree = vi.fn();
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded
        actions={{ onToggle, onAddWorktree }}
      />,
    );
    fireEvent.click(screen.getByTitle("New Worktree"));
    expect(onAddWorktree).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("提供 onOpenIde / onGitMenu / onRemove 时渲染对应按钮且独立触发", () => {
    const onOpenIde = vi.fn();
    const onGitMenu = vi.fn();
    const onRemove = vi.fn();
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded
        actions={{
          onToggle: vi.fn(),
          onOpenIde,
          onGitMenu,
          onRemove,
        }}
      />,
    );
    fireEvent.click(screen.getByTitle("Open in IDE"));
    fireEvent.click(screen.getByTitle("Git actions"));
    fireEvent.click(screen.getByTitle("Remove project"));
    expect(onOpenIde).toHaveBeenCalledTimes(1);
    expect(onGitMenu).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("未提供回调时不渲染对应按钮", () => {
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded
        actions={{ onToggle: vi.fn() }}
      />,
    );
    expect(screen.queryByTitle("Open in IDE")).toBeNull();
    expect(screen.queryByTitle("Git actions")).toBeNull();
    expect(screen.queryByTitle("Remove project")).toBeNull();
    expect(screen.queryByTitle("New Worktree")).toBeNull();
  });

  it("Chevron 按钮独立触发 onToggle", () => {
    const onToggle = vi.fn();
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded
        actions={{ onToggle }}
      />,
    );
    fireEvent.click(screen.getByTitle("Collapse"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("expanded=false 时 Chevron title=Expand", () => {
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded={false}
        actions={{ onToggle: vi.fn() }}
      />,
    );
    expect(screen.getByTitle("Expand")).toBeInTheDocument();
  });
});

describe("ProjectGroup right-click", () => {
  it("提供 onContextMenu 时右键触发回调", () => {
    const onContextMenu = vi.fn();
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded
        actions={{ onToggle: vi.fn(), onContextMenu }}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId("project-group-header"));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });
});
