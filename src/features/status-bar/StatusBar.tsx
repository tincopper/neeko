import { InstallProgressBridge } from './bridges/InstallProgressBridge';
import { LspSubscriptionBridge } from './bridges/LspSubscriptionBridge';
import { StatusBarCluster } from './StatusBarCluster';

/**
 * 瘦身后的 StatusBar：常驻 bridges（数据监听）+ 左右簇 map 渲染。
 * 可见性由各 item 自守卫；lsp 槽位内部优先级互斥（单组件直写）。
 */
export function StatusBar() {
  return (
    <>
      <LspSubscriptionBridge />
      <InstallProgressBridge />
      <div className="flex h-4 items-center justify-between px-3 text-xs leading-4 text-text-secondary shrink-0 select-none">
        <div className="flex h-full min-w-0 items-center gap-3">
          <StatusBarCluster side="left" />
        </div>
        <div className="flex h-full shrink-0 items-center gap-3">
          <StatusBarCluster side="right" />
        </div>
      </div>
    </>
  );
}
