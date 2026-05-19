import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import SessionChips from "../project/SessionChips";

describe("SessionChips.Ahead", () => {
  it("ahead > 0 时渲染 ↑N", () => {
    render(<SessionChips.Ahead ahead={208} />);
    expect(screen.getByText("↑208")).toBeInTheDocument();
  });

  it("ahead = 0 时不渲染", () => {
    const { container } = render(<SessionChips.Ahead ahead={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ahead 为负数时不渲染（防御性）", () => {
    const { container } = render(<SessionChips.Ahead ahead={-1} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SessionChips.Changes", () => {
  it("add 与 del 都 > 0 时渲染 +A 与 -D", () => {
    render(<SessionChips.Changes add={41565} del={7182} />);
    expect(screen.getByText("+41565")).toBeInTheDocument();
    expect(screen.getByText("-7182")).toBeInTheDocument();
  });

  it("仅 add > 0 时只渲染 +A", () => {
    render(<SessionChips.Changes add={120} del={0} />);
    expect(screen.getByText("+120")).toBeInTheDocument();
    expect(screen.queryByText(/^-/)).toBeNull();
  });

  it("仅 del > 0 时只渲染 -D", () => {
    render(<SessionChips.Changes add={0} del={9} />);
    expect(screen.getByText("-9")).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("两者均为 0 时不渲染", () => {
    const { container } = render(<SessionChips.Changes add={0} del={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SessionChips.Kbd", () => {
  it("渲染 children 内容", () => {
    render(<SessionChips.Kbd>⌘1</SessionChips.Kbd>);
    expect(screen.getByText("⌘1")).toBeInTheDocument();
  });
});
