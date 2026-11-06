/**
 * 自定义主题变量表的解析与缓存 —— `get_custom_theme` 的唯一调用方。
 *
 * ## 为什么单独成模块
 *
 * 变量表是主题投影的**另一半**：投影是原子的（见 `app/bootstrap/configProjection.ts`），
 * 提交新主题之前必须先把变量拿到，否则必然出现「主题名已换、变量还没到」的一帧。
 * 解析（IO + 缓存）与投影（DOM 写入）变更理由不同，故分开落点。
 *
 * ## 缓存生命周期
 *
 * 进程级：主题文件在应用内被编辑后，需重新选中才会重新拉取（与旧 `useAppConfig` 的
 * ref 缓存语义一致 —— owner 恰好一个后，per-instance 与 per-process 等价）。
 * 失败/不存在返回 `null`，由调用方决定是否推迟投影，而不是静默用空变量表顶上。
 */
import { getCustomTheme } from '@/features/settings/api/settingsApi';
import type { CustomThemeData } from '@/features/settings/types';

const cache = new Map<string, CustomThemeData>();

/** 解析自定义主题的变量表（命中缓存直接返回，未命中拉一次）。 */
export async function resolveCustomThemeVars(
  themeName: string,
): Promise<Record<string, string> | null> {
  const cached = cache.get(themeName);
  if (cached) return cached.variables;
  try {
    const data = await getCustomTheme(themeName);
    if (!data) return null;
    cache.set(themeName, data);
    return data.variables ?? null;
  } catch (e) {
    console.error(`[App] Failed to load custom theme "${themeName}":`, e);
    return null;
  }
}

/** 测试用：清空进程级缓存（生产代码无调用方）。 */
export function clearCustomThemeVarsCache(): void {
  cache.clear();
}
