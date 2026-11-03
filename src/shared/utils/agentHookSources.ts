import type { HookInstallStatus } from '@/shared/types/notification';

/**
 * CLI hook 的**配置形状与状态判定**（纯函数，无 React / 无 IPC）。
 *
 * 为什么在 `shared/` 而不是 `features/settings/`：`AGENT_HOOK_SOURCES_KEY` 是**跟栈的领域事实**
 * （镜像 `agent/hooks/install/config/settings.rs` 写进 `config.json` 的键），
 * `HookInstallStatus` 也住在 `shared/types/notification`。把「这个键怎么读 / 某一行算不算需要装」
 * 绑到某个 UI feature 上，会让领域键跟着界面搬家；这里只答判据，谁消费谁在 feature 侧。
 *
 * **唯一实现原则**：判据只能有一处。复制一份必然漂移 ——
 * 「安装状态说未安装、设置页说已安装」是最难自证的一类 bug。
 * 当前消费方：`features/settings/components/CliHooksSection`（开关 + 逐 CLI 覆盖 + 重装）。
 *
 * 2026-11-03：侧栏的 `project/components/CliHookHint` / `project/hooks/useCliHookHealth`
 * 与它们专用的 `hookRowsNeedingAttention` 按用户要求删除（常驻提示条被判为噪声），
 * 「hook 未生效」的可见性回到设置页的安装状态列 —— 本文件只少了那个纯函数，剩余判据不变。
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
