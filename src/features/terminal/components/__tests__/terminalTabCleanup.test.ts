import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  destroyTerminalCachesByPrefixMock,
  destroyTerminalCacheMock,
  destroyWslCacheMock,
  destroyRemoteCacheMock,
  terminalCache,
  wslTerminalCache,
  remoteTerminalCache,
  closeTabMock,
  clearProjectTabsMock,
} = vi.hoisted(() => {
  return {
    destroyTerminalCachesByPrefixMock: vi.fn(),
    destroyTerminalCacheMock: vi.fn(),
    destroyWslCacheMock: vi.fn(),
    destroyRemoteCacheMock: vi.fn(),
    terminalCache: new Map<string, unknown>(),
    wslTerminalCache: new Map<string, unknown>(),
    remoteTerminalCache: new Map<string, unknown>(),
    closeTabMock: vi.fn(),
    clearProjectTabsMock: vi.fn(),
  };
});

vi.mock("../terminalCache", () => ({
  destroyTerminalCachesByPrefix: (...args: unknown[]) =>
    destroyTerminalCachesByPrefixMock(...args),
  destroyTerminalCache: (...args: unknown[]) => destroyTerminalCacheMock(...args),
  destroyWslCache: (...args: unknown[]) => destroyWslCacheMock(...args),
  destroyRemoteCache: (...args: unknown[]) => destroyRemoteCacheMock(...args),
  terminalCache,
  wslTerminalCache,
  remoteTerminalCache,
}));

vi.mock("@/shared/store", () => ({
  useEditorStore: {
    getState: () => ({
      closeTab: closeTabMock,
      clearProjectTabs: clearProjectTabsMock,
      tabs: {
        "proj-1": {
          tabs: [
            { id: "tab_a", data: { kind: "terminal" } },
            { id: "tab_b", data: { kind: "file" } },
          ],
          activeTabId: "tab_a",
        },
      },
    }),
  },
}));

import {
  cleanupTerminalsForTab,
  cleanupTerminalsForTabKey,
  closeAllEditorTabs,
  closeEditorTab,
} from "../terminalTabCleanup";

describe("terminalTabCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalCache.clear();
    wslTerminalCache.clear();
    remoteTerminalCache.clear();
  });

  it("cleanupTerminalsForTab destroys local prefix and matching env caches", () => {
    terminalCache.set("proj-1:tab_a:p1", {});
    terminalCache.set("proj-1:tab_a:p2", {});
    terminalCache.set("proj-1:tab_b:p1", {});
    wslTerminalCache.set("wsl:Ubuntu:proj-1:tab_a:p1", {});
    wslTerminalCache.set("wsl:Ubuntu:proj-1:tab_b:p1", {});
    remoteTerminalCache.set("remote:ssh1:proj-1:tab_a:p1", {});
    remoteTerminalCache.set("remote:ssh1:proj-1:other:p1", {});

    cleanupTerminalsForTab("proj-1", "tab_a");

    expect(destroyTerminalCachesByPrefixMock).toHaveBeenCalledWith("proj-1:tab_a");
    expect(destroyTerminalCacheMock).toHaveBeenCalledWith("proj-1:tab_a:p1");
    expect(destroyTerminalCacheMock).toHaveBeenCalledWith("proj-1:tab_a:p2");
    expect(destroyTerminalCacheMock).not.toHaveBeenCalledWith("proj-1:tab_b:p1");
    expect(destroyWslCacheMock).toHaveBeenCalledWith("wsl:Ubuntu:proj-1:tab_a:p1");
    expect(destroyWslCacheMock).not.toHaveBeenCalledWith("wsl:Ubuntu:proj-1:tab_b:p1");
    expect(destroyRemoteCacheMock).toHaveBeenCalledWith("remote:ssh1:proj-1:tab_a:p1");
    expect(destroyRemoteCacheMock).not.toHaveBeenCalledWith(
      "remote:ssh1:proj-1:other:p1",
    );
  });

  it("cleanupTerminalsForTabKey sweeps project-scoped local and env caches", () => {
    terminalCache.set("proj-1:tab_a:p1", {});
    wslTerminalCache.set("wsl:Ubuntu:proj-1:tab_a:p1", {});
    remoteTerminalCache.set("remote:ssh1:proj-1:p1", {});
    wslTerminalCache.set("wsl:Ubuntu:other-proj:tab_a:p1", {});

    cleanupTerminalsForTabKey("proj-1");

    expect(destroyTerminalCachesByPrefixMock).toHaveBeenCalledWith("proj-1");
    expect(destroyWslCacheMock).toHaveBeenCalledWith("wsl:Ubuntu:proj-1:tab_a:p1");
    expect(destroyWslCacheMock).not.toHaveBeenCalledWith(
      "wsl:Ubuntu:other-proj:tab_a:p1",
    );
    expect(destroyRemoteCacheMock).toHaveBeenCalledWith("remote:ssh1:proj-1:p1");
  });

  it("closeEditorTab cleans caches then closes store tab", () => {
    closeEditorTab("proj-1", "tab_a");
    expect(destroyTerminalCachesByPrefixMock).toHaveBeenCalledWith("proj-1:tab_a");
    expect(closeTabMock).toHaveBeenCalledWith("proj-1", "tab_a");
  });

  it("closeAllEditorTabs cleans every tab then clearProjectTabs", () => {
    closeAllEditorTabs("proj-1");
    expect(destroyTerminalCachesByPrefixMock).toHaveBeenCalledWith("proj-1:tab_a");
    expect(destroyTerminalCachesByPrefixMock).toHaveBeenCalledWith("proj-1:tab_b");
    expect(destroyTerminalCachesByPrefixMock).toHaveBeenCalledWith("proj-1");
    expect(clearProjectTabsMock).toHaveBeenCalledWith("proj-1");
  });
});
