/**
 * [`LangIo`] 的生产实现 —— **语言模块唯一被允许触达 IO 的通道**。
 *
 * 本文件是 `languages/**` 里唯一 import `@tauri-apps/api` / `file/api` / `lsp/api` /
 * 应用 store 的模块（由 `__tests__/architecture.test.ts` 护栏 6 钉住）。语言模块因此只依赖
 * 接口：单测注入 fake io 即可覆盖「launcher 缺失 → 阻断并指引下载」这类含 IO 的分支，
 * 无需 mock Tauri（旧 `exec/java.ts` 因直接 import 而无法纯测）。
 *
 * 所有方法都**不抛**（除 `confirm` 透传用户取消之外的意外）：语言模块的运行前探测失败一律
 * 走各自的降级路径，不该由 IO 抖动决定用户是否看得见按钮。
 */
import { homeDir } from '@tauri-apps/api/path';

import { fileExists, readFileContent } from '@/features/file/api/fileApi';
import { lspRequest } from '@/features/lsp/api/lspApi';
import { confirmAction } from '@/shared/store/confirmStore';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { activeWorkspaceSession } from '@/shared/store/workspaceStore';
import { IS_WINDOWS } from '@/shared/utils/platform';

import { buildTestBinaryRemote } from '../api/debugBuildApi';
import { activeWorkspaceRoot } from '../exec/context';

import type { LangIo } from './contract';

export const langIo: LangIo = {
  fileExists: (absPath) => fileExists(absPath).catch(() => false),

  readText: async (projectId, relPath, base) => {
    try {
      // base（模块根 / 任务 cwd）是**子目录**：拼成绝对路径交给后端（`Path::join` 对绝对值原样
      // 采用，`canonicalize` 归一分隔符 —— 前端不做形态重写）；scope 恒取当前Workspace。
      const filePath = base && base.trim() !== '' ? `${base}/${relPath}` : relPath;
      const file = await readFileContent(activeWorkspaceSession(projectId), filePath);
      return file.content || null;
    } catch {
      return null;
    }
  },

  homeDir: () => homeDir().catch(() => ''),

  // Local 项目取宿主平台；WSL / SSH 目标都是 Linux → unix。
  targetPlatform: (projectId) => {
    const env = useProjectStore.getState().projects.find((p) => p.id === projectId)?.environment;
    return env?.type === 'Local' && IS_WINDOWS ? 'windows' : 'unix';
  },

  lspRequest: (projectPath, lang, method, params) => lspRequest(projectPath, lang, method, params),

  runBuild: (spec) =>
    buildTestBinaryRemote({
      projectId: spec.projectId,
      // 执行单元根由本门面派生（语言模块不感知 worktree）：后端用它做 cwd 的
      // containment 基准。`null` = 主仓单元（后端收敛成项目根）。
      // 复用命令式唯一派生点，不在语言 IO 层重复调 `selectActiveCheckoutPath`。
      worktreePath: activeWorkspaceRoot(spec.projectId),
      command: spec.command,
      cwd: spec.cwd,
    }),

  notify: (n) => useNotificationStore.getState().addNotification(n),

  confirm: (a) => confirmAction(a),
};
