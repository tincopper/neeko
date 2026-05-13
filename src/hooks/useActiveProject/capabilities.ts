/**
 * capabilities.ts — 项目能力矩阵纯函数
 *
 * 约束 H3：只声明布尔能力，不含任何条件渲染逻辑或 JSX。
 * 纯函数，无副作用。
 */

import type { ProjectType, ProjectCapabilities } from "../../types/activeProject";

/**
 * getCapabilities — 根据项目类型返回能力矩阵
 *
 * local:  全能力开启
 * wsl:    canEditFiles / canGenerateCommitMessage / canManagePRs 关闭，其余开启
 * remote: 与 wsl 相同
 */
export function getCapabilities(type: ProjectType): ProjectCapabilities {
  switch (type) {
    case "local":
      return {
        canCommit: true,
        canPush: true,
        canPull: true,
        canFetch: true,
        canStage: true,
        canDiscard: true,
        canViewLog: true,
        canCherryPick: true,
        canRevert: true,
        canCreateTag: true,
        canBrowseFiles: true,
        canEditFiles: true,
        canGenerateCommitMessage: true,
        canManagePRs: true,
      };

    case "wsl":
      return {
        canCommit: true,
        canPush: true,
        canPull: true,
        canFetch: true,
        canStage: true,
        canDiscard: true,
        canViewLog: true,
        canCherryPick: true,
        canRevert: true,
        canCreateTag: true,
        canBrowseFiles: true,
        // WSL 项目不支持文件编辑（写入）
        canEditFiles: false,
        canGenerateCommitMessage: true,
        canManagePRs: false,
      };

    case "remote":
      return {
        canCommit: true,
        canPush: true,
        canPull: true,
        canFetch: true,
        canStage: true,
        canDiscard: true,
        canViewLog: true,
        canCherryPick: true,
        canRevert: true,
        canCreateTag: true,
        canBrowseFiles: true,
        // Remote 项目不支持文件编辑（写入）
        canEditFiles: false,
        canGenerateCommitMessage: true,
        canManagePRs: false,
      };
  }
}
