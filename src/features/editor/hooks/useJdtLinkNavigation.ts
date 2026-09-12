import { useCallback, useRef } from 'react';

import type { LspLocation } from '@/features/lsp/types';

import type { useLspNavigation } from './useLspNavigation';

type NavigateToLocation = ReturnType<typeof useLspNavigation>['navigateToLocation'];

/** 绑定时的目标上下文（跳转需要知道「从哪个文件、哪个 tab 发起」）。 */
export interface JdtLinkContext {
  projectPath: string | null;
  tabKey: string;
  projectId: string;
  filePath: string;
}

/**
 * hover 提示里的 `jdt://` 链接 → 定义跳转的**晚绑定**。
 *
 * 物理约束：`useLspClient` 需要在共享 client 首次建立时捕获一个**引用稳定**的回调；
 * 而 `navigateToLocation` 诞生于其后的 `useLspNavigation` —— 两个 hook 存在初始化
 * 顺序依赖，谁也不能直接依赖对方。
 *
 * 因此本 hook 提供两段式 API：
 * 1. `onOpenJdtLink`：引用恒定，可安全交给 `useLspClient`（早于 navigation 就绪）；
 * 2. `bind(navigate, ctx)`：navigation 就绪后调用（组件内 effect），写入 ref，
 *    **返回解绑函数**（作为 effect 清理返回值）。
 *
 * 回调的**归属**由 LSP 侧保证：`onOpenJdtLink` 经 `jdtLinkHandlerFacet` 随本文件的
 * 视图状态注入（共享 client 不持有任何宿主闭包），因此每个 tab 各拿自己的回调。
 * 这里返回解绑属**生命周期卫生**：让 ref 不超出 tab 存活期，卸载后不再被 ref 持有
 * （否则闭包里的 store / props 无法回收）。
 *
 * 跳转语义与 Cmd+Click 一致：跳到 `jdt` 目标第 0 行。
 */
export function useJdtLinkNavigation(): {
  onOpenJdtLink: (uri: string) => void;
  bind: (navigate: NavigateToLocation, ctx: JdtLinkContext) => () => void;
} {
  const targetRef = useRef<{
    /** 绑定序号：解绑只认自己那一次，避免误清更晚的绑定。 */
    token: number;
    navigate: NavigateToLocation;
    ctx: JdtLinkContext;
  } | null>(null);
  const tokenRef = useRef(0);

  const bind = useCallback((navigate: NavigateToLocation, ctx: JdtLinkContext) => {
    tokenRef.current += 1;
    const token = tokenRef.current;
    targetRef.current = { token, navigate, ctx };
    return () => {
      // 序号相等才清空：解绑幂等，且不受绑定调用顺序影响（同一 navigate
      // 重绑时按引用比较会误清）。
      if (targetRef.current?.token === token) targetRef.current = null;
    };
  }, []);

  const onOpenJdtLink = useCallback((uri: string) => {
    const target = targetRef.current;
    if (!target) return;
    const { navigate, ctx } = target;
    void navigate(
      {
        uri,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      } satisfies LspLocation,
      ctx.projectPath ?? '',
      ctx.tabKey,
      ctx.projectId,
      ctx.filePath,
      null,
    );
  }, []);

  return { onOpenJdtLink, bind };
}
