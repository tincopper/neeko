/**
 * Board / List 上次选择的持久化（design §4.5「记忆用户上次选择」）。
 *
 * # 为什么存在 localStorage 而不是 store
 *
 * 视图是**这台机器的呈现偏好**，不是域数据：它不进 SQLite、不过 IPC、不同步给别的窗口。
 * 放进 store 会让它跟着 `reset()` 一起没掉（而 `reset()` 的语义是「项目切换」—— 切项目时
 * 用户想要的正是「还是我上次那个视图」）。
 *
 * # 为什么读写的每一步都容错
 *
 * `localStorage` 在隐私模式 / 被策略禁用时**取属性本身就抛**（不是返回 `null`），
 * `getItem` / `setItem` 也可能抛。一次偏好读失败不该让一个面板挂载失败，
 * 一次写失败也不该让「切视图」这个动作报错 —— 回落到 `board` 就是全部后果。
 */

/** 面板的两种排布。今天唯一的消费者是 `TasksPanel`（`TaskView` 是它的别名）。 */
export type PanelView = 'board' | 'list';

/** 带域前缀：`neeko.` 是应用级命名空间，后面跟域 + 语义，避免与别的面板撞键。 */
export const VIEW_STORAGE_KEY = 'neeko.work-items.view';

/**
 * 只需要 `getItem` / `setItem` 两件事 —— 用 `Storage` 会让测试被迫实现
 * `clear` / `key` / `length` / `removeItem` 一整套无关接口。
 */
export interface ViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 原值 → 视图。只有精确的 `'list'` 才认，其余（`null` / 垃圾值 / 旧版本遗留）回落 `board`。 */
export function parseView(raw: string | null): PanelView {
  return raw === 'list' ? 'list' : 'board';
}

/** 读偏好：没有存储、或读的过程抛错，一律回到默认的 Board 首页（design §4.5）。 */
export function readViewPreference(storage: ViewStorage | null): PanelView {
  if (storage === null) return 'board';
  try {
    return parseView(storage.getItem(VIEW_STORAGE_KEY));
  } catch {
    // 隐私模式下 `getItem` 也可能抛（SecurityError）：偏好读不到只是回到默认，不是错误状态。
    return 'board';
  }
}

/** 写偏好：失败**静默**，理由见文件头（一次偏好丢失不该让切视图报错）。 */
export function writeViewPreference(storage: ViewStorage | null, view: PanelView): void {
  if (storage === null) return;
  try {
    storage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // 配额耗尽 / 被禁用：忽略。下一次切换会再试一次，用户不会因此丢数据。
  }
}

/**
 * 拿到 `window.localStorage`，拿不到就给 `null`。
 *
 * 必须包 `try`：Safari 隐私模式下**读这个属性本身**就抛 `SecurityError`，
 * 而 `typeof window.localStorage === 'undefined'` 这种探测在抛错时根本走不到。
 */
export function localStorageOrNull(): ViewStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
