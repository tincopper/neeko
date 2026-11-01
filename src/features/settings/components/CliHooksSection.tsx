/**
 * 外部 Agent CLI hooks 分区（从 `NotificationSettingsSection` 抽出，见组件规模红线 ≤300 行）。
 *
 * 职责边界：本组件只拥有「CLI hook 的开关面与状态呈现」——
 * - 主开关（`NotificationSettings.cliHooks`，通知核心域的**意图**字段）的持久化由父组件承担
 *   （它持有设置串行链），本组件通过 `onMasterChange` 回调请求变更；
 * - 逐 CLI 覆盖（`config.json` 的 `agentHookSources`）与文件面同步（`agent_hooks_apply`）
 *   是 agent 域的知识，**完整收在本组件内**（父组件不该知道这些细节）。
 *
 * 为什么逐 CLI 行是数据驱动的：行清单来自 `agent_hooks_status`（后端事实表 `HOOK_TARGETS`），
 * 新增一个受管 CLI 无需改本文件 —— 与 `NOTIFIABLE_EVENTS` 同一哲学。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { applyCliHooks, getCliHookStatus } from '@/features/notification/api/notificationApi';
import { patchConfig } from '@/features/session/api/sessionApi';
import { loadConfig } from '@/features/settings/api/settingsApi';
import { useNotify } from '@/shared/hooks/useNotify';
import type { HookApplyOutcome, HookInstallStatus } from '@/shared/types/notification';
// 判定与配置形状住在 `shared/`：侧栏的「未生效」提示用的是**同一套**判据
// （复制一份必然漂移 —— 提示说未安装、设置页说已安装，是最难自证的一类 bug）。
import {
  AGENT_HOOK_SOURCES_KEY,
  installableHookRows,
  isHookSourceEnabled,
  readSourceOverrides,
} from '@/shared/utils/agentHookSources';
import { Switch } from '@/ui';

/** 回执呈现文案：`pi: skipped (…)` —— status 是判定源，detail 只做补充。 */
function describeOutcome(outcome: HookApplyOutcome): string {
  return outcome.detail
    ? `${outcome.source}: ${outcome.status} (${outcome.detail})`
    : `${outcome.source}: ${outcome.status}`;
}

/** 从磁盘读取覆盖表；读取成功才代表“没有覆盖项”，失败必须由调用方保留未知态。 */
async function loadSourceOverrides(): Promise<Record<string, boolean>> {
  return readSourceOverrides(await loadConfig());
}

/**
 * 状态行文案：**把「装了但不生效」说出来**。
 *
 * 为什么单独一个函数：`trusted === false` 是本项目反复出现的「装了但没通知」形态的
 * 显式编码 —— Codex 对未信任的 `hooks.json` hook **静默跳过且不报错**，若 UI 只显示
 * 「已安装」，用户会以为审批通知已生效。此处必须如实提示需要用户去 CLI 里确认一次。
 */
export function describeHookStatus(hook: HookInstallStatus): string {
  if (hook.installed && hook.trusted === false) {
    return `${hook.path} — needs confirmation in the CLI`;
  }
  if (!hook.installed) return 'not installed';
  return hook.versionCurrent ? hook.path : `${hook.path} (outdated)`;
}

/**
 * 按主开关 + 覆盖表算出「应处于安装态」的 CLI 集合。
 *
 * `null` **只**表示主开关关闭（命令契约里 `enabled=false` + `null` = 全部卸载）；
 * 主开关开启时必须给出显式集合。`known` 为空代表状态未知，绝不能返回 `null` ——
 * 后端会把它解释为「全部启用」，从而重装用户明确关掉的 CLI。调用方必须先验状态。
 */
export function enabledSourcesFor(
  master: boolean,
  known: HookInstallStatus[],
  overrides: Record<string, boolean>,
): string[] | null {
  if (!master) return null;
  return known.map((h) => h.source).filter((s) => isHookSourceEnabled(s, overrides, master));
}

interface CliHooksSectionProps {
  /** 主开关当前值（来自父组件的设置快照）。 */
  master: boolean;
  /** 请求父组件变更主开关（走它的串行保存链）。 */
  onMasterChange: (checked: boolean) => void;
  /** 主开关写入完成后由父组件调用，用于触发文件面同步。 */
  syncToken?: number;
}

