import { cloneElement, type ReactElement, type ReactNode } from 'react';

interface ComposeProvidersProps {
  /** Provider 元素数组：顺序 = 从外到内（第一个最外层）。元素需带 key。 */
  providers: ReactElement[];
  children: ReactNode;
}

/**
 * 平铺式 Provider 组合，缓解「Provider 地狱」手写嵌套的可读性问题。
 *
 * React 中多个 Provider 作用于同一 children 物理上只能嵌套；本组件把嵌套
 * 表达为元素数组 —— 读者一眼看到全部 Provider 清单，props 类型检查与补全
 * 在 JSX 层完成（无需为无参 Provider 包凑形状的 lambda）。
 * 顺序语义：数组从左到右 = 从外到内；存在跨 Provider 消费时，被依赖者放外侧。
 *
 * 实现用 cloneElement 仅注入嵌套 children：这是组合工具对数组元素的唯一
 * 改写点，业务 props 原样保留（React 对 cloneElement 的保留意见针对跨组件
 * 随意改写 props，此处不涉及）。
 */
export default function ComposeProviders({ providers, children }: ComposeProvidersProps) {
  return providers.reduceRight<ReactNode>(
    (acc, provider) => cloneElement(provider, undefined, acc),
    children,
  );
}
