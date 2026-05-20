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
  "flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border/60 bg-bg-secondary text-left cursor-pointer transition-all duration-200 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary hover:border-border hover:shadow-sm hover:-translate-y-px active:translate-y-0 whitespace-nowrap overflow-hidden";

const ICON_CLASS =
  "shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-bg-tertiary";

function ProjectGuidePage({
  selectedAgent,
  selectedIde,
  onOpenTerminal,
  onOpenAgent,
  onOpenIde,
  onOpenSettings,
}: ProjectGuidePageProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 animate-in fade-in slide-in-from-bottom-3 duration-500 ease-out">
      <div className="flex flex-col items-center gap-4">
        <img
          src={neekoIcon}
          alt=""
          className="w-14 h-14 rounded-2xl border border-border shadow-md select-none pointer-events-none"
          draggable={false}
        />
        <div className="text-center">
          <h2 className="text-base font-semibold text-text-primary tracking-tight">Welcome to Neeko</h2>
          <p className="text-xs text-text-muted mt-1 max-w-[240px]">
            Your multi-agent workspace for managing AI sessions across local, WSL, and remote projects.
          </p>
        </div>
      </div>
      <div className="flex flex-col items-start gap-2 w-full max-w-[300px] px-4">
        <button
          className={ROW_CLASS + " w-full"}
          style={{ fontSize: "calc(var(--font-size) + 1px)" }}
          onClick={onOpenTerminal}
        >
          <span className={ICON_CLASS}>
            <svg
              width="16"
              height="16"
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
          <span className="truncate">Open Terminal</span>
          <span className="ml-auto text-[10px] opacity-30 shrink-0">Ctrl+`</span>
        </button>

        {selectedAgent && (
          <button
            className={ROW_CLASS + " w-full"}
            style={{ fontSize: "calc(var(--font-size) + 1px)" }}
            onClick={onOpenAgent}
          >
            <span className={ICON_CLASS}>
              <AgentIcon icon={selectedAgent.icon} />
            </span>
            <span className="truncate">Open {selectedAgent.name}</span>
            <span className="ml-auto text-[10px] opacity-30 shrink-0">Ctrl+Shift+A</span>
          </button>
        )}

        {selectedIde && (
          <button
            className={ROW_CLASS + " w-full"}
            style={{ fontSize: "calc(var(--font-size) + 1px)" }}
            onClick={onOpenIde}
          >
            <span className={ICON_CLASS}>
              <svg
                width="16"
                height="16"
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
            <span className="truncate">Open in {selectedIde}</span>
            <span className="ml-auto text-[10px] opacity-30 shrink-0">Ctrl+Shift+I</span>
          </button>
        )}

        <button
          className={ROW_CLASS + " w-full"}
          style={{ fontSize: "calc(var(--font-size) + 1px)" }}
          onClick={onOpenSettings}
        >
          <span className={ICON_CLASS}>
            <Settings size={16} strokeWidth={2} />
          </span>
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}

export default React.memo(ProjectGuidePage);
