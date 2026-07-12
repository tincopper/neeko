import React, { useCallback, useEffect, useRef, useState } from 'react';

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  minRightWidth?: number;
}

const SplitPane: React.FC<SplitPaneProps> = ({
  left,
  right,
  defaultLeftWidth = 260,
  minLeftWidth = 200,
  minRightWidth = 200,
}) => {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = leftWidth;
    },
    [leftWidth],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startXRef.current;
      const newWidth = startWidthRef.current + diff;
      const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 0;
      const clamped = Math.max(minLeftWidth, Math.min(newWidth, containerWidth - minRightWidth));
      setLeftWidth(clamped);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, minLeftWidth, minRightWidth]);

  return (
    <div
      ref={containerRef}
      className="flex flex-1 min-h-0 overflow-hidden"
      style={{ userSelect: isDragging ? 'none' : undefined }}
    >
      <div className="overflow-auto shrink-0" style={{ width: leftWidth }}>
        {left}
      </div>
      <div
        className="w-[4px] cursor-col-resize shrink-0 hover:bg-accent-blue active:bg-accent-blue transition-colors duration-100"
        onMouseDown={handleMouseDown}
      />
      <div className="flex-1 overflow-hidden min-w-0">{right}</div>
    </div>
  );
};

export default React.memo(SplitPane);
