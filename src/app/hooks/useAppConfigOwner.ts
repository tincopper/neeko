import { useState, useEffect, useCallback } from 'react';

import { setLspImportStrategy } from '@/features/lsp/api/lspImportStrategy';
import {
  DEFAULT_CONFIG,
  isBuiltinTheme,
  normalizeLoadedConfig,
} from '@/features/settings/api/appConfigNormalize';
import {
  applyConfigSave,
  persistConfigSave,
  type ConfigSaveInput,
} from '@/features/settings/api/appConfigSave';
import { resolveCustomThemeVars } from '@/features/settings/api/customThemeResolver';
import {
  listCustomThemes,
  loadConfig as loadConfigApi,
  saveConfig as saveConfigApi,
} from '@/features/settings/api/settingsApi';
import type { AppConfig, ThemeListItem } from '@/features/settings/types';

import { useConfigProjection } from './useConfigProjection';

/** `load_config` 悬挂时的兜底延迟：窗口不能被一次不返回的 IPC 永久卡在 splash。 */
const CONFIG_LOAD_TIMEOUT_MS = 3000;

/**
 * **应用唯一的 config owner**。禁止从任何 barrel 导出，唯一调用点是 `useAppShellData`。
 *
 * 它持有 `AppConfig` state 并承担应用级 IO（`load_config` / `save_config`）；把 config
 * 投影到窗口的副作用在 `useConfigProjection`，纯解析/合并规则在 `features/settings/api/`。
 *
 * 曾经它叫 `useAppConfig` 且从 `@/features/settings` 门面导出，看起来与普通 feature hook
 * 无异 —— 于是 `ViewSkillDialog`（`open=false` 也挂载）成了第二个 owner，mount 时把
 * `data-theme` 重置成 dark 再异步改回 light，整窗主题翻转（Skills 闪黑）。
 *
 * 现在：owner 私有 + 投影集中到 `bootstrap/configProjection` + `hydrated` 门控，
 * 且由 `check_config_owner_singleton` 护栏机器校验「调用点恰好一个」。
 *
 * ## 为什么留在 `app/` 而不是 feature 里
 *
 * 它是 config 领域（`features/settings/api/` 的解析/保存）与**应用级投影**
 * （`app/bootstrap/`）之间的接缝。放进 feature 会让 feature 反向依赖组合根，
 * 故 owner 在 app、领域纯逻辑在 feature 的公开面（`api/`）。
 *
 * ## 主题的两个半份必须同批提交
 *
 * `theme` 与 `themeVars` 一律在同一 tick 写入（`setThemeVars` 紧跟 `setConfig`），
 * React 批处理成一次渲染 ⇒ 投影只跑一次且输入成对。自定义主题的变量若在提交主题名之后
 * 才到，中间那一帧就是无配色（见 `configProjection` 的原子投影契约）。
 */
export function useAppConfigOwner() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [customThemes, setCustomThemes] = useState<ThemeListItem[]>([]);
  const [themeVars, setThemeVars] = useState<Record<string, string> | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useConfigProjection({ config, themeVars, hydrated });

  /**
   * `config.json` 的**唯一写点**：串行化 + 临界区内读盘合并。
   * 契约全文见 `appConfigSave.applyConfigSave`；调用方不得再包 `runConfigWrite`。
   */
  const saveConfig = useCallback(
    async (next: ConfigSaveInput) => {
      const normalized = applyConfigSave(config, next);
      // 变量**先解析再提交**：投影是原子的，不能先换主题名再补变量（会留一帧无配色）
      const vars = isBuiltinTheme(normalized.theme)
        ? null
        : await resolveCustomThemeVars(normalized.theme);
      // 补全源跑在 CM6 回调里，只能同步读模块缓存 —— 写入方唯一在此
      setLspImportStrategy(normalized.lsp.importStrategy);
      // 两行同 tick ⇒ 一次渲染 ⇒ 投影输入成对
      setThemeVars(vars);
      setConfig(normalized);
      try {
        await persistConfigSave(next, loadConfigApi, saveConfigApi);
      } catch (e) {
        console.error('[App] Failed to save config:', e);
        throw e;
      }
    },
    [config],
  );

  useEffect(() => {
    (async () => {
      try {
        setCustomThemes(await listCustomThemes());
      } catch (e) {
        console.error('[App] Failed to load custom themes:', e);
      }
    })();
  }, []);

  // 兜底：`load_config` 悬挂（后端卡死 / IPC 不返回）时同样要退出 splash。
  useEffect(() => {
    if (hydrated) return;
    const timer = setTimeout(() => {
      console.warn(
        `[App] load_config 超过 ${CONFIG_LOAD_TIMEOUT_MS}ms 未返回，先以默认配置退出加载态`,
      );
      setHydrated(true);
    }, CONFIG_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [hydrated]);

  useEffect(() => {
    (async () => {
      try {
        const loaded = await loadConfigApi();
        if (loaded && typeof loaded === 'object') {
          // 纯解析抽在 `api/appConfigNormalize`（零副作用、可直测）；本 hook 只编排副作用
          const { config: next, theme, needsCustomThemeVars } = normalizeLoadedConfig(loaded);
          // 变量先落 state、再落 config（同 tick）⇒ 首次投影即成对
          setThemeVars(needsCustomThemeVars ? await resolveCustomThemeVars(theme) : null);
          setLspImportStrategy(next.lsp.importStrategy);
          setConfig(next);
        }
      } catch (e) {
        console.error('[App] Failed to load config:', e);
      } finally {
        // 失败也必须退出 splash（退回 DEFAULT_CONFIG），不能让窗口永久停在加载态
        setHydrated(true);
      }
    })();
  }, []);

  return { config, saveConfig, customThemes, hydrated };
}
