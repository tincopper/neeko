import { useState } from 'react';

interface ContextWindowMeterProps {
  /** Tokens used so far. */
  used: number;
  /** Total context window size in tokens. */
  total: number;
  /** Model name for the tooltip. */
  model: string;
}

/**
 * 上下文窗口计量器 —— SVG 环形进度圈 + hover tooltip + 点击弹出详情。
 * 颜色随使用率变化：绿色（正常）→ 黄色（70%+）→ 红色（90%+）。
 * 对齐原型 agent-chat-v3-redesign.html 的环形 + popover 交互。
 */
export default function ContextWindowMeter({ used, total, model }: ContextWindowMeterProps) {
  const [open, setOpen] = useState(false);
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const color =
    pct > 90 ? 'var(--accent-red)' : pct > 70 ? 'var(--accent-yellow)' : 'var(--accent-green)';
  const title = `${pct}% used · ${used}k/${total}k tokens · ${model}`;
  const remaining = Math.max(0, total - used);

  return (
    <div className="ctx-meter" title={title}>
      <button
        type="button"
        className="ctx-meter-btn"
        aria-label="查看上下文使用详情"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 36 36" width="22" height="22">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--border)" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r="15.9"
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeDashoffset="25"
          />
        </svg>
        <span className="ctx-meter-label">{pct}%</span>
      </button>

      {open && (
        <>
          <div
            className="drop-overlay"
            role="button"
            tabIndex={0}
            aria-label="关闭上下文详情"
            onClick={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <div className="ctx-meter-pop" role="dialog" aria-label="上下文窗口使用详情">
            <div className="ctx-pop-head">
              <span>Context window</span>
              <span className="ctx-pop-model">{model}</span>
            </div>
            <div className="ctx-pop-body">
              <div className="ctx-pop-ring">
                <svg viewBox="0 0 36 36" width="48" height="48">
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9"
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth="3.5"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="15.9"
                    fill="none"
                    stroke={color}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeDasharray={`${pct} ${100 - pct}`}
                    strokeDashoffset="25"
                  />
                </svg>
                <span className="ctx-pop-pct" style={{ color }}>
                  {pct}%
                </span>
              </div>
              <div className="ctx-pop-stats">
                <div className="ctx-pop-row">
                  <span>已使用</span>
                  <span className="ctx-pop-val">{used}k tokens</span>
                </div>
                <div className="ctx-pop-row">
                  <span>总容量</span>
                  <span className="ctx-pop-val">{total}k tokens</span>
                </div>
                <div className="ctx-pop-row">
                  <span>剩余</span>
                  <span className="ctx-pop-val">{remaining}k tokens</span>
                </div>
              </div>
            </div>
            <div className="ctx-pop-foot">
              {pct > 90 ? (
                <span style={{ color: 'var(--accent-red)' }}>接近上限，建议开启新会话</span>
              ) : pct > 70 ? (
                <span style={{ color: 'var(--accent-yellow)' }}>用量偏高</span>
              ) : (
                <span style={{ color: 'var(--accent-green)' }}>容量充足</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
