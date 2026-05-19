import type React from "react";

/**
 * Project avatar 调色板。前后端共享同一组色——后端不内嵌列表，
 * 前端在 ProjectSettingsDialog 选色后传给对应 setter 持久化。
 */
export const AVATAR_COLORS = [
  "#61afef",
  "#98c379",
  "#e5c07b",
  "#e06c75",
  "#c678dd",
  "#56b6c2",
  "#d19a66",
  "#67a8e4",
  "#abb2bf",
  "#be5046",
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

/**
 * 从 `AVATAR_COLORS` 调色板中随机抽一个颜色。
 * 创建项目时由前端调用，作为 `avatar_color` 默认值传给 add 命令。
 */
export function randomAvatarColor(): AvatarColor {
  const idx = Math.floor(Math.random() * AVATAR_COLORS.length);
  return AVATAR_COLORS[idx];
}

/**
 * Returns inline styles for a project avatar.
 *
 * Priority:
 *   1. `color` 在调色板范围内 → 直接使用该颜色（含 15% 不透明度背景）
 *   2. `color` 缺省 / 不在调色板内 → fallback 到原 DJB2 hash 算法
 */
export function getAvatarStyle(input: {
  name: string;
  color?: string | null;
}): React.CSSProperties {
  const { name, color } = input;
  const finalColor =
    color && (AVATAR_COLORS as readonly string[]).includes(color)
      ? color
      : hashFromName(name);
  return { color: finalColor, backgroundColor: `${finalColor}26` };
}

function hashFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Returns a short initials string for a project name.
 * Splits on "-" and takes the first character of each segment (uppercase).
 * Result is at most 2 characters.
 *
 * Examples:
 *   "neeko"          → "N"
 *   "my-app"         → "MA"
 *   "abc-def-ghi"    → "AD"
 */
export function getProjectInitials(name: string): string {
  const parts = name.split("-").filter(Boolean);
  if (parts.length <= 1) return name.charAt(0).toUpperCase();
  return parts
    .map((s) => s.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2);
}
