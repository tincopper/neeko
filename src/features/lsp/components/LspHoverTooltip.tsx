interface LspHoverTooltipProps {
  content: string | null;
  x: number;
  y: number;
  onClose: () => void;
}

export function LspHoverTooltip({ content, x, y, onClose }: LspHoverTooltipProps) {
  if (!content) return null;

  return (
    <>
      {/* Backdrop to capture clicks and close */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop has onKeyDown */}
      <div
        role="presentation"
        className="fixed inset-0 z-40"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === ' ') onClose();
        }}
        onMouseMove={(e) => e.stopPropagation()}
      />
      <div
        className="fixed z-50 max-w-md max-h-64 overflow-y-auto rounded-lg border border-border bg-bg-primary px-3 py-2 shadow-xl text-xs"
        style={{ top: y + 8, left: x }}
      >
        <pre className="whitespace-pre-wrap text-text-primary font-mono text-xs leading-relaxed">
          {content}
        </pre>
      </div>
    </>
  );
}
