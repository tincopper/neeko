/**
 * 主题首帧同步缓存 —— 唯一用途：让 `bootstrap()` 在 React 首帧之前就能读到主题。
 *
 * 为什么需要：`config.json` 只能经 Tauri `invoke` 异步读取，而 CSS 在首帧就读
 * `data-theme`。若首帧用 `DEFAULT_CONFIG.theme`（dark）兜底、加载完再改成用户主题
 * （light），整窗就会翻转一次。这里把上一次投影的结果同步缓存起来，启动时先应用；
 * `configProjection` 每次投影都回写，两者始终同源。
 *
 * 边界：本模块只读写缓存，**不碰 DOM**（DOM 写入只许在 `configProjection`）。
 */
const THEME_HINT_KEY = 'neeko.theme-hint';

export interface ThemeHint {
  theme: string;
  customThemeVariables: Record<string, string> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readThemeHint(): ThemeHint | null {
  try {
    const raw = localStorage.getItem(THEME_HINT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.theme !== 'string' || !parsed.theme) return null;
    const vars = parsed.customThemeVariables;
    if (vars !== null && vars !== undefined && !isRecord(vars)) return null;
    const customThemeVariables =
      vars === null || vars === undefined
        ? null
        : (Object.fromEntries(
            Object.entries(vars).filter(([, value]) => typeof value === 'string'),
          ) as Record<string, string>);
    return { theme: parsed.theme, customThemeVariables };
  } catch {
    // 隐私模式 / 配额 / 脏数据：退回 CSS 兜底，绝不阻断启动
    return null;
  }
}

export function writeThemeHint(hint: ThemeHint): void {
  try {
    localStorage.setItem(THEME_HINT_KEY, JSON.stringify(hint));
  } catch {
    // 缓存是加速项，不是事实源；写失败不影响投影本身
  }
}
