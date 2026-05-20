import React from "react";
import { cn } from "../../utils/cn";

/**
 * IconTile — 统一的图标容器组件
 *
 * 把"品牌 logo / 字母占位 / lucide glyph"都关进同一套尺寸 / 圆角 / 内边距规则。
 * 避免第三方 brand asset 直接落地导致的视觉不一致。
 *
 * 三种 variant:
 * - brand:  品牌色背景 + 内嵌图片（72% 尺寸），用于 agent logo / IDE logo
 * - glyph:  无背景，纯 lucide icon，用于 sidebar 子项 / dock 按钮
 * - letter: 品牌色背景 + 居中字母，用于项目头像
 */

export type IconTileSize = "xs" | "sm" | "md" | "lg";
export type IconTileVariant = "brand" | "glyph" | "letter";

export interface IconTileProps {
  /** 尺寸档位 */
  size?: IconTileSize;
  /** 内容类型 */
  variant?: IconTileVariant;
  /** 品牌色 / 字母头像色（hex），仅 brand / letter variant 使用 */
  bg?: string;
  /** 品牌图片 src，仅 brand variant */
  src?: string | null;
  /** 图片 alt 文本 */
  alt?: string;
  /** lucide icon 元素，仅 glyph variant */
  glyph?: React.ReactNode;
  /** 字母文本，仅 letter variant */
  letter?: string;
  /** 是否激活态（显示 accent ring） */
  active?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const sizeClasses: Record<IconTileSize, string> = {
  xs: "w-4 h-4 rounded-[4px]",
  sm: "w-5 h-5 rounded-[5px]",
  md: "w-7 h-7 rounded-md",
  lg: "w-10 h-10 rounded-[9px]",
};

const letterSizeClasses: Record<IconTileSize, string> = {
  xs: "text-[0.55em]",
  sm: "text-[0.6em]",
  md: "text-[0.72em]",
  lg: "text-[0.8em]",
};

export const IconTile: React.FC<IconTileProps> = React.memo(
  ({
    size = "sm",
    variant = "brand",
    bg,
    src,
    alt = "",
    glyph,
    letter,
    active = false,
    className,
    style,
  }) => {
    const inlineStyle: React.CSSProperties = {
      ...style,
      ...(bg ? { backgroundColor: bg } : {}),
    };

    return (
      <span
        aria-hidden={variant === "letter" ? "true" : undefined}
        className={cn(
          "icon-tile relative inline-flex items-center justify-center flex-shrink-0 overflow-hidden",
          sizeClasses[size],
          variant === "glyph" && "bg-transparent",
          variant !== "glyph" && "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]",
          active && "icon-tile-active",
          className,
        )}
        style={inlineStyle}
      >
        {variant === "brand" && src && (
          <img
            src={src}
            alt={alt}
            className="w-[72%] h-[72%] object-contain"
            draggable={false}
          />
        )}
        {variant === "glyph" && glyph}
        {variant === "letter" && (
          <span
            className={cn(
              "font-semibold tracking-[-0.02em]",
              letterSizeClasses[size],
            )}
            style={{ color: "inherit" }}
          >
            {letter}
          </span>
        )}
        {active && (
          <span className="absolute -inset-[2px] rounded-[inherit] border-[1.5px] border-accent pointer-events-none" />
        )}
      </span>
    );
  },
);

IconTile.displayName = "IconTile";

export default IconTile;
