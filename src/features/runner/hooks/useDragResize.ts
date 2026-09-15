/**
 * 拖拽缩放（面板高度 / 侧栏宽度）+ 尺寸持久化。
 *
 * 抽出的理由（Neeko Check F10）：`DebugPanel` 里「拖上沿改高度」与「拖左沿改宽度」是**两段
 * 逐行同构**的实现（preventDefault/stopPropagation → 起点 → 夹取 min/max → mousemove/mouseup
 * 监听 → 光标与 user-select → 松手持久化），只是轴向、光标、上限来源不同。同构代码抄两遍时
 * 任何一处修 bug（例如忘了清 `document.body.style`）都会漏改另一处。
 *
 * 设计要点：
 * - **不用 ref**：手势起点由闭包里的 `latest` 跟踪 —— 拖动是一次连续手势，起点即按下时的 `size`，
 *   无需「ref 镜像最新值 + effect 同步」（项目规范亦要求 ref 同步集中，能不用就不用）。
 * - **上限可动态**：面板高度上限按视口比例算，故 `max` 支持函数形式。
 * - **卸载兜底**：拖动中卸载（关面板）会残留 `cursor`/`userSelect`，故 hook 自带清理。
 */
import { useCallback, useEffect, useState } from 'react';

/** 轴向：`vertical` = 拖上沿改高度（clientY 反向）；`horizontal` = 拖左沿改宽度。 */
type DragAxis = 'vertical' | 'horizontal';

export interface DragResizeSpec {
  /** localStorage 键（松手时持久化，下次挂载直接复用）。 */
  storageKey: string;
  defaultSize: number;
  min: number;
  /** 固定上限，或按环境动态计算（如 `() => window.innerHeight * 0.7`）。 */
  max: number | (() => number);
  axis: DragAxis;
  /** 拖动期间的光标（`row-resize` / `col-resize`）。 */
  cursor: string;
}

export interface DragResize {
  size: number;
  startResize: (e: React.MouseEvent) => void;
}

function readStored(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // 隐私模式 / 配额满：尺寸持久化失败不影响本次会话，忽略。
  }
}

export function useDragResize(spec: DragResizeSpec): DragResize {
  const { storageKey, defaultSize, min, max, axis, cursor } = spec;
  const [size, setSize] = useState(() => readStored(storageKey, defaultSize));

  // 拖动中卸载（关面板）→ 清掉挂在 body 上的拖动样式。
  useEffect(() => {
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startPos = axis === 'vertical' ? e.clientY : e.clientX;
      // 手势起点 = 按下时尺寸；`latest` 在闭包内跟踪，故不需要 ref。
      let latest = size;
      const limit = () => (typeof max === 'function' ? max() : max);

      const onMove = (ev: MouseEvent) => {
        const delta = axis === 'vertical' ? startPos - ev.clientY : ev.clientX - startPos;
        latest = Math.min(limit(), Math.max(min, size + delta));
        setSize(latest);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        writeStored(storageKey, latest);
      };

      document.body.style.cursor = cursor;
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [axis, cursor, max, min, size, storageKey],
  );

  return { size, startResize };
}
