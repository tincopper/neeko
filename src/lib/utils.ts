import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * 字体阶梯 token（`src/styles/base/tailwind.css` 的 `@theme inline`）。
 *
 * `text-micro` / `text-meta` / … 是**字号**，但 `tailwind-merge` 只认识 Tailwind 自带的
 * `text-sm|xs|…`，于是把它们当成**颜色**类 —— 与 `text-text-secondary` 这类真颜色类一起交给
 * `cn()` 时，后出现的会把前一个**丢掉**（实测 `twMerge('text-meta text-text-secondary')`
 * → `'text-text-secondary'`）。表现是「写了字号但不生效」，而写法上完全看不出来。
 *
 * 修法是把这份阶梯交给 merge 认识，而不是让每个调用点自己规避（`text-[length:…]` 或拆元素）——
 * 后者要 60 处都记得，漏一处就是一次静默回归。
 *
 * **加字号 token 必须同步这里**：`tailwind.css` 的 `@theme inline` 块新增一行，这里也加一行，
 * 否则新 token 会重新落回「被当颜色」的坑。
 */
const FONT_SIZE_TOKENS = ['micro', 'meta', 'ui', 'ui-md', 'ui-lg', 'section'] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...FONT_SIZE_TOKENS] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
