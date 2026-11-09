import React, { useState } from 'react';

import { cn } from '@/lib/utils';

export interface FallbackImageProps {
  /** `null` = 直接渲染 fallback。 */
  src: string | null;
  /**
   * 边长（px）。仅当未传 `className` 时通过 inline style 生效 ——
   * 传了 `className` 就是调用方完全控制盒子。
   */
  size?: number;
  className?: string;
  alt?: string;
  title?: string;
  testId?: string;
  /** `src` 为空或加载失败（`onError`）时的兜底内容。 */
  fallback?: React.ReactNode;
}

/**
 * 纯展示原语：`<img>` + 加载失败兜底。
 *
 * 住 `shared/` 是因为它不依赖任何 feature 能力（解析 / Tauri 边界都在调用方）。
 * 尺寸语义：`className` 存在 → 调用方完全控制（不注入 inline style）；否则 `size` 生效。
 *
 * 失败态用**派生**而非 effect 重置：`failedFor === src` 即失败。`src` 一变，
 * 等式自然不成立 —— 不需要在 effect 里同步 `setState`（那会触发级联渲染）。
 */
const FallbackImage: React.FC<FallbackImageProps> = ({
  src,
  size,
  className,
  alt,
  title,
  testId,
  fallback,
}) => {
  const [failedFor, setFailedFor] = useState<string | null>(null);

  if (!src || failedFor === src) return <>{fallback ?? null}</>;

  return (
    <img
      className={cn('shrink-0 object-contain', className)}
      src={src}
      alt={alt ?? ''}
      title={title}
      width={size}
      height={size}
      style={className ? undefined : { width: size, height: size }}
      data-testid={testId}
      onError={() => setFailedFor(src)}
    />
  );
};

export default React.memo(FallbackImage);
