import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProjectListFromData } from "@/features/project/hooks/useProjectList";
import type { ProjectEnvironment } from "@/features/project/types";

function proj(id: string, overrides: Partial<{ name: string; path: string; git_info: unknown; selected_agent: string | null; environment?: ProjectEnvironment }> = {}) {
  return {
    id,
    name: overrides.name ?? id,
    path: overrides.path ?? `/tmp/${id}`,
    git_info: overrides.git_info ?? null,
    selected_agent: overrides.selected_agent ?? null,
    environment: overrides.environment ?? { type: "Local" as const },
  };
}

describe("useProjectList", () => {
  it("returns empty for no projects", () => {
    const { result } = renderHook(() =>
      useProjectListFromData([])
    );
    expect(result.current.items).toHaveLength(0);
    expect(result.current.isEmpty).toBe(true);
  });

  it("returns local projects in order", () => {
    const { result } = renderHook(() =>
      useProjectListFromData([proj("p1"), proj("p2")])
    );
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].kind).toBe("local");
    expect(result.current.items[0].id).toBe("p1");
    expect(result.current.items[1].id).toBe("p2");
    expect(result.current.isEmpty).toBe(false);
  });

  it("marks last item with isLast", () => {
    const { result } = renderHook(() =>
      useProjectListFromData([proj("p1"), proj("p2")])
    );
    expect(result.current.items[0].isLast).toBe(false);
    expect(result.current.items[1].isLast).toBe(true);
  });

  it("sets has_git_info based on git_info field", () => {
    const { result } = renderHook(() =>
      useProjectListFromData(
        [proj("p1"), proj("p2", { git_info: {} })],
      )
    );
    expect(result.current.items[0].has_git_info).toBe(false);
    expect(result.current.items[1].has_git_info).toBe(true);
  });

  it("sets selected_agent from project", () => {
    const { result } = renderHook(() =>
      useProjectListFromData(
        [proj("p1", { selected_agent: "agent-1" })],
      )
    );
    expect(result.current.items[0].selected_agent).toBe("agent-1");
  });

  it("includes remote projects via environment field", () => {
    const { result } = renderHook(() =>
      useProjectListFromData([
        proj("local1"),
        proj("rm1", {
          environment: { type: "Remote", host: "server.com", port: 22, username: "user", auth: { Password: "pass" } },
        }),
      ])
    );
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].kind).toBe("local");
    expect(result.current.items[1].kind).toBe("remote");
    expect(result.current.items[1].host).toBe("server.com");
  });
});
