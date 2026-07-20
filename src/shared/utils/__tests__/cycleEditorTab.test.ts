import { describe, it, expect } from "vitest";
import { resolveNextTabId } from "../cycleEditorTab";

describe("resolveNextTabId", () => {
  it("should_reach_first_tab_when_going_prev_from_second", () => {
    const next = resolveNextTabId({
      tabIds: ["t0", "t1", "t2"],
      activeTabId: "t1",
      layout: {
        activeGroupId: "left",
        groups: {
          left: { tabIds: ["t0", "t1", "t2"], activeTabId: "t1" },
          right: { tabIds: [], activeTabId: null },
        },
      },
      direction: -1,
    });
    expect(next).toBe("t0");
  });

  it("should_wrap_from_first_to_last_on_prev", () => {
    const next = resolveNextTabId({
      tabIds: ["t0", "t1", "t2"],
      activeTabId: "t0",
      layout: {
        activeGroupId: "left",
        groups: {
          left: { tabIds: ["t0", "t1", "t2"], activeTabId: "t0" },
        },
      },
      direction: -1,
    });
    expect(next).toBe("t2");
  });

  it("should_prefer_group_active_over_stale_project_active", () => {
    // project active says t2, but tab bar highlights t1
    const next = resolveNextTabId({
      tabIds: ["t0", "t1", "t2"],
      activeTabId: "t2",
      layout: {
        activeGroupId: "left",
        groups: {
          left: { tabIds: ["t0", "t1", "t2"], activeTabId: "t1" },
        },
      },
      direction: -1,
    });
    expect(next).toBe("t0");
  });

  it("should_include_orphan_tabs_missing_from_layout_groups", () => {
    const next = resolveNextTabId({
      tabIds: ["t0", "t1", "t2"],
      activeTabId: "t1",
      layout: {
        activeGroupId: "left",
        groups: {
          // t0 missing from layout (drift) — still reachable after heal
          left: { tabIds: ["t1", "t2"], activeTabId: "t1" },
        },
      },
      direction: 1,
    });
    // from t1 → t2, then next would wrap; first prev from t1 after heal order [t1,t2,t0]
    expect(next).toBe("t2");
    const toFirst = resolveNextTabId({
      tabIds: ["t0", "t1", "t2"],
      activeTabId: "t1",
      layout: {
        activeGroupId: "left",
        groups: {
          left: { tabIds: ["t1", "t2"], activeTabId: "t1" },
        },
      },
      direction: -1,
    });
    // ordered [t1, t2, t0], from t1 prev → t0
    expect(toFirst).toBe("t0");
  });

  it("should_return_null_for_empty_tabs", () => {
    expect(
      resolveNextTabId({
        tabIds: [],
        activeTabId: null,
        direction: 1,
      }),
    ).toBeNull();
  });
});
