import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConversationItem from "@/features/conversation/components/ConversationItem";
import type { ConversationMeta } from "@/features/conversation/types";
import type { AgentConfig } from "@/features/agent/types";

function createMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: "claude-code:abc123",
    nativeSessionId: "abc123",
    agentId: "claude-code",
    title: "Refactoring the auth module",
    startedAt: Date.now() - 3600000,
    updatedAt: Date.now() - 1800000,
    messageCount: 12,
    preview: "Let me help you refactor the authentication module to use the new API...",
    filePath: "/tmp/project/.neeko/sessions/claude-code/abc123.json",
    projectPath: "/tmp/project",
    userTitle: null,
    tags: [],
    supportsResume: true,
    ...overrides,
  };
}

function createAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    args: [],
    env: {},
    icon: "claude-code.png",
    enabled: true,
    ...overrides,
  };
}

describe("ConversationItem", () => {
  it("renders agent icon and name", () => {
    const meta = createMeta();
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={onView}
        onResume={onResume}
      />,
    );

    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("renders title and message count", () => {
    const meta = createMeta({ title: "Refactoring the auth module", messageCount: 12 });
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={onView}
        onResume={onResume}
      />,
    );

    expect(screen.getByText("Refactoring the auth module")).toBeInTheDocument();
    expect(screen.getByText("12 msgs")).toBeInTheDocument();
  });

  it("applies active left-border styling when active", () => {
    const meta = createMeta();
    const agents = [createAgent()];
    const { container } = render(
      <ConversationItem
        meta={meta}
        agents={agents}
        active
        onView={vi.fn()}
        onResume={vi.fn()}
      />,
    );

    const row = container.querySelector('[role="button"]');
    expect(row?.className).toContain("border-l-accent-blue");
  });

  it("opens View when the whole row is clicked", () => {
    const meta = createMeta();
    const agents = [createAgent()];
    const onView = vi.fn();

    const { container } = render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={onView}
        onResume={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelector('[role="button"]')!);
    expect(onView).toHaveBeenCalledWith(meta);
  });

  it("calls onResume when Resume button is clicked", () => {
    const meta = createMeta();
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={onView}
        onResume={onResume}
      />,
    );

    fireEvent.click(screen.getByTitle("Resume"));
    expect(onResume).toHaveBeenCalledWith(meta);
  });

  it("hides Resume when supportsResume is false", () => {
    const meta = createMeta({ supportsResume: false });
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={onView}
        onResume={onResume}
      />,
    );

    expect(screen.queryByTitle("Resume")).not.toBeInTheDocument();
    expect(screen.getByTitle("View")).toBeInTheDocument();
  });

  it("hides Resume when supportsResume is undefined (legacy payload)", () => {
    const meta = createMeta({ supportsResume: undefined });
    const agents = [createAgent()];

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={vi.fn()}
        onResume={vi.fn()}
      />,
    );

    expect(screen.queryByTitle("Resume")).not.toBeInTheDocument();
  });

  it("calls onView when View button is clicked", () => {
    const meta = createMeta();
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={onView}
        onResume={onResume}
      />,
    );

    fireEvent.click(screen.getByTitle("View"));
    expect(onView).toHaveBeenCalledWith(meta);
  });

  it("falls back to agentId when agent is not found in agents list", () => {
    const meta = createMeta({ agentId: "unknown-agent" });
    const agents: AgentConfig[] = [];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={onView}
        onResume={onResume}
      />,
    );

    expect(screen.getByText("unknown-agent")).toBeInTheDocument();
  });

  it("shows 'just now' for very recent conversations", () => {
    const meta = createMeta({ startedAt: Date.now() - 1000, updatedAt: Date.now() - 1000 });
    const agents = [createAgent()];
    const onView = vi.fn();
    const onResume = vi.fn();

    render(
      <ConversationItem
        meta={meta}
        agents={agents}
        onView={onView}
        onResume={onResume}
      />,
    );

    expect(screen.getByText("just now")).toBeInTheDocument();
  });
});
