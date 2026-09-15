import React, { useEffect } from 'react';

import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { setConfirmHostMounted, useConfirmStore } from '@/shared/store/confirmStore';

/**
 * 通用确认对话框的**唯一挂载点**（store 驱动）。
 *
 * 存在的理由：确认需求来自非 React 模块（`debug` runner、store action），它们无法渲染
 * 组件，只能 `await confirmAction(...)`。把渲染收在这一个宿主里，调用方与 UI 解耦：
 * 新增确认场景只需调用 store，不必碰任何布局代码。
 *
 * 生命周期：挂载时把就绪标记置位，卸载时清除 —— 标记用于避免"无宿主时请求永久挂起"
 * （见 `confirmStore.setConfirmHostMounted`）。
 */
const ConfirmHost: React.FC = () => {
  const pending = useConfirmStore((s) => s.pending);
  const resolve = useConfirmStore((s) => s.resolve);

  useEffect(() => {
    setConfirmHostMounted(true);
    return () => {
      setConfirmHostMounted(false);
      // 宿主消失时把**在途**请求按"取消"结算。`request` 只在"无宿主"时立即结算，若宿主是在
      // 请求挂起期间消失（应用卸载 / 未来把 AppModals 改成条件渲染），Promise 会永久悬挂 ——
      // 与"无宿主 → false"是同一条不变式：**fail-closed，且绝不悬挂**。
      useConfirmStore.getState().resolve(false);
    };
  }, []);

  return (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        // 遮罩点击 / Esc / 取消按钮都走这里：一律按"未确认"结算。
        if (!open) resolve(false);
      }}
      title={pending?.title ?? ''}
      description={pending?.message ?? ''}
      confirmLabel={pending?.confirmLabel ?? 'Confirm'}
      danger={pending?.danger ?? false}
      onConfirm={() => resolve(true)}
    />
  );
};

export default React.memo(ConfirmHost);
