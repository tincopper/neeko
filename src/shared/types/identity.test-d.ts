/*
 * 身份品牌的负向类型测试（编译期护栏）。
 *
 * 验证方式：本文件位于 __tests__ 之外（tsconfig 排除了测试目录），由 pnpm type-check
 * （tsc --noEmit，include: src）直接编译校验 —— 每条 @ts-expect-error 在对应赋值
 * 合法时会因「未使用的 expect-error」报错，即测试失败。vitest 的 include 只匹配
 * 测试目录下的 *.test.ts，不会运行本文件（无需运行时语义）。
 */
import type { ProjectId, WorkspaceKey } from '@/shared/utils/workspaceRef';

// WorkspaceKey 不可赋 ProjectId（品牌互斥）
declare const key: WorkspaceKey;
// @ts-expect-error 品牌互斥：WorkspaceKey ≠ ProjectId
export const keyToProjectId: ProjectId = key;

// ProjectId 不可赋 WorkspaceKey（品牌互斥）
declare const pid: ProjectId;
// @ts-expect-error 品牌互斥：ProjectId ≠ WorkspaceKey
export const projectIdToKey: WorkspaceKey = pid;

// 裸 string 不可赋 ProjectId（无品牌）
declare const raw: string;
// @ts-expect-error 裸 string 不是 ProjectId
export const rawToProjectId: ProjectId = raw;

// 裸 string 不可赋 WorkspaceKey（无品牌）
// @ts-expect-error 裸 string 不是 WorkspaceKey
export const rawToKey: WorkspaceKey = raw;
