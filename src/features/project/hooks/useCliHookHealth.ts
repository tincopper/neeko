import { useCallback, useEffect, useRef, useState } from 'react';

import {
  applyCliHooks,
  getCliHookStatus,
  getNotificationSettings,
} from '@/features/notification/api/notificationApi';
import { loadConfig } from '@/features/settings/api/settingsApi';
import { useAppViewStore } from '@/shared/store/appViewStore';
import {
  hookRowsNeedingAttention,
  installableHookRows,
  isHookSourceEnabled,
  readSourceOverrides,
} from '@/shared/utils/agentHookSources';

/**
 * 「CLI hook 是否在生效」的健康检查（侧栏提示用）。
 *
 * # 为什么需要它
 *
 * 会话标题最权威的来源是 CLI 自己的 hook 上报（`live_sessions::wiring::hooks`）。hook 没装、
 * 装旧了、或 CLI 侧还没确认信任时，那一路会**静默失效** —— 用户只会看到「标题不跟随 CLI」，
 * 却没有任何线索指向「hook 没生效」。本 hook 把那件事变成可见的提示 + 一个重新安装入口。
 *
 * # 判据与设置页同源
 *
 * `hookRowsNeedingAttention`（`shared/utils/agentHookSources`）与设置页用的是同一份实现：
 * 复制一份必然漂移，而「提示说未安装、设置页说已安装」是最难自证的一类 bug。
 *
 * # 失败一律降级为「没有提示」
 *
 * 读状态 / 读配置失败 ⇒ 行集为空 ⇒ 不渲染任何东西。侧栏是主界面，不能因为一次探测失败
 * 弹出常驻提示条（与 `getCliHookStatus` / `getNotificationSettings` 的 fail-soft 契约一致）。
 */

/** 一次探测的结果：需要提示的 CLI + 重新安装要覆盖的 CLI。 */
interface HookHealthSnapshot {
  attention: string[];
  enabled: string[];
}

/**
 * 探测实现（纯异步，不碰 React state —— 便于在 effect 与按钮里共用）。
 *
 * 配置读取失败不是「没有覆盖项」：后者表示所有 CLI 跟随主开关，前者表示
 * 当前选择未知。把未知当默认启用会提示错误，并可能在重装时恢复用户已关掉的 CLI。
 */
async function probeHealth(): Promise<HookHealthSnapshot> {
  const [rows, config, settings] = await Promise.all([
    getCliHookStatus(),
    loadConfig(),
    getNotificationSettings(),
  ]);
  const overrides = readSourceOverrides(config as Record<string, unknown>);
  // 主开关来自通知设置：用户主动关掉 hook 之后不该再被提示（那是和用户的选择打架）。
  const masterEnabled = settings.cliHooks !== false;
  return {
    attention: hookRowsNeedingAttention(rows, overrides, masterEnabled).map((row) => row.source),
    // 重装集合：本机检测到 + 用户没关掉的可安装 CLI。
    enabled: installableHookRows(rows)
      .filter((row) => row.path !== '' && isHookSourceEnabled(row.source, overrides, masterEnabled))
      .map((row) => row.source),
  };
}

export interface CliHookHealth {
  /** 需要提示的 CLI（未安装 / 过期 / 未信任）；空数组 ⇒ 不提示。 */
  attentionSources: string[];
  /** 正在安装（按钮 loading）。 */
  installing: boolean;
  /** 重新安装：把「应当安装」的 CLI 全部重装一遍，随后刷新状态。 */
  reinstall: () => Promise<void>;
  /** 上一次安装失败的回执；成功或无需提示时为空。 */
  error: string | null;
}

export function useCliHookHealth(): CliHookHealth {
  const [attentionSources, setAttentionSources] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 重装时要覆盖的 CLI（探测结果的最新一份，不放 state：它只被按钮读取）。 */
  const enabledSourcesRef = useRef<string[]>([]);
  const appView = useAppViewStore((s) => s.appView);

  const apply = useCallback((snapshot: HookHealthSnapshot): void => {
    enabledSourcesRef.current = snapshot.enabled;
    setAttentionSources(snapshot.attention);
  }, []);

  useEffect(() => {
    // 设置页和侧栏同时保活；从设置页返回时重新探测，否则安装/关闭 hook 后提示会停在旧状态。
    if (appView === 'settings') return;
    let cancelled = false;
    void probeHealth()
      .then((snapshot) => {
        if (cancelled) return;
        apply(snapshot);
        // 外部修复（重新安装 / 手改配置）后也要清掉上一次失败，否则横幅永远停在旧错误。
        // 仍有待处理项时保留错误详情；健康后横幅本就应消失。
        if (snapshot.attention.length === 0) setError(null);
      })
      // 探测失败 ⇒ 静默不提示（fail-soft）。没有这条 catch 会变成未处理的 rejection：
      // 侧栏是主界面，一次探测抖动不该冒到全局错误面板。
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apply, appView]);

  const reinstall = useCallback(async (): Promise<void> => {
    // 探测失败时 enabled 集合的语义未知，禁止用空集调用 apply（空集会被后端解释为
    // 「全部启用」的反面依据之一，且无法区分用户显式关闭项）。
    if (enabledSourcesRef.current.length === 0) return;
    setInstalling(true);
    setError(null);
    try {
      const outcomes = await applyCliHooks(true, enabledSourcesRef.current);
      const failed = outcomes.filter((outcome) => outcome.status === 'failed');
      if (failed.length > 0) {
        setError(failed.map((o) => `${o.source}: ${o.detail ?? 'failed'}`).join('; '));
      }
      apply(await probeHealth());
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  }, [apply]);

  return { attentionSources, installing, reinstall, error };
}
