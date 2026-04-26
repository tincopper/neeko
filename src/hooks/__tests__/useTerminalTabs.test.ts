import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTerminalTabs } from "../../hooks/useTerminalTabs";

vi.mock("../../components/terminal", () => ({
  destroyTerminalCachesByPrefix: vi.fn(),
}));

describe("useTerminalTabs", () => {
  const PROJECT_ID = "test-project";

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
});
