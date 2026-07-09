import { useEffect, useRef, useState } from "react";
import React from "react";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "@/shared/components/icons"

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [ready, setReady] = useState(false);
  const appWindowRef = useRef<Window | null>(null);

  useEffect(() => {
    try {
      const appWindow = getCurrentWindow();
      appWindowRef.current = appWindow;

      appWindow.isMaximized().then(setIsMaximized);
      const unlisten = appWindow.onResized(() => {
        appWindow.isMaximized().then(setIsMaximized);
      });
      setReady(true);

      return () => {
        unlisten.then((fn) => fn());
      };
    } catch {
      setReady(false);
    }
  }, []);

  if (!ready) return null;

  const appWindow = appWindowRef.current!;

  return (
    <div className="flex items-stretch shrink-0">
      <button
        className="wc-btn"
        onClick={() => appWindow.minimize()}
        title="Minimize"
      >
        <Minus size={14} strokeWidth={1.5} />
      </button>
      <button
        className="wc-btn"
        onClick={() => isMaximized ? appWindow.unmaximize() : appWindow.maximize()}
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? (
          <Copy size={14} strokeWidth={1.2} />
        ) : (
          <Square size={14} strokeWidth={1.2} />
        )}
      </button>
      <button
        className="wc-btn wc-close"
        onClick={() => appWindow.destroy()}
        title="Close"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export default React.memo(WindowControls);
