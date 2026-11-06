import { useEffect } from 'react';

import type { AppConfig } from '@/features/settings/types';

import { projectTheme, projectTypography } from '../bootstrap/configProjection';

export interface ConfigProjectionInput {
  config: AppConfig;
  /** 自定义主题的变量表；内置主题为 `null`。与 `config.theme` 由 owner 同批提交。 */
  themeVars: Record<string, string> | null;
  /** config 是否已从磁盘加载完成。 */
  hydrated: boolean;
}

/**
 * 把 config 的**展示字段**投影到全局环境：DOM 主题 / 自定义 CSS 变量 / 字体 token /
 * 终端主题 / agent 主题。
 *
 * ## 为什么与 owner 分开
 *
 * owner 管「config 从哪来、写到哪去」（IPC + 并发契约）；本 hook 管「config 如何生效到
 * 窗口」（副作用）。两者变更理由不同：加一个投影点不该翻保存逻辑，反之亦然。
 *
 * ## 两条硬约束
 *
 * 1. **必须等 `hydrated`**：`DEFAULT_CONFIG` 的投影会覆盖 `bootstrap()` 刚写好的首帧主题
 *    hint，等于把「闪黑」重新引回来。
 * 2. **输入必须成对**：`config.theme` 与 `themeVars` 由 owner 在同一次提交里写入，故本 hook
 *    看到的一定是同一代快照 —— 这是投影原子性在 React 侧的前提（见 `configProjection`）。
 */
export function useConfigProjection({ config, themeVars, hydrated }: ConfigProjectionInput): void {
  const { monoFontFamily, fontFamily, appearanceFontSize, terminalFontSize, theme } = config;

  useEffect(() => {
    if (!hydrated) return;
    projectTypography({
      monoFamily: monoFontFamily ?? fontFamily ?? '',
      uiFontSize: appearanceFontSize,
      monoFontSize: terminalFontSize,
    });
  }, [hydrated, monoFontFamily, fontFamily, appearanceFontSize, terminalFontSize]);

  useEffect(() => {
    if (!hydrated) return;
    if (!projectTheme({ theme, customThemeVariables: themeVars })) {
      console.warn(`[App] 自定义主题 "${theme}" 的变量未就绪，保留上一帧主题`);
    }
  }, [hydrated, theme, themeVars]);
}
