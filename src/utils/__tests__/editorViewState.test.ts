import { describe, it, expect, beforeEach } from "vitest";
import {
  getViewSnapshot,
  setViewSnapshot,
  clearViewSnapshot,
  clearAllForTabKey,
  __resetForTest,
} from "../editorViewState";

beforeEach(() => {
  __resetForTest();
});

describe("editorViewState", () => {
  it("set 后能 get 到同一份快照", () => {
    setViewSnapshot("proj1", "tab1", "editor", { scrollTop: 120 });
    expect(getViewSnapshot("proj1", "tab1", "editor")).toEqual({ scrollTop: 120 });
  });

  it("不同 variant 互相隔离", () => {
    setViewSnapshot("proj1", "tab1", "editor", { scrollTop: 100 });
    setViewSnapshot("proj1", "tab1", "markdown", { scrollTop: 200 });
    setViewSnapshot("proj1", "tab1", "html", { scrollTop: 300 });
    expect(getViewSnapshot("proj1", "tab1", "editor")?.scrollTop).toBe(100);
    expect(getViewSnapshot("proj1", "tab1", "markdown")?.scrollTop).toBe(200);
    expect(getViewSnapshot("proj1", "tab1", "html")?.scrollTop).toBe(300);
  });

  it("不同 tabKey 互相隔离", () => {
    setViewSnapshot("proj1", "tab1", "editor", { scrollTop: 100 });
    setViewSnapshot("proj2", "tab1", "editor", { scrollTop: 200 });
    expect(getViewSnapshot("proj1", "tab1", "editor")?.scrollTop).toBe(100);
    expect(getViewSnapshot("proj2", "tab1", "editor")?.scrollTop).toBe(200);
  });

  it("editor variant 可以保存 selection", () => {
    const sel = { ranges: [{ anchor: 5, head: 10 }], main: 0 };
    setViewSnapshot("proj1", "tab1", "editor", {
      scrollTop: 50,
      selection: sel,
    });
    expect(getViewSnapshot("proj1", "tab1", "editor")?.selection).toEqual(sel);
  });

  it("get 不存在的 key 返回 undefined", () => {
    expect(getViewSnapshot("nope", "nope", "editor")).toBeUndefined();
  });

  it("clearViewSnapshot 仅清除指定 variant", () => {
    setViewSnapshot("proj1", "tab1", "editor", { scrollTop: 100 });
    setViewSnapshot("proj1", "tab1", "markdown", { scrollTop: 200 });
    clearViewSnapshot("proj1", "tab1", "editor");
    expect(getViewSnapshot("proj1", "tab1", "editor")).toBeUndefined();
    expect(getViewSnapshot("proj1", "tab1", "markdown")?.scrollTop).toBe(200);
  });

  it("clearViewSnapshot 不指定 variant 时清除该 tab 所有 variant", () => {
    setViewSnapshot("proj1", "tab1", "editor", { scrollTop: 100 });
    setViewSnapshot("proj1", "tab1", "markdown", { scrollTop: 200 });
    setViewSnapshot("proj1", "tab1", "html", { scrollTop: 300 });
    setViewSnapshot("proj1", "tab2", "editor", { scrollTop: 999 });
    clearViewSnapshot("proj1", "tab1");
    expect(getViewSnapshot("proj1", "tab1", "editor")).toBeUndefined();
    expect(getViewSnapshot("proj1", "tab1", "markdown")).toBeUndefined();
    expect(getViewSnapshot("proj1", "tab1", "html")).toBeUndefined();
    // 不影响别的 tab
    expect(getViewSnapshot("proj1", "tab2", "editor")?.scrollTop).toBe(999);
  });

  it("clearAllForTabKey 清除整个 tabKey 下所有快照", () => {
    setViewSnapshot("proj1", "tab1", "editor", { scrollTop: 100 });
    setViewSnapshot("proj1", "tab2", "markdown", { scrollTop: 200 });
    setViewSnapshot("proj2", "tab1", "editor", { scrollTop: 300 });
    clearAllForTabKey("proj1");
    expect(getViewSnapshot("proj1", "tab1", "editor")).toBeUndefined();
    expect(getViewSnapshot("proj1", "tab2", "markdown")).toBeUndefined();
    expect(getViewSnapshot("proj2", "tab1", "editor")?.scrollTop).toBe(300);
  });

  it("set 同一个 key 会覆盖旧快照", () => {
    setViewSnapshot("proj1", "tab1", "editor", { scrollTop: 100 });
    setViewSnapshot("proj1", "tab1", "editor", { scrollTop: 999 });
    expect(getViewSnapshot("proj1", "tab1", "editor")?.scrollTop).toBe(999);
  });
});
