import React from "react";
import WindowControls from "./WindowControls";
import TaskRunButton from "@/features/task/components/TaskRunButton";
import { DebugRunButton } from "@/features/debug";
import OpenIdeButton from "./OpenIdeButton";
import { IS_MACOS } from "@/shared/utils/platform";
import { useFullscreen } from "./useFullscreen";
import neekoIcon from "../assets/neeko-icon.png";

function TitleBar() {
  const isFullscreen = useFullscreen();

  return (
    <div
      className={`titlebar flex items-center h-8 shrink-0 select-none ${IS_MACOS && !isFullscreen ? 'pl-[72px]' : ''}`}
      data-tauri-drag-region
    >
      {/* Left: Neeko icon (visual anchor for the drag region) */}
      <div className="flex items-center px-2" data-tauri-drag-region>
        <div className="relative shrink-0 px-2 py-1 flex items-center gap-1" data-tauri-drag-region>
          <img src={neekoIcon} className="w-5 h-5 object-contain mx-1" alt="Neeko" data-tauri-drag-region />
        </div>
      </div>

      {/* Center spacer (draggable) */}
      <div className="flex-1" data-tauri-drag-region />

      {/* Right: OpenIde + Task + Debug + WindowControls */}
      <div className="flex items-center gap-2 shrink-0 px-2">
        <OpenIdeButton />
        <TaskRunButton />
        <DebugRunButton />
        {!IS_MACOS && <WindowControls />}
      </div>
    </div>
  );
}

export default React.memo(TitleBar);
