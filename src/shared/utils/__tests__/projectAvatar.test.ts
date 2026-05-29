import { describe, it, expect } from "vitest";
import {
  AVATAR_COLORS,
  getAvatarStyle,
  getProjectInitials,
  randomAvatarColor,
} from "../projectAvatar";

describe("getAvatarStyle", () => {
  it("当 color 在调色板内时优先使用 color，与 name 无关", () => {
    const result = getAvatarStyle({ name: "anything", color: "#61afef" });
    expect(result.color).toBe("#61afef");
    expect(result.backgroundColor).toBe("#61afef26");
  });

  it("color 为 undefined 时走 name DJB2 hash 兜底", () => {
    const a = getAvatarStyle({ name: "neeko" });
    expect(a.color).toBeDefined();
    expect((AVATAR_COLORS as readonly string[]).includes(a.color as string)).toBe(true);
  });

  it("color 为 null 时走 name DJB2 hash 兜底", () => {
    const a = getAvatarStyle({ name: "neeko", color: null });
    expect(a.color).toBeDefined();
    expect((AVATAR_COLORS as readonly string[]).includes(a.color as string)).toBe(true);
  });

  it("color 不在调色板内时走 hash 兜底（不接受任意 hex）", () => {
    const result = getAvatarStyle({ name: "neeko", color: "#000000" });
    // 不应使用传入的 #000000，应当回退到 hash 派生的合法色
    expect(result.color).not.toBe("#000000");
    expect(
      (AVATAR_COLORS as readonly string[]).includes(result.color as string),
    ).toBe(true);
  });

  it("相同 name 的 hash 兜底必须稳定", () => {
    const a = getAvatarStyle({ name: "mife-admin" });
    const b = getAvatarStyle({ name: "mife-admin" });
    expect(a.color).toBe(b.color);
  });

  it("不同的覆盖色互不影响 hash 兜底结果", () => {
    const overridden = getAvatarStyle({ name: "neeko", color: "#e06c75" });
    const fallback = getAvatarStyle({ name: "neeko" });
    expect(overridden.color).toBe("#e06c75");
    // hash 兜底应得到调色板内某色
    expect(
      (AVATAR_COLORS as readonly string[]).includes(fallback.color as string),
    ).toBe(true);
  });
});

describe("getProjectInitials", () => {
  it("单段 name 返回首字母大写", () => {
    expect(getProjectInitials("neeko")).toBe("N");
  });

  it("多段 name 拼前两个段首字母", () => {
    expect(getProjectInitials("my-app")).toBe("MA");
    expect(getProjectInitials("abc-def-ghi")).toBe("AD");
  });
});

describe("randomAvatarColor", () => {
  it("返回值始终在调色板内", () => {
    for (let i = 0; i < 50; i++) {
      const color = randomAvatarColor();
      expect((AVATAR_COLORS as readonly string[]).includes(color)).toBe(true);
    }
  });
});
