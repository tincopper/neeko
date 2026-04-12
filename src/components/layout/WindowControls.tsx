import { useEffect, useState } from "react";
import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className="flex items-stretch shrink-0 ml-auto">
      <button
        className="wc-btn"
        onClick={() => appWindow.minimize()}
        title="Minimize"
      >
        <Minus size={10} strokeWidth={1.5} />
      </button>
      <button
        className="wc-btn"
        onClick={() => isMaximized ? appWindow.unmaximize() : appWindow.maximize()}
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? (
          <Copy size={10} strokeWidth={1.2} />
        ) : (
          <Square size={10} strokeWidth={1.2} />
        )}
      </button>
      <button
        className="wc-btn wc-close"
        onClick={() => appWindow.close()}
        title="Close"
      >
        <X size={10} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export default React.memo(WindowControls);
