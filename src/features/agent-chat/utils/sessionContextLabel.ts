/**
 * 「会话已开始 · 已注入上下文」这一行的**显示派生**（纯函数，视图只负责排版）。
 *
 * # 为什么需要它
 *
 * 一行里混着三个不同粒度的事实：**项目名**（`neeko`）、**工作区单元**（worktree 名）、
 * **执行根**（agent 进程的 cwd）。前两个都叫「名字」，但用户在 worktree 视图里关心的是
 * 后者——只显示项目名会让人以为 agent 跑在主仓（2026-10-30 实测事故的可见形态）。
 *
 * 单元名取 worktree 路径的 basename：`~/.neeko/worktrees/multi-agent` → `multi-agent`。
 * 这是唯一不依赖后端额外字段、也不需要 git 调用的派生方式（路径本身就是地址的一部分）。
 */
import { getFileName } from '@/shared/utils/fileTree';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

/**
 * 地址 key → worktree 身份串（`null` = 主 checkout）。
 *
 * 唯一 codec 是 `WorkspaceSession.fromKeyOrId`（wire 只给字符串、消费侧确需分量时的桥）——
 * 不在此处手解分隔符，否则同一个 key 会出现第二种解读。
 */
export function worktreePathOfKey(workspaceKey: string | null | undefined): string | null {
  if (!workspaceKey) return null;
  return WorkspaceSession.fromKeyOrId(workspaceKey).worktreePath;
}

/**
 * 从 worktree 路径取展示名（`null` / 空串 / 纯分隔符 ⇒ `null` 表示主 checkout）。
 *
 * basename 走共享 helper `getFileName`（会先归一 `\`）—— 不在此处自造 `split('/').pop()`。
 */
export function worktreeNameOf(worktreePath: string | null | undefined): string | null {
  if (!worktreePath) return null;
  const trimmed = worktreePath.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return null;
  return getFileName(trimmed) || null;
}

/**
 * 单元展示名：主 checkout = 项目名；linked worktree = `项目名 · worktree 名`。
 *
 * 地址来自**后端回显**（`CtxInfo.workspaceKey`），不拿 tab 自己的地址补 —— 显示与执行必须同源。
 * 拿不到 worktree 名（项目级会话）时退回项目名，绝不猜一个「看起来像」的名字。
 */
export function unitDisplayName(input: {
  projectName?: string;
  projectId: string;
  workspaceKey?: string | null;
}): string {
  const base = input.projectName ?? input.projectId;
  const wt = worktreeNameOf(worktreePathOfKey(input.workspaceKey));
  return wt ? `${base} · ${wt}` : base;
}

/**
 * 执行环境标签：`local` 是**默认值**，显示它等于什么也没说（`neeko · multi-agent（local）` 里的
 * `local` 就是这个噪音）。只有 `wsl` / `ssh` 才携带信息 —— 它们回答「这个 agent 到底跑在哪」。
 *
 * 注意语义：这是**执行环境类**（`local | wsl | ssh`），不是「工作区单元」。单元维度已经由
 * `unitDisplayName` 的 worktree 名表达，两者不要混在同一层文案里。
 *
 * 返回 `null` = 无需显示。分布式细节（WSL distro / SSH host）当前不在事件载荷里，
 * 要显示得先扩 `ContextManifest.env` 的形状，属另一件事。
 */
export function envLabelOf(env: string | null | undefined): string | null {
  const normalized = (env ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'local') return null;
  switch (normalized) {
    case 'wsl':
      return 'WSL';
    case 'ssh':
      return 'SSH';
    default:
      return normalized.toUpperCase();
  }
}
