import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import OpenIdeButton from "@/layout/OpenIdeButton";
import { useProjectStore } from "@/features/project/store";
import { useConnectionStore } from "@/features/connection/store";
import type { Project } from "@/types";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function makeProject(partial: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "test-project",
    path: "/tmp/test",
    selected_agent: null,
    selected_ide: "goland",
    git_info: null,
    active_view: "Terminal",
    ...partial,
  } as Project;
}

describe("OpenIdeButton", () => {
  let openIdeSpy: ReturnType<typeof vi.fn>;
  let setProjectIdeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    openIdeSpy = vi.fn();
    setProjectIdeSpy = vi.fn();

    // 让 getIdeCommand 走 macOS 分支，避免 jsdom 默认 platform 影响命令字符串
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });

    // Default: load_config returns empty config
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_config") return {};
      return undefined;
    });

    const project = makeProject();
    useProjectStore.setState({
      projects: [project],
      activeProjectId: project.id,
      activeProject: project,
      openIde: openIdeSpy,
      setProjectIde: setProjectIdeSpy,
    });
    useConnectionStore.setState({
      activeWslProject: null,
      activeRemoteProject: null,
    });
  });

  async function openDropdown() {
    const trigger = screen.getByTitle("Select IDE");
    await act(async () => {
      fireEvent.click(trigger);
    });
  }

  it("行点击 → 调 setProjectIde（持久化），不调 openIde", async () => {
    await act(async () => {
      render(<OpenIdeButton />);
    });
    await openDropdown();

    // 找到 IntelliJ IDEA 行（不是 button，是 div）
    const ideaRow = (await screen.findByText("IntelliJ IDEA")).closest("div");
    expect(ideaRow).not.toBeNull();
    await act(async () => {
      fireEvent.click(ideaRow!);
    });

    expect(setProjectIdeSpy).toHaveBeenCalledWith("p1", "idea");
    expect(openIdeSpy).not.toHaveBeenCalled();
  });

  it("行右侧 ▶ 按钮点击 → 调 openIde（一次性），不调 setProjectIde", async () => {
    await act(async () => {
      render(<OpenIdeButton />);
    });
    await openDropdown();

    const runButton = await screen.findByLabelText("Open IntelliJ IDEA now");
    await act(async () => {
      fireEvent.click(runButton);
    });

    expect(openIdeSpy).toHaveBeenCalledWith({ id: "p1", selected_ide: "idea" });
    expect(setProjectIdeSpy).not.toHaveBeenCalled();
  });

  it("▶ 按钮点击不会冒泡触发行的 setProjectIde", async () => {
    await act(async () => {
      render(<OpenIdeButton />);
    });
    await openDropdown();

    const runButton = await screen.findByLabelText("Open GoLand now");
    await act(async () => {
      fireEvent.click(runButton);
    });

    // 只有 openIde 被调，setProjectIde 因为 stopPropagation 没被调
    expect(openIdeSpy).toHaveBeenCalledTimes(1);
    expect(setProjectIdeSpy).toHaveBeenCalledTimes(0);
  });

  it("主按钮（左侧 IDE 名）点击 → 用当前默认 selected_ide 调 openIde", async () => {
    await act(async () => {
      render(<OpenIdeButton />);
    });

    // 主按钮 title 形如 "Open in IDE (goland)"
    const mainButton = screen.getByTitle("Open in IDE (goland)");
    await act(async () => {
      fireEvent.click(mainButton);
    });

    expect(openIdeSpy).toHaveBeenCalledWith({ id: "p1", selected_ide: "goland" });
    expect(setProjectIdeSpy).not.toHaveBeenCalled();
  });

  it("点行后下拉关闭", async () => {
    await act(async () => {
      render(<OpenIdeButton />);
    });
    await openDropdown();

    expect(screen.queryByText("IntelliJ IDEA")).toBeInTheDocument();

    const ideaRow = (await screen.findByText("IntelliJ IDEA")).closest("div");
    await act(async () => {
      fireEvent.click(ideaRow!);
    });

    await waitFor(() => {
      expect(screen.queryByText("IntelliJ IDEA")).not.toBeInTheDocument();
    });
  });
});
