import type { HookInstallStatus } from '@/shared/types/notification';

/**
 * CLI hook 的**配置形状与状态判定**（纯函数，无 React / 无 IPC）。
 *
 * 放在 `shared/` 是因为两个 feature 都要用同一套判据：
 * - 设置页（`settings/components/CliHooksSection`）管开关与逐 CLI 覆盖；
 * - 侧栏提示（`project/components/CliHookHint`）在「装了但不生效」时提示 + 重新安装。
 *
 * 复制一份判定就会漂移：提示说「未安装」而设置页说「已安装」是最难自证的一类 bug。
 */

/** `config.json` 中承载逐 CLI hook 开关的键（镜像 `agent/hooks/install/config/settings.rs`）。 */
export const AGENT_HOOK_SOURCES_KEY = 'agentHookSources';

/**
 * 过滤掉**自供源**（不需要 Neeko 安装的 CLI，如 DSH）。
 *
 * 为什么必须过滤而不是渲染成「未安装」：`HOOK_TARGETS` 同时驱动「接收白名单」与
 * 「Neeko 能装哪些 CLI」。DSH 只满足前者 —— 它的上报由自己的插件
 * （`packages/dsh-neeko`）完成，Neeko 不该往用户 profile 写文件。
 *
 * 判据是后端显式字段 `selfSupplied`，**不是** `path === ''`：后者还可能是
 * 「目录定位不到」（CLI 本机未初始化）—— 那种仍要展示，用户可能要装它。
 */
export function installableHookRows(rows: readonly HookInstallStatus[]): HookInstallStatus[] {
  return rows.filter((row) => !row.selfSupplied);
}

/**
 * 读逐 CLI 覆盖表（畸形容忍：非对象 / 值非布尔 → 忽略）。
 * 键缺失 ⇒ 该 CLI 跟随主开关（默认启用）—— 与 Rust `hook_enabled_for` 同语义。
 */
export function readSourceOverrides(config: Record<string, unknown>): Record<string, boolean> {
  const raw = config[AGENT_HOOK_SOURCES_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * 该 CLI 的 hook **应当**处于安装态（主开关 + 逐 CLI 覆盖）。
 *
 * 键缺失 = 跟随主开关（默认启用），与 Rust 侧同语义 —— 别在这里加第二套默认值。
 */
export function isHookSourceEnabled(
  source: string,
  overrides: Record<string, boolean>,
  masterEnabled: boolean,
): boolean {
  return masterEnabled && overrides[source] !== false;
}

/**
 * 需要**提示 + 重新安装**的 CLI 行。
 *
 * 三个条件缺一不可，各自挡一类误报：
 * 1. 可安装（`installableHookRows`）—— 自供源没有安装腿；
 * 2. **本机检测到**（`path !== ''`）—— 目录定位不到说明这台机器没初始化该 CLI，
 *    此时提示「没装 hook」纯属噪声；
 * 3. 用户**没有明确关掉**它（`isHookSourceEnabled`）—— 用户主动关掉之后还反复提示，
 *    是在和用户的选择打架。
 *
 * 命中的形态（任一）：未安装 / 版本过期 / 已安装但 CLI 侧未信任（Codex 会静默跳过）。
 */
export function hookRowsNeedingAttention(
  rows: readonly HookInstallStatus[],
  overrides: Record<string, boolean>,
  masterEnabled: boolean,
): HookInstallStatus[] {
  return installableHookRows(rows).filter(
    (row) =>
      row.path !== '' &&
      isHookSourceEnabled(row.source, overrides, masterEnabled) &&
      (!row.installed || !row.versionCurrent || row.trusted === false),
  );
}
