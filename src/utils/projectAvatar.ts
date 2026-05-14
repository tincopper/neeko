import type React from "react";

const AVATAR_COLORS = [
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
];

/**
 * Returns inline styles for a project avatar: a palette color derived from
 * the project name (DJB2 hash), with a 15%-opacity background tint.
 */
export function getAvatarStyle(name: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return { color, backgroundColor: `${color}26` };
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
