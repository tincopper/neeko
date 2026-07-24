import { getCurrentWindow } from '@tauri-apps/api/window';
import React, { useEffect, useMemo, useState } from 'react';

import { Minus, Square, Copy, X } from '@/shared/components/icons';

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = useMemo(() => {
    try {
      return getCurrentWindow();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!appWindow) return;

    let cancelled = false;
    appWindow.isMaximized().then((value) => {
      if (!cancelled) setIsMaximized(value);
    });
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then((value) => {
        if (!cancelled) setIsMaximized(value);
      });
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, [appWindow]);

  if (!appWindow) return null;

  return (
    <div className="flex items-stretch shrink-0">
      <button className="wc-btn" onClick={() => appWindow.minimize()} title="Minimize">
        <Minus size={14} strokeWidth={1.5} />
      </button>
      <button
        className="wc-btn"
        onClick={() => (isMaximized ? appWindow.unmaximize() : appWindow.maximize())}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <Copy size={14} strokeWidth={1.2} />
        ) : (
          <Square size={14} strokeWidth={1.2} />
        )}
      </button>
      <button className="wc-btn wc-close" onClick={() => appWindow.destroy()} title="Close">
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export default React.memo(WindowControls);
