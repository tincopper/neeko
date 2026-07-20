import { describe, it, expect } from "vitest";
import type { DiscoveredTask, TaskConfig } from "../types";

/** Mirror of store filterDiscovered for pure unit testing. */
function filterDiscovered(
  discovered: DiscoveredTask[],
  configs: TaskConfig[],
): DiscoveredTask[] {
  const saved = new Set(configs.map((c) => c.id));
  return discovered.filter((d) => !saved.has(d.id));
}

describe("filterDiscovered", () => {
  it("should_hide_discovered_when_already_saved_by_id", () => {
    const discovered: DiscoveredTask[] = [
      {
        id: "pkg:dev",
        name: "dev",
        command: "pnpm run dev",
        source: "package_json",
        group: "npm scripts (pnpm)",
        priority: 100,
      },
      {
        id: "pkg:test",
        name: "test",
        command: "pnpm run test",
        source: "package_json",
        group: "npm scripts (pnpm)",
        priority: 90,
      },
    ];
    const configs: TaskConfig[] = [
      {
        id: "pkg:dev",
        name: "dev",
        command: "pnpm run dev",
        scope: "project",
      },
    ];
    const remaining = filterDiscovered(discovered, configs);
    expect(remaining.map((t) => t.id)).toEqual(["pkg:test"]);
  });
});
