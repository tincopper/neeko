import React from "react";
import { Settings } from "lucide-react";
import neekoIcon from "../../assets/neeko-icon.png";
import AgentIcon from "../layout/AgentIcon";
import type { AgentConfig } from "../../types";

interface ProjectGuidePageProps {
  selectedAgent: AgentConfig | null;
  selectedIde: string | null;
  onOpenTerminal: () => void;
  onOpenAgent: () => void;
  onOpenIde: () => void;
  onOpenSettings: () => void;
}

const ROW_CLASS =
  "flex items-center gap-3 px-3 py-2 rounded-md bg-transparent border-none text-left cursor-pointer transition-colors duration-150 text-text-secondary hover:bg-white/5 hover:text-text-primary";

const ICON_CLASS =
  "shrink-0 w-6 h-6 flex items-center justify-center opacity-70";

function ProjectGuidePage({
  selectedAgent,
  selectedIde,
  onOpenTerminal,
  onOpenAgent,
  onOpenIde,
  onOpenSettings,
}: ProjectGuidePageProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <img
        src={neekoIcon}
        alt=""
        className="w-10 h-10 mb-8 opacity-40 select-none pointer-events-none"
        draggable={false}
      />
      <div className="flex flex-col items-start gap-2">
        <button
          className={ROW_CLASS}
          style={{ fontSize: "calc(var(--font-size) + 2px)" }}
          onClick={onOpenTerminal}
        >
          <span className={ICON_CLASS}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </span>
          <span>Open Terminal</span>
        </button>

        {selectedAgent && (
          <button
            className={ROW_CLASS}
            style={{ fontSize: "calc(var(--font-size) + 2px)" }}
            onClick={onOpenAgent}
          >
            <span className={ICON_CLASS}>
              <AgentIcon icon={selectedAgent.icon} />
            </span>
            <span>Open {selectedAgent.name}</span>
          </button>
        )}

        {selectedIde && (
          <button
            className={ROW_CLASS}
            style={{ fontSize: "calc(var(--font-size) + 2px)" }}
            onClick={onOpenIde}
          >
            <span className={ICON_CLASS}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </span>
            <span>Open in {selectedIde}</span>
          </button>
        )}

        <button
          className={ROW_CLASS}
          style={{ fontSize: "calc(var(--font-size) + 2px)" }}
          onClick={onOpenSettings}
        >
          <span className={ICON_CLASS}>
            <Settings size={18} strokeWidth={2} />
          </span>
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}

export default React.memo(ProjectGuidePage);
