/**
 * config → 全局环境的**唯一投影点**。
 *
 * 第一性原理：CSS（`data-theme` / CSS 变量 / 字体 token）与 TS 是同一份 AppConfig 的两个
 * 读者。投影者必须恰好一个；曾经每个 `useAppConfig()` 实例都自带一份投影，于是「挂载一个
 * 关闭态 dialog」就能把整窗主题重置成 dark 再改回 light（Skills 闪黑）。
 *
 * ## 投影必须是原子的
 *
 * 一次主题由**两半**组成：`data-theme` 属性 + 自定义主题的 CSS 变量表。二者若分开应用，
 * 中间必然出现「主题名已换、变量还没到」的一帧 —— 自定义主题的配色只存在于变量里，
 * 那一帧就是无配色（掉回基础 token）。故本模块只接受三种结果，没有第四种：
 *
 * - 内置主题 → 写属性 + 清理变量；
 * - 自定义主题且变量就绪 → 写属性 + 应用变量；
 * - 自定义主题但变量未就绪 → **什么都不写**（保留上一帧），返回 `false` 由调用方记账。
 *
 * 同理，`themeHint`（首帧同步缓存）只在投影**成功**后回写：缓存记录的是「上一帧真实生效
 * 的主题」，不是「配置里写了什么」。把半套主题写进缓存，下次冷启动就会用它渲染首帧 ——
 * 那正是本模块存在的理由。
 *
 * 判断「这次改动是不是投影」只看一个地方：本文件。`setAttribute('data-theme')` /
 * `dataset.theme =` 只允许出现在这里，由 `check_config_owner_singleton` 护栏机器校验。
 */
import { isBuiltinTheme } from '@/features/settings/api/appConfigNormalize';
import { syncAgentTheme } from '@/features/settings/api/settingsApi';
import { updateAllTerminalThemes } from '@/features/terminal';
import { useConnectionStore } from '@/shared/store/connectionStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { syncTypographyTokens } from '@/shared/utils/typography';

import { applyCustomCssVars, clearCustomCssVars } from './customThemeVars';
import { readThemeHint, writeThemeHint } from './themeHint';

export interface ThemeProjection {
  theme: string;
  /** 自定义主题的变量表；内置主题为 `null`。 */
  customThemeVariables: Record<string, string> | null;
}

export interface TypographyProjectionArgs {
  monoFamily: string;
  uiFontSize: number;
  monoFontSize: number;
}

/** 字体 / 字号 token：只读 config 的字体字段，语义与原 `useAppConfig` 的字体 effect 一致。 */
export function projectTypography(args: TypographyProjectionArgs): void {
  syncTypographyTokens(args);
}

/**
 * 终端主题依赖 CSS 变量的新值，故排到下一帧。连续投影只保留最后一次 ——
 * 不是取消副作用，而是合并：同一帧内重画一次就够了。
 */
let pendingTerminalRefresh = 0;
function scheduleTerminalThemeRefresh(): void {
  if (pendingTerminalRefresh) cancelAnimationFrame(pendingTerminalRefresh);
  pendingTerminalRefresh = requestAnimationFrame(() => {
    pendingTerminalRefresh = 0;
    updateAllTerminalThemes();
  });
}

/**
 * 已知项目的 agent 主题同步（扇出到后端）。
 *
 * 与 DOM 投影是两个变更理由：前者关心「后端 agent 配色」，后者关心「窗口配色」，
 * 故各自独立成函数，投影只负责按序调用。
 */
function syncAgentThemeForKnownProjects(theme: string): void {
  const { projects } = useProjectStore.getState();
  const { wslEntries } = useConnectionStore.getState();
  const localPaths = projects.map((p) => p.path);
  const wsl = wslEntries.flatMap((e) =>
    e.projects.map((p) => ({ distro: e.distro, path: p.path })),
  );
  if (localPaths.length === 0 && wsl.length === 0) return;
  syncAgentTheme(theme, { local_paths: localPaths, wsl }).catch((e) => {
    console.error('[App] Failed to sync agent theme:', e);
  });
}

/**
 * 主题投影：DOM 主题 + 自定义变量 + 同步缓存 + 终端主题 + agent 主题。
 *
 * @returns `false` = 自定义主题的变量尚未就绪，本次**未**投影（DOM 保留上一帧）。
 */
export function projectTheme({ theme, customThemeVariables }: ThemeProjection): boolean {
  const builtin = isBuiltinTheme(theme);
  const vars = builtin ? null : customThemeVariables;
  if (!builtin && !vars) return false;

  document.documentElement.setAttribute('data-theme', theme);
  if (vars) applyCustomCssVars(vars);
  else clearCustomCssVars();

  writeThemeHint({ theme, customThemeVariables: vars });
  scheduleTerminalThemeRefresh();
  syncAgentThemeForKnownProjects(theme);
  return true;
}

/**
 * 首帧前应用上一次的主题（由 `bootstrap()` 在 `createRoot().render()` 之前调用）。
 *
 * 无缓存（首次启动 / 升级后首启）时什么都不做，沿用 `:root:not([data-theme])` 兜底；
 * 自定义主题的变量是主题的一半 —— 缓存里缺变量时同样退回 CSS 兜底，绝不写半套主题。
 */
export function applyThemeHintBeforeRender(): void {
  const hint = readThemeHint();
  if (!hint) return;
  if (!isBuiltinTheme(hint.theme) && !hint.customThemeVariables) return;
  document.documentElement.setAttribute('data-theme', hint.theme);
  if (hint.customThemeVariables) applyCustomCssVars(hint.customThemeVariables);
}
