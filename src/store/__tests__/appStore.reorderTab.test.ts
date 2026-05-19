import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../appStore";
import type { Tab, ProjectTabs, EditorSplitLayout } from "../../types";
import { createDefaultEditorLayout } from "../../types/editorGroup";

function makeFileTab(id: string, order: number): Tab {
  return {
    id,
    projectId: "p1",
    title: id,
    order,
    data: {
      kind: "file",
      filePath: `/abs/${id}.ts`,
      fileName: `${id}.ts`,
      content: { content: "", language: "typescript", is_binary: false, size: 0 },
      isDirty: false,
    },
  };
}

function seed(tabKey: string, ids: string[], options?: {
  rightIds?: string[];
  pinnedId?: string | null;
  activeTabId?: string | null;
  isSplit?: boolean;
}) {
  const tabs: Tab[] = ids.map((id, i) => makeFileTab(id, i));
  const projectTabs: ProjectTabs = {
    tabs,
    activeTabId: options?.activeTabId ?? ids[ids.length - 1] ?? null,
  };
  const layout: EditorSplitLayout = createDefaultEditorLayout();
  layout.groups.left.tabIds = ids;
  layout.groups.left.activeTabId = projectTabs.activeTabId;
  if (options?.rightIds) {
    layout.groups.right.tabIds = options.rightIds;
    layout.groups.right.activeTabId =
      options.rightIds[options.rightIds.length - 1] ?? null;
    layout.isSplit = options.isSplit ?? true;
  }
  if (options?.pinnedId) {
    layout.pinnedTabId = options.pinnedId;
  }
  useAppStore.setState({
    tabs: { [tabKey]: projectTabs },
    editorLayout: { [tabKey]: layout },
  });
}

beforeEach(() => {
  useAppStore.setState({ tabs: {}, editorLayout: {} });
});

describe("appStore.reorderTab", () => {
  it("把第一个 tab 拖到第三个位置（after target）", () => {
    seed("p1", ["a", "b", "c", "d"]);
    useAppStore.getState().reorderTab("p1", "a", "c", "after");
    const ids = useAppStore.getState().editorLayout["p1"].groups.left.tabIds;
    expect(ids).toEqual(["b", "c", "a", "d"]);
  });

  it("把最后一个 tab 拖到第一个位置（before target）", () => {
    seed("p1", ["a", "b", "c", "d"]);
    useAppStore.getState().reorderTab("p1", "d", "a", "before");
    const ids = useAppStore.getState().editorLayout["p1"].groups.left.tabIds;
    expect(ids).toEqual(["d", "a", "b", "c"]);
  });

  it("拖到相邻位置只挪一格", () => {
    seed("p1", ["a", "b", "c"]);
    useAppStore.getState().reorderTab("p1", "a", "b", "after");
    expect(useAppStore.getState().editorLayout["p1"].groups.left.tabIds).toEqual(["b", "a", "c"]);
  });

  it("dragged 和 target 同一个则 no-op", () => {
    seed("p1", ["a", "b", "c"]);
    useAppStore.getState().reorderTab("p1", "b", "b", "after");
    expect(useAppStore.getState().editorLayout["p1"].groups.left.tabIds).toEqual(["a", "b", "c"]);
  });

  it("跨 group 拖拽 no-op（拖左边 tab 到右边 tab）", () => {
    seed("p1", ["a", "b"], { rightIds: ["x", "y"] });
    useAppStore.getState().reorderTab("p1", "a", "x", "before");
    expect(useAppStore.getState().editorLayout["p1"].groups.left.tabIds).toEqual(["a", "b"]);
    expect(useAppStore.getState().editorLayout["p1"].groups.right.tabIds).toEqual(["x", "y"]);
  });

  it("right group 内部 reorder 只动 right 的 tabIds", () => {
    seed("p1", ["a", "b"], { rightIds: ["x", "y", "z"] });
    useAppStore.getState().reorderTab("p1", "z", "x", "before");
    expect(useAppStore.getState().editorLayout["p1"].groups.left.tabIds).toEqual(["a", "b"]);
    expect(useAppStore.getState().editorLayout["p1"].groups.right.tabIds).toEqual(["z", "x", "y"]);
  });

  it("pinned tab 不能被 reorder（dragged）", () => {
    seed("p1", ["a", "b", "c"], { pinnedId: "a" });
    useAppStore.getState().reorderTab("p1", "a", "c", "after");
    expect(useAppStore.getState().editorLayout["p1"].groups.left.tabIds).toEqual(["a", "b", "c"]);
  });

  it("pinned tab 不能作为 drop 目标", () => {
    seed("p1", ["a", "b", "c"], { pinnedId: "b" });
    useAppStore.getState().reorderTab("p1", "c", "b", "before");
    expect(useAppStore.getState().editorLayout["p1"].groups.left.tabIds).toEqual(["a", "b", "c"]);
  });

  it("不动 activeTabId 和 state.tabs 顺序", () => {
    seed("p1", ["a", "b", "c"], { activeTabId: "b" });
    useAppStore.getState().reorderTab("p1", "c", "a", "before");
    const layout = useAppStore.getState().editorLayout["p1"];
    expect(layout.groups.left.tabIds).toEqual(["c", "a", "b"]);
    expect(layout.groups.left.activeTabId).toBe("b");
    // state.tabs[tabKey].tabs 顺序保持不变（不参与渲染）
    expect(useAppStore.getState().tabs["p1"].tabs.map((t) => t.id)).toEqual([
      "a", "b", "c",
    ]);
  });

  it("不存在的 tabKey 安全 no-op", () => {
    expect(() =>
      useAppStore.getState().reorderTab("nope", "a", "b", "after"),
    ).not.toThrow();
  });

  it("不存在的 dragged 或 target 安全 no-op", () => {
    seed("p1", ["a", "b", "c"]);
    useAppStore.getState().reorderTab("p1", "x", "a", "after");
    useAppStore.getState().reorderTab("p1", "a", "x", "after");
    expect(useAppStore.getState().editorLayout["p1"].groups.left.tabIds).toEqual(["a", "b", "c"]);
  });
});
