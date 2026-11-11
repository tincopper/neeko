/**
 * `githubProvider` 开关的持久化（design §8.3：默认**关闭**，与旧 Pull Requests 面板并联期）。
 *
 * # 为什么是 localStorage，不是 store
 *
 * 与 `viewPreference` 同族：这是**这台机器的偏好**，不是域数据 —— 不进 SQLite、不过 IPC、
 * 不同步给别的窗口。放进 store 会让它跟着 `reset()`（= 项目切换）一起没掉，而切项目时用户
 * 想要的正是「我刚才打开了 PR，别给我关掉」。
 *
 * # 默认值是 `false`（不是「读到什么算什么」）
 *
 * 缺省值、垃圾值、读失败一律 `false`。这不是保守，是 design §8.3 的裁决：GitHub provider 与
 * 旧的 Pull Requests dock 面板并联一轮，**用户显式打开**才算数。把默认写成 `true` 等于
 * 让每次升级都替用户接受一个新的外部依赖（`gh` CLI 调用）。
 *
 * # 与 `viewPreference` 共用存储抽象
 *
 * `ViewStorage` / `localStorageOrNull` 住在 `viewPreference.ts`（那里有完整的容错理由与
 * 「为什么不用 `Storage`」的记录）。本文件只多一份键与解析规则，不复制容错逻辑。
 */

import type { ViewStorage } from './viewPreference';

/**
 * 带域前缀的键。与 `neeko.work-items.view` 同一命名空间：`neeko.` + 域 + 语义。
 *
 * 刻意**不叫** `enabledProviders`：一个列表型偏好在 provider 增删时会语义漂移（空数组到底是
 * 「都关」还是「没设置过」？），而本期只有一档、且默认关，布尔值足够表达，也足够能回滚。
 */
export const PROVIDER_STORAGE_KEY = 'neeko.work-items.githubProvider';

/** 原值 → 开关。只有精确的 `'true'` 才算打开；其余（`null` / `'1'` / `'yes'` / 垃圾）一律关。 */
export function parseGithubProvider(raw: string | null): boolean {
  return raw === 'true';
}

/** 读偏好：没有存储 / 读的过程抛错 → 默认关闭（理由见文件头）。 */
export function readGithubProviderPreference(storage: ViewStorage | null): boolean {
  if (storage === null) return false;
  try {
    return parseGithubProvider(storage.getItem(PROVIDER_STORAGE_KEY));
  } catch {
    // 隐私模式下 `getItem` 也可能抛（SecurityError）：读不到偏好 = 用默认值，不是错误状态。
    return false;
  }
}

/** 写偏好：失败**静默** —— 一次偏好没存上不该让「勾选框」这个动作报错。 */
export function writeGithubProviderPreference(storage: ViewStorage | null, enabled: boolean): void {
  if (storage === null) return;
  try {
    storage.setItem(PROVIDER_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // 配额耗尽 / 被禁用：忽略。下一次勾选会再试一次，用户不会因此丢数据。
  }
}
