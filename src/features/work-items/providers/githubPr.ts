/**
 * GitHub PR provider（design §8.1 的第二个 provider）：把 `gh` 的列表读成看板条目。
 *
 * # 只读，且只读一层
 *
 * 本期能力 = **list / detail / open-in-browser**（design §8.2：第三方写操作一律后置）。
 * 所以这里只有「拉列表」一件事：`mergePr` / `checkoutBranch` / `listPrFiles` 那些已经全在
 * `features/git/api/gitApi.ts` 里，等对应的 UI 落地时再逐个接进来 —— 提前在这里摆一排没人
 * 调的包装函数，等于给「写操作已经支持」留一个会被误读的假象。
 *
 * # 为什么没有 `WorkItemProvider` 注册表
 *
 * design §3.2 的 registry 是**第二个 provider 落地时才值钱**的抽象。今天外部 provider 只有
 * 这一档、而且面板的呈现目前只消费「列表 + 一个只读详情」，此刻造出来的 registry 只会得到
 * `if (source === 'github')` 的换皮版本 —— 那是**假的扩展点**（比没有更糟：它会让下一个人以为
 * 加 provider 不用改组件）。所以本文件只导出**身份常量 + 纯加载**，注释里写清这条债：
 * 加第二个外部 provider 时，把「拉取」收敛成 `providers/index.ts` 的注册表，并按 design §3.2
 * 的 `capabilities` 生成动作条。
 *
 * # 为什么错误在这里就被翻译成句子
 *
 * 调用方（hook）拿到的是 `Promise`，它没有上下文去判断这个 `Err` 是 `gh` 没登录、网络失败还是
 * 仓库没有远端。所以翻译下沉到这里（全仓统一的 `invokeErrorMessage`，不自己编句子）：
 * 「读取 GitHub PR 失败」只在后端什么也没说时才出现。
 */

import { listPrs } from '@/features/git/api/gitApi';
import { invokeErrorMessage } from '@/shared/utils/invokeError';
import type { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { prToTask, type TaskItem } from '../viewModel';

/** provider 身份（与 `TaskSource` 的 `'github'` 同值：来源徽标与加载逻辑不各写一份清单）。 */
export const GITHUB_PR_PROVIDER_ID = 'github' as const;

/** 呈现名：徽标 / 开关文案的唯一来源。 */
export const GITHUB_PR_PROVIDER_LABEL = 'GitHub';

/**
 * 列表参数：`all` = open + merged + closed。
 *
 * 拉 `open` 一档就够看板「现在有什么」，但这样 `Done` 列永远是空的、用户没法在一处回看刚合掉的
 * 那批。`all` + 50 与旧 `PullRequestsPanel` 同档，联调期两边的数字对得上。
 */
export const PR_LIST_STATE = 'all';
export const PR_LIST_LIMIT = 50;

/**
 * 拉一次 PR 列表并映射成 `TaskItem`。
 *
 * `repoLabel` 由宿主注入（`PRListItem` 里没有 `owner/name`，见 `viewModel.ts` 的说明）：这里
 * **不猜**仓库名，空串就表示不知道。
 */
export async function fetchGithubPrs(
  workspace: WorkspaceSession,
  repoLabel: string,
): Promise<TaskItem[]> {
  try {
    const rows = await listPrs(workspace, PR_LIST_STATE, PR_LIST_LIMIT);
    return rows.map((pr) => prToTask(pr, repoLabel));
  } catch (err) {
    // 原样保留后端 `AppError` 的 `Display`（它已经是给人看的句子），只在真的空手时兜底。
    throw new Error(invokeErrorMessage(err, 'Failed to load GitHub PRs'));
  }
}
