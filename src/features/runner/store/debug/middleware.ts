import type { StateCreator } from 'zustand';

import { exclusiveOpenDebugPanel } from '@/shared/utils/bottomPanelExclusive';

import type { DebugStore } from './types';

/**
 * store 级不变式：**任何**把 `panelOpen` 置为 `true` 的写入，都先让 Debug 面板独占底部区域
 * （关闭 Task Console）。
 *
 * 拆 slice 前该判断内联在唯一的 `set` 包装里；现在收敛为中间件，好处是各 slice 拿到的是普通
 * `set`，不需要各自复制包装逻辑 —— 不变式只有一处实现、一处可测。
 *
 * 注：`useDebugStore.setState(...)`（store 外部）不经此中间件，与拆分前一致。
 */
export const withExclusiveDebugPanel =
  (config: StateCreator<DebugStore>): StateCreator<DebugStore> =>
  (set, get, api) =>
    config(
      ((partial: Parameters<typeof set>[0], replace?: boolean) => {
        const next = typeof partial === 'function' ? partial(get()) : partial;
        if (next && typeof next === 'object' && (next as Partial<DebugStore>).panelOpen === true) {
          exclusiveOpenDebugPanel();
        }
        // `set` 的 `replace` 是重载（`true` / `false | undefined` 各一支）——这里只做透传，收窄成单一签名。
        return (set as (p: unknown, r?: boolean) => void)(partial, replace);
      }) as typeof set,
      get,
      api,
    );
