import { createContext, useContext, type ReactNode } from 'react';

/**
 * 子树可见性域 —— 「常驻挂载 + hidden 切换」容器的**唯一**可见性信号。
 *
 * ## 第一性原理
 *
 * 为了消除 `React.lazy` 挂载间隙造成的空帧，常驻方案把子树从「首次可见才挂载」改成
 * 「启动即挂载、只切 `display`」。代价是：**mount 副作用**（列表拉取、订阅）从
 * 「用户真的打开它时」提前到了**应用启动**，从不使用该子树的用户白付这份成本。
 *
 * 结论：挂载 ≠ 可见。凡是「可能隐藏但常驻」的子树，其 mount 副作用必须按可见性门控，
 * 而可见性只能由**挂载方**声明（子树无法判断自己是 dock 面板还是中心视图）。
 *
 * 默认 `true`：独立挂载（dock 面板 / 单测）行为不变 —— 只有显式声明「可能隐藏」的
 * 容器才需要包 `VisibilityScope`。
 */
const VisibilityScopeContext = createContext(true);

/** 声明子树当前是否可见。 */
export function VisibilityScope({ visible, children }: { visible: boolean; children?: ReactNode }) {
  return (
    <VisibilityScopeContext.Provider value={visible}>{children}</VisibilityScopeContext.Provider>
  );
}

/** 当前子树是否可见（无 Provider 时恒为 `true`）。 */
export function useVisible(): boolean {
  return useContext(VisibilityScopeContext);
}
