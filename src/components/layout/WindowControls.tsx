import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";

export default function WindowControls() {
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
    <div className="window-controls">
      <button
        className="wc-btn wc-minimize"
        onClick={() => appWindow.minimize()}
        title="Minimize"
      >
        <Minus size={10} strokeWidth={1.5} />
      </button>
      <button
        className="wc-btn wc-maximize"
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
