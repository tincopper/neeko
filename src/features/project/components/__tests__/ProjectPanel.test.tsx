import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import ProjectPanel from "@/features/settings/components/ProjectPanel";
import { useProjectStore } from "@/features/project/store";
import { AVATAR_COLORS } from "@/shared/utils/projectAvatar";
import type { Project } from '@/shared/types';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "demo",
    path: "/Users/dev/demo",
    git_info: null,
    terminal: { id: "t1", pid: null, status: "Idle", history: [], agent: null },
    selected_agents: [],
    selected_ide: null,
    active_view: "Terminal",
    collapsed: false,
    avatar_color: null,
    ...overrides,
  };
}

describe("ProjectPanel — Appearance section", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue([]);
    useProjectStore.setState({
      projects: [makeProject()],
      activeProjectId: null,
      activeProject: null,
    });
  });

  it("渲染一行 10 个 swatch（使用 AVATAR_COLORS）", () => {
    render(
      <ProjectPanel
        projectId="p1"
        customIdes={[]}
        onProjectRemoved={vi.fn()}
      />,
    );
    const swatches = screen
      .getByTestId("appearance-swatches")
      .querySelectorAll("button[aria-label^='Select avatar color']");
    expect(swatches.length).toBe(AVATAR_COLORS.length);
  });

  it("点击 swatch 触发 set_project_color 并把 store 中 avatar_color 同步为目标色", () => {
    render(
      <ProjectPanel
        projectId="p1"
        customIdes={[]}
        onProjectRemoved={vi.fn()}
      />,
    );
    const target = AVATAR_COLORS[2];
    const btn = screen.getByLabelText(`Select avatar color ${target}`);
    fireEvent.click(btn);

    expect(invoke).toHaveBeenCalledWith("set_project_color", {
      projectId: "p1",
      color: target,
    });
    const next = useProjectStore.getState().projects.find((p) => p.id === "p1");
    expect(next?.avatar_color).toBe(target);
  });

  it("avatar_color 为 null 时不显示 Reset 按钮", () => {
    render(
      <ProjectPanel
        projectId="p1"
        customIdes={[]}
        onProjectRemoved={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("appearance-reset")).toBeNull();
  });

  it("avatar_color 已设置时显示 Reset，点击后调命令传 null 并清空 store", () => {
    useProjectStore.setState({
      projects: [makeProject({ avatar_color: AVATAR_COLORS[0] })],
    });
    render(
      <ProjectPanel
        projectId="p1"
        customIdes={[]}
        onProjectRemoved={vi.fn()}
      />,
    );
    const reset = screen.getByTestId("appearance-reset");
    fireEvent.click(reset);

    expect(invoke).toHaveBeenCalledWith("set_project_color", {
      projectId: "p1",
      color: null,
    });
    const next = useProjectStore.getState().projects.find((p) => p.id === "p1");
    expect(next?.avatar_color).toBeNull();
  });

  it("当前选中色 swatch 带 ring + scale 高亮", () => {
    const target = AVATAR_COLORS[3];
    useProjectStore.setState({
      projects: [makeProject({ avatar_color: target })],
    });
    render(
      <ProjectPanel
        projectId="p1"
        customIdes={[]}
        onProjectRemoved={vi.fn()}
      />,
    );
    const btn = screen.getByLabelText(`Select avatar color ${target}`);
    expect(btn.className).toMatch(/ring-2/);
    expect(btn.className).toMatch(/scale-110/);
  });
});
