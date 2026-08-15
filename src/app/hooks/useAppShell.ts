import { buildAppShellValues } from './buildAppShellValues';
import { useAppGlobalEffects } from './useAppGlobalEffects';
import { useAppShellData } from './useAppShellData';

/**
 * useAppShell 薄组合器：数据编排（useAppShellData） + 装配（buildAppShellValues）。
 *
 * - 副作用/数据 hooks 全部在 useAppShellData 内（hook 顺序等价）；
 * - context value 组装在 buildAppShellValues（纯函数，可单测）；
 * - 本文件只保留「编排顺序」与返回结构。
 */
export function useAppShell(): {
  initializing: boolean;
  appProvidersProps: ReturnType<typeof buildAppShellValues>['appProvidersProps'];
  appLayoutProps: ReturnType<typeof useAppShellData>['appLayoutProps'];
  appModalsProps: ReturnType<typeof buildAppShellValues>['appModalsProps'];
} {
  // 应用级全局副作用（paste 监听、quick-open 跟踪、skills→appView 启动同步）
  useAppGlobalEffects();

  const data = useAppShellData();
  const values = buildAppShellValues(data);

  return {
    initializing: data.initializing,
    appProvidersProps: values.appProvidersProps,
    appLayoutProps: data.appLayoutProps,
    appModalsProps: values.appModalsProps,
  };
}
