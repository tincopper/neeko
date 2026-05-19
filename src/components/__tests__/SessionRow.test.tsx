import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SessionRow from "../project/SessionRow";

describe("SessionRow", () => {
  it("渲染 label 与 branch 双行", () => {
    render(<SessionRow kind="local" label="local" branch="enhance/setting_panel" />);
    expect(screen.getByText("local")).toBeInTheDocument();
    expect(screen.getByText("enhance/setting_panel")).toBeInTheDocument();
  });

  it("点击触发 onClick", () => {
    const onClick = vi.fn();
    render(<SessionRow kind="local" label="local" onClick={onClick} />);
    fireEvent.click(screen.getByText("local"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("active + ahead > 0 时渲染 ↑N", () => {
    render(<SessionRow kind="local" label="local" isActive ahead={208} />);
    expect(screen.getByText("↑208")).toBeInTheDocument();
  });

  it("非 active 时即使 ahead > 0 也不渲染 ↑N（仅 active 行展示）", () => {
    render(<SessionRow kind="local" label="local" ahead={208} />);
    expect(screen.queryByText("↑208")).toBeNull();
  });

  it("changes 不论 active 都渲染 +A -D", () => {
    render(
      <SessionRow
        kind="local"
        label="local"
        changes={{ add: 41565, del: 7182 }}
      />,
    );
    expect(screen.getByText("+41565")).toBeInTheDocument();
    expect(screen.getByText("-7182")).toBeInTheDocument();
  });

  it("active + shortcut 时渲染 ⌘N", () => {
    render(<SessionRow kind="local" label="local" isActive shortcut="⌘1" />);
    expect(screen.getByText("⌘1")).toBeInTheDocument();
  });

  it("非 active 时即使有 shortcut 也不渲染 ⌘N", () => {
    render(<SessionRow kind="local" label="local" shortcut="⌘1" />);
    expect(screen.queryByText("⌘1")).toBeNull();
  });

  it("worktree kind 渲染 trailing 节点", () => {
    render(
      <SessionRow
        kind="worktree"
        label="feature-a"
        branch="feature/a"
        trailing={<span data-testid="trailing">x</span>}
      />,
    );
    expect(screen.getByTestId("trailing")).toBeInTheDocument();
  });
});