const CliHooksSection: React.FC<CliHooksSectionProps> = ({
  master,
  onMasterChange,
  syncToken = 0,
}) => {
  const [hookStatus, setHookStatus] = useState<HookInstallStatus[]>([]);
  const [sourceOverrides, setSourceOverrides] = useState<Record<string, boolean>>({});
  /**
   * 覆盖表是否来自一次成功读取。
   *
   * `{}` 同时可能表示「磁盘上确实没有覆盖项」和「读取失败后的初始值」；把两者混为一谈
   * 会让文件面收敛把用户关掉的 CLI 重新安装。未知时只能在动作路径上重新读盘，禁止猜默认。
   */
  const overridesKnown = useRef(false);
  /** 读取代次：写入/新读取会让旧的异步回包失效，避免初始读盘覆盖刚保存的选择。 */
  const overrideReadVersion = useRef(0);
  /** 逐 CLI 变更的串行链（与父组件的设置链相互独立：写的是不同 config 键）。 */
  const chain = useRef<Promise<void>>(Promise.resolve());
  const { notify } = useNotify();

  useEffect(() => {
    let alive = true;
    const version = ++overrideReadVersion.current;
    void getCliHookStatus().then((s) => {
      if (alive) setHookStatus(s);
    });
    void loadSourceOverrides()
      .then((cfg) => {
        if (!alive || version !== overrideReadVersion.current) return;
        overridesKnown.current = true;
        setSourceOverrides(cfg);
      })
      .catch(() => {
        if (!alive || version !== overrideReadVersion.current) return;
        overridesKnown.current = false;
        // 读盘失败 ⇒ 覆盖选择未知；保留上一次已确认值，动作路径会再次读盘或明确报错。
      });
    return () => {
      alive = false;
    };
  }, []);

  /** 读盘失败后的回滚：只有本次读取仍是最后一次请求时才能覆盖本地状态。 */
  const restoreOverrides = useCallback(async (): Promise<void> => {
    const version = ++overrideReadVersion.current;
    try {
      const current = await loadSourceOverrides();
      if (version !== overrideReadVersion.current) return;
      overridesKnown.current = true;
      setSourceOverrides(current);
    } catch {
      if (version === overrideReadVersion.current) overridesKnown.current = false;
    }
  }, []);

  /** 同步文件面：把生效集合交给 agent 域命令，并按机器可读 status 分类提示。 */
  const syncHooks = useCallback(
    async (nextMaster: boolean, overrides: Record<string, boolean>) => {
      let rows = installableHookRows(hookStatus);
      // status 查询失败会被 API fail-soft 成空列表；此时 `null` 在命令契约里表示
      // 「全部启用」，继续下发会重新安装用户明确关掉的 CLI。开启主开关时只能中止。
      if (nextMaster && rows.length === 0) {
        // 初始状态可能还没回来或瞬时失败，动作路径再探一次；仍为空才中止。
        const refreshed = installableHookRows(await getCliHookStatus());
        if (refreshed.length > 0) {
          rows = refreshed;
          setHookStatus(refreshed);
        }
      }
      if (nextMaster && rows.length === 0) {
        throw new Error('hook status unavailable');
      }
      const results = await applyCliHooks(
        nextMaster,
        enabledSourcesFor(nextMaster, rows, overrides),
      );
      setHookStatus(await getCliHookStatus());
      const failed = results.filter((r) => r.status === 'failed');
      const skipped = results.filter((r) => r.status === 'skipped');
      if (failed.length) {
        notify(`CLI hooks: ${failed.map(describeOutcome).join('; ')}`, 'error');
      } else if (skipped.length) {
        // 中性状态（同名他人文件保护 / 用户配置不可处理等）：如实呈现，不弹错误。
        notify(`CLI hooks: ${skipped.map(describeOutcome).join('; ')}`, 'info');
      } else {
        notify('CLI hooks updated', 'info');
      }
    },
    [hookStatus, notify],
  );

  /**
   * 主开关变更后由父组件驱动同步（`syncToken` 每次递增）。
   *
   * 用 token 而非把 `syncHooks` 上抛：父组件只该知道「我改了意图」，不该知道
   * 「还要调 agent 域命令」——后者是本分区的内部知识。
   */
  const lastToken = useRef(syncToken);
  useEffect(() => {
    if (syncToken === lastToken.current) return;
    lastToken.current = syncToken;
    chain.current = chain.current
      .then(async () => {
        let overrides = overridesKnown.current ? sourceOverrides : null;
        if (!overrides) {
          const version = ++overrideReadVersion.current;
          try {
            overrides = await loadSourceOverrides();
          } catch {
            if (version === overrideReadVersion.current) overridesKnown.current = false;
            notify('CLI hooks: failed to read hook selection', 'error');
            return;
          }
          if (version === overrideReadVersion.current) {
            overridesKnown.current = true;
            setSourceOverrides(overrides);
          }
        }
        await syncHooks(master, overrides);
      })
      .catch(() => {
        notify('CLI hooks: failed to update hook files', 'error');
      });
  }, [syncToken, master, sourceOverrides, syncHooks, notify]);

  /** 逐 CLI 开关：写 `agentHookSources` + 立即重同步文件面。 */
  const toggleSource = useCallback(
    (source: string, checked: boolean) => {
      // 已知时先乐观更新；未知时不伪造其它键，等 updater 读到磁盘现值后再整体落定。
      ++overrideReadVersion.current;
      if (overridesKnown.current) {
        setSourceOverrides((current) => ({ ...current, [source]: checked }));
      }
      chain.current = chain.current.then(async () => {
        let nextOverrides: Record<string, boolean> | null = null;
        // updater 在全局 configWriteGate 临界区内读取磁盘现值；合并而不是替换整个
        // 覆盖表，避免并发/未知初始值把其它 CLI 的选择抹掉。
        try {
          await patchConfig((current) => {
            nextOverrides = { ...readSourceOverrides(current), [source]: checked };
            return { [AGENT_HOOK_SOURCES_KEY]: nextOverrides };
          });
        } catch {
          await restoreOverrides();
          notify('Failed to save CLI hook selection', 'error');
          return;
        }
        if (!nextOverrides) {
          await restoreOverrides();
          notify('Failed to save CLI hook selection', 'error');
          return;
        }
        overridesKnown.current = true;
        setSourceOverrides(nextOverrides);
        if (!master) return;
        try {
          await syncHooks(master, nextOverrides);
        } catch {
          // 配置已成功落盘，不能把它当作保存失败回滚；文件面错误单独呈现。
          notify('CLI hooks: failed to update hook files', 'error');
        }
      });
    },
    [master, notify, restoreOverrides, syncHooks],
  );

  return (
    <>
      <div className="text-[0.86em] text-text-primary font-medium mt-3 mb-1">
        External agent CLI hooks
      </div>
      <div className="flex items-start justify-between gap-4 py-2 border-b border-border-subtle">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[0.86em] text-text-primary">
            Notify agents launched in my terminal
          </span>
          <span className="text-[0.72em] text-text-muted">
            Installs a status reporter into each CLI&apos;s own config dir (never overwrites other
            tools&apos; entries)
          </span>
        </div>
        <div className="shrink-0 pt-0.5">
          <Switch
            aria-label="Notify agents launched in my terminal"
            checked={master}
            onCheckedChange={onMasterChange}
          />
        </div>
      </div>
      {master &&
        installableHookRows(hookStatus).map((hook) => (
          <div
            key={hook.source}
            className="flex items-start justify-between gap-4 py-2 border-b border-border-subtle"
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[0.86em] text-text-primary">{hook.source}</span>
              <span className="text-[0.72em] text-text-muted truncate">
                {describeHookStatus(hook)}
              </span>
            </div>
            <div className="shrink-0 pt-0.5">
              <Switch
                aria-label={`Install hook for ${hook.source}`}
                checked={sourceOverrides[hook.source] !== false}
                onCheckedChange={(checked) => void toggleSource(hook.source, checked)}
              />
            </div>
          </div>
        ))}
    </>
  );
};

export default React.memo(CliHooksSection);
