/**
 * 复合 key helper for `useAppStore.aheadBehind`.
 *
 * 之前 PR2 仅 local 用 `projectId` 作 key，PR3 加入 WSL / SSH 后改为
 * `${kind}:${entryId}:${projectId}` 统一表，避免不同 source 的 projectId 撞车。
 *
 * - local:   `local:${projectId}`
 * - wsl:     `wsl:${distro}:${projectId}`
 * - remote:  `remote:${entryId}:${projectId}`
 */

export type AheadBehindKind = "local" | "wsl" | "remote";

export function aheadBehindKey(
  kind: AheadBehindKind,
  entryId: string,
  projectId: string,
): string {
  if (kind === "local") return `local:${projectId}`;
  return `${kind}:${entryId}:${projectId}`;
}
