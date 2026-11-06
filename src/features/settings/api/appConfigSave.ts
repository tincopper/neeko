/**
 * `config.json` 保存侧的**纯逻辑**：把一次「保存意图」合并到基线、并落盘。
 *
 * ## 为什么与 `appConfigNormalize` 分开
 *
 * 那两个文件的职责是**读**与**写**的分界：
 * - `appConfigNormalize`：磁盘 JSON → 规范化 `AppConfig`（只读解析）；
 * - 本文件：增量 + 基线 → 待落盘的完整配置，以及「排队读改写」的执行壳。
 *
 * 合成一个文件时它会同时承担两件事，且都会长（前者已有 223 行）。分开后
 * 「读侧规则」与「写侧并发契约」各有落点，改一边不必翻另一个主题的代码。
 *
 * ## 核心契约（并发正确性）
 *
 * `config.json` 是**一份**多域共享的可变文件，且按**整份覆盖**写入（后端 `save_config`
 * 不做补丁）。调用方手里的增量通常是渲染期快照，而 `config` 只在启动时读过盘 ——
 * 于是「先切通知开关（另一个写入者已落盘）→ 再改字号」会用陈旧快照把
 * `notification` / `agentHookSources` / `projectOnboarding` 覆盖回去。
 *
 * 串行门（[`runConfigWrite`]）只保证**不交叠**，挡不住「用过期的读」。
 * 故 [`persistConfigSave`] 必须在临界区**内**重新读盘取基线。
 */

import type { AppConfig } from '@/features/settings/types';
import { runConfigWrite } from '@/shared/utils/configWriteGate';

import { mergeLspConfig, normalizeLoadedConfig } from './appConfigNormalize';

export type ConfigSaveInput = AppConfig | ((current: AppConfig) => Partial<AppConfig>);

/**
 * 把一次「保存意图」应用到一个**基线**配置上，返回要落盘的完整配置。
 *
 * 这是纯函数（零 IO、零 React），故 `saveConfig` 的合并规则可直测 ——
 * 「updater 在磁盘现值上求值」这件事是并发正确性的关键，不该埋在 hook 里无法单独验证。
 *
 * ## 为什么基线必须是「临界区内的磁盘现值」
 *
 * `config.json` 是**一份**多域共享的可变文件，而它是按**整份覆盖**写入的
 *（后端 `save_config` 不做补丁）。调用方手里的增量通常是渲染期快照
 *（`{...config, 某个字段}`），而 `config` 只在启动时读过盘。于是
 *「先切通知开关（另一个写入者已落盘）→ 再改字号」会用启动时的陈旧快照
 * 把 `notification` / `agentHookSources` / `projectOnboarding` 覆盖回去。
 *
 * 串行门（`@/shared/utils/configWriteGate`）只保证**不交叠**，挡不住「用过期的读」。
 * 故基线必须由写点在队列内重新读盘取得，本函数只负责把它与增量合并。
 *
 * ## 写入面
 *
 * 经 `useAppConfigOwner.saveConfig` 写入的调用方（设置页各面板 / 隐藏 agent 开关）都走这条路径，
 * 因此都自动获得以上两条保证。CLI hook 的窄键写入走 `sessionApi.patchConfig`，
 * 它同样在 `runConfigWrite` 临界区内重新读盘，但不经过本函数（否则会把通用 `AppConfig`
 * 当成本次完整写入意图）。
 *
 * 顺序即契约：
 * 1. `input` 若是函数 → 用 `base` 求值（updater 形态，`base` 必须是**临界区内的磁盘现值**）；
 * 2. 幂等迁移：`monoFontFamily` 变化时同步 `fontFamily`；
 * 3. `lsp` 块规范化（`mergeLspConfig`）；
 * 4. 把增量盖在 `base` 上（`base` 携带未建模键，故不会抹掉别的域）。
 */
export function applyConfigSave(base: AppConfig, input: ConfigSaveInput): AppConfig {
  const patch = typeof input === 'function' ? input(base) : input;
  // 幂等迁移：monoFontFamily → fontFamily（读旧写新，只影响本次增量）。
  const migrated: Partial<AppConfig> =
    typeof patch.monoFontFamily === 'string' && patch.monoFontFamily !== patch.fontFamily
      ? { ...patch, fontFamily: patch.monoFontFamily }
      : patch;
  const merged: AppConfig = {
    ...base,
    ...(migrated.lsp ? { ...migrated, lsp: mergeLspConfig(migrated.lsp) } : migrated),
  } as AppConfig;
  return { ...merged, lsp: mergeLspConfig(merged.lsp) };
}

/**
 * 把一次保存意图**落盘**：在 `runConfigWrite` 临界区内读盘、合并、写回。
 *
 * 抽成独立函数（而不是内联在 hook 里）的三个理由：
 * 1. 它是「读-改-写必须整体不可交叠」这条契约的**唯一实现点**，值得有自己的落点；
 * 2. hook 只剩副作用编排（乐观 setState / 主题加载），体量不涨；
 * 3. 传 `load`/`save` 两个函数注入，故可用内存 fake 直测「基线取磁盘现值」这件事
 *   （否则只能起 `renderHook` + mock invoke）。
 *
 * @param load 读磁盘原始 JSON（生产传 `settingsApi.loadConfig`）
 * @param save 写整份配置（生产传 `settingsApi.saveConfig`）
 */
export async function persistConfigSave(
  input: ConfigSaveInput,
  load: () => Promise<unknown>,
  save: (config: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  await runConfigWrite(async () => {
    // 基线**只能**是临界区内的磁盘现值（见 `applyConfigSave` 的文档）。
    const current = normalizeLoadedConfig(await load()).config;
    const authoritative = applyConfigSave(current, input);
    await save(authoritative as unknown as Record<string, unknown>);
  });
}

/**
 * 磁盘 JSON → 规范化配置。
 *
 * 幂等迁移与容错都在这里（纯函数，无 IO）：旧 `fontSize → terminalFontSize`、
 * 旧 `fontFamily → monoFontFamily`、`lsp` 块补全。**最后一个动作是铺开未建模键**，
 * 再由已建模字段覆盖 —— 顺序即契约（见模块头）。
 */
