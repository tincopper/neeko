import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../editorStore";
import type { Tab } from "../../types";

function makeTab(id: string, kind: "terminal" | "file" = "terminal", overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    type: kind,
    title: `Tab ${id}`,
    data: { kind },
    ...overrides,
  } as Tab;
}

describe("editorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, layout: {} });
  });

  describe("addTab", () => {
    it("adds a tab to a new project", () => {
      const tab = makeTab("t1");
      useEditorStore.getState().addTab("p1", tab);

      const state = useEditorStore.getState();
      expect(state.tabs["p1"]).toBeDefined();
      expect(state.tabs["p1"].tabs).toHaveLength(1);
      expect(state.tabs["p1"].tabs[0].id).toBe("t1");
      expect(state.tabs["p1"].activeTabId).toBe("t1");
    });

    it("appends a tab to an existing project", () => {
      useEditorStore.getState().addTab("p1", makeTab("t1"));
      useEditorStore.getState().addTab("p1", makeTab("t2"));

      const state = useEditorStore.getState();
      expect(state.tabs["p1"].tabs).toHaveLength(2);
      expect(state.tabs["p1"].activeTabId).toBe("t2");
    });

    it("does not duplicate a tab with the same id", () => {
      useEditorStore.getState().addTab("p1", makeTab("t1"));
      useEditorStore.getState().addTab("p1", makeTab("t1", "file"));

      const state = useEditorStore.getState();
      expect(state.tabs["p1"].tabs).toHaveLength(1);
    });
  });

  describe("closeTab", () => {
    it("removes a tab and activates the next", () => {
      useEditorStore.getState().addTab("p1", makeTab("t1"));
      useEditorStore.getState().addTab("p1", makeTab("t2"));
      useEditorStore.getState().addTab("p1", makeTab("t3"));
      useEditorStore.getState().activateTab("p1", "t2");
      useEditorStore.getState().closeTab("p1", "t2");

      const state = useEditorStore.getState();
      expect(state.tabs["p1"].tabs).toHaveLength(2);
      expect(state.tabs["p1"].activeTabId).toBe("t3");
    });

    it("activates previous when last tab is closed", () => {
      useEditorStore.getState().addTab("p1", makeTab("t1"));
      useEditorStore.getState().addTab("p1", makeTab("t2"));
      useEditorStore.getState().addTab("p1", makeTab("t3"));
      useEditorStore.getState().activateTab("p1", "t3");
      useEditorStore.getState().closeTab("p1", "t3");

      const state = useEditorStore.getState();
      expect(state.tabs["p1"].activeTabId).toBe("t2");
    });

    it("clears activeTabId when last tab is removed", () => {
      useEditorStore.getState().addTab("p1", makeTab("t1"));
      useEditorStore.getState().closeTab("p1", "t1");

      const state = useEditorStore.getState();
      expect(state.tabs["p1"].tabs).toHaveLength(0);
      expect(state.tabs["p1"].activeTabId).toBeNull();
    });

    it("is no-op for unknown project", () => {
      useEditorStore.getState().closeTab("nonexistent", "t1");
      // should not throw
    });
  });

  describe("activateTab", () => {
    it("sets active tab in a project", () => {
      useEditorStore.getState().addTab("p1", makeTab("t1"));
      useEditorStore.getState().addTab("p1", makeTab("t2"));
      useEditorStore.getState().activateTab("p1", "t1");

      expect(useEditorStore.getState().tabs["p1"].activeTabId).toBe("t1");
    });

    it("is no-op for unknown project", () => {
      useEditorStore.getState().activateTab("nonexistent", "t1");
      // should not throw
    });
  });

  describe("updateTab", () => {
    it("updates terminal tab data", () => {
      useEditorStore.getState().addTab("p1", makeTab("t1", "terminal"));
      useEditorStore.getState().updateTab("p1", "t1", { status: "Running" });

      const tab = useEditorStore.getState().tabs["p1"].tabs[0];
      expect(tab.data.kind).toBe("terminal");
      expect((tab.data as any).status).toBe("Running");
    });

    it("updates file tab data", () => {
      useEditorStore.getState().addTab("p1", makeTab("t1", "file"));
      useEditorStore.getState().updateTab("p1", "t1", { isDirty: true });

      const tab = useEditorStore.getState().tabs["p1"].tabs[0];
      expect(tab.data.kind).toBe("file");
      expect((tab.data as any).isDirty).toBe(true);
    });

    it("rejects kind mismatch in update", () => {
      useEditorStore.getState().addTab("p1", makeTab("t1", "terminal"));
      // Try updating with wrong kind — should be no-op
      useEditorStore.getState().updateTab("p1", "t1", { kind: "file" } as any);

      const tab = useEditorStore.getState().tabs["p1"].tabs[0];
      expect(tab.data.kind).toBe("terminal");
    });
  });
});
