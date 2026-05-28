import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTerminalTabs } from "../../hooks/useTerminalTabs";
import { useEditorStore } from "../../store/editorStore";

vi.mock("../../components/terminal", () => ({
  destroyTerminalCachesByPrefix: vi.fn(),
}));

describe("useTerminalTabs", () => {
  const PROJECT_ID = "test-project";

  beforeEach(() => {
    // Clear the unified store tabs between tests
    useEditorStore.setState({ tabs: {}, activeTabId: null });
  });

  it("should close the last tab and set activeTabId to null", () => {
    const { result } = renderHook(() => useTerminalTabs());

    let tabId = "";
    act(() => {
      tabId = result.current.ensureDefaultTab(PROJECT_ID);
    });

    expect(result.current.getTabs(PROJECT_ID)).toHaveLength(1);
    expect(result.current.getActiveTabId(PROJECT_ID)).toBe(tabId);

    act(() => {
      result.current.closeTab(PROJECT_ID, tabId);
    });

    expect(result.current.getTabs(PROJECT_ID)).toHaveLength(0);
    expect(result.current.getActiveTabId(PROJECT_ID)).toBeNull();
  });

  it("should activate adjacent tab when closing a middle tab", () => {
    const { result } = renderHook(() => useTerminalTabs());

    let tab2Id = "";
    let tab3Id = "";
    act(() => {
      result.current.ensureDefaultTab(PROJECT_ID);
      const tab2 = result.current.addTab(PROJECT_ID);
      tab2Id = tab2!.id;
      const tab3 = result.current.addTab(PROJECT_ID);
      tab3Id = tab3!.id;
    });

    expect(result.current.getTabs(PROJECT_ID)).toHaveLength(3);
    expect(result.current.getActiveTabId(PROJECT_ID)).toBe(tab3Id);

    act(() => {
      result.current.closeTab(PROJECT_ID, tab2Id);
    });

    expect(result.current.getTabs(PROJECT_ID)).toHaveLength(2);
    expect(result.current.getActiveTabId(PROJECT_ID)).toBe(tab3Id);
  });

  it("should switch to previous tab when closing the last tab in list", () => {
    const { result } = renderHook(() => useTerminalTabs());

    let tab1Id = "";
    let tab2Id = "";
    act(() => {
      tab1Id = result.current.ensureDefaultTab(PROJECT_ID);
      const tab2 = result.current.addTab(PROJECT_ID);
      tab2Id = tab2!.id;
    });

    expect(result.current.getActiveTabId(PROJECT_ID)).toBe(tab2Id);

    act(() => {
      result.current.closeTab(PROJECT_ID, tab2Id);
    });

    expect(result.current.getTabs(PROJECT_ID)).toHaveLength(1);
    expect(result.current.getActiveTabId(PROJECT_ID)).toBe(tab1Id);
  });

  describe("handleAgentClick", () => {
    it("创建新 agent tab 并返回 TerminalTab 对象", () => {
      const { result } = renderHook(() => useTerminalTabs());

      let firstTab: string | undefined;
      act(() => {
        firstTab = result.current.ensureDefaultTab(PROJECT_ID);
      });

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [] };
      let created: ReturnType<typeof result.current.handleAgentClick> = null;
      act(() => {
        created = result.current.handleAgentClick(PROJECT_ID, agent);
      });

      expect(created).not.toBeNull();
      expect(result.current.getTabs(PROJECT_ID)).toHaveLength(2);
      expect(result.current.getActiveTabId(PROJECT_ID)).not.toBe(firstTab);
    });

    it("新 tab 携带正确的 agentId", () => {
      const { result } = renderHook(() => useTerminalTabs());

      const agent = { id: "cursor-agent", name: "Cursor Agent", command: "cursor", args: [] };
      let created: ReturnType<typeof result.current.handleAgentClick> = null;
      act(() => {
        result.current.ensureDefaultTab(PROJECT_ID);
        created = result.current.handleAgentClick(PROJECT_ID, agent);
      });

      expect(created).not.toBeNull();
      expect(created?.agentId).toBe("cursor-agent");
      expect(created?.title).toBe("Cursor Agent");
    });

    it("达到 10 个 tab 上限时返回 null", () => {
      const { result } = renderHook(() => useTerminalTabs());

      // 创建 10 个终端 tab
      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.addTab(PROJECT_ID);
        }
      });

      expect(result.current.getTabs(PROJECT_ID)).toHaveLength(10);

      const agent = { id: "claude-code", name: "Claude Code", command: "claude", args: [] };
      let created: ReturnType<typeof result.current.handleAgentClick> = null;
      act(() => {
        created = result.current.handleAgentClick(PROJECT_ID, agent);
      });

      // 第 11 次应返回 null（上限），不再创建新 tab
      expect(created).toBeNull();
      expect(result.current.getTabs(PROJECT_ID)).toHaveLength(10);
    });
  });
});
