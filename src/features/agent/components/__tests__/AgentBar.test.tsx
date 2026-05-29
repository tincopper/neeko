import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import AgentBar from "@/features/agent/components/AgentBar";
import type { AgentConfig } from "@/types";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const mockAgents: AgentConfig[] = [
  { id: "claude", name: "Claude Code", command: "claude", args: [], env: {}, icon: "claude.png", enabled: true },
  { id: "codex", name: "Codex", command: "codex", args: [], env: {}, icon: "codex.png", enabled: true },
  { id: "opencode", name: "OpenCode", command: "opencode", args: [], env: {}, icon: "opencode.png", enabled: false },
];

describe("AgentBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all agents installed
    mockInvoke.mockResolvedValue({
      claude: true,
      codex: true,
      opencode: true,
    });
  });

  it("should render agent buttons", async () => {
    await act(async () => {
      render(
        <AgentBar
          agents={mockAgents}
          selectedAgentId={null}
          onSelectAgent={vi.fn()}
        />
      );
    });

    // Should show enabled agents
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    
    // Should not show disabled agents
    expect(screen.queryByText("OpenCode")).not.toBeInTheDocument();
  });

  it("should call onSelectAgent when clicking an agent button", async () => {
    const handleSelect = vi.fn();
    
    await act(async () => {
      render(
        <AgentBar
          agents={mockAgents}
          selectedAgentId={null}
          onSelectAgent={handleSelect}
        />
      );
    });

    // Click on an agent button
    fireEvent.click(screen.getByText("Claude Code"));

    await waitFor(() => {
      expect(handleSelect).toHaveBeenCalledWith("claude");
    });
  });

  it("should show selected agent as selected", async () => {
    await act(async () => {
      render(
        <AgentBar
          agents={mockAgents}
          selectedAgentId="claude"
          onSelectAgent={vi.fn()}
        />
      );
    });

    const selectedButton = screen.getByText("Claude Code").closest("button");
    expect(selectedButton).toHaveClass("selected");
  });

  it("should render in compact mode", async () => {
    await act(async () => {
      render(
        <AgentBar
          agents={mockAgents}
          selectedAgentId={null}
          compactMode={true}
          onSelectAgent={vi.fn()}
        />
      );
    });

    // In compact mode, buttons should have 'compact' class
    const buttons = screen.getAllByRole("button");
    buttons.forEach((button) => {
      expect(button).toHaveClass("compact");
    });
  });

  it("should show empty state when no enabled agents", async () => {
    await act(async () => {
      render(
        <AgentBar
          agents={[]}
          selectedAgentId={null}
          onSelectAgent={vi.fn()}
        />
      );
    });

    expect(screen.getByText("No enabled agents")).toBeInTheDocument();
  });

  it("should show not-installed state and toast for uninstalled agents", async () => {
    const showToast = vi.fn();
    
    // Mock claude as not installed
    mockInvoke.mockResolvedValue({
      claude: false,
      codex: true,
    });

    await act(async () => {
      render(
        <AgentBar
          agents={mockAgents}
          selectedAgentId={null}
          onSelectAgent={vi.fn()}
          onShowToast={showToast}
        />
      );
    });

    // Wait for installation status to be loaded
    await waitFor(() => {
      const claudeButton = screen.getByText("Claude Code").closest("button");
      expect(claudeButton).toHaveClass("not-installed");
    });

    // Click on not-installed agent should show toast
    fireEvent.click(screen.getByText("Claude Code"));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        "Claude Code (claude) is not installed",
        "error"
      );
    });
  });
});
