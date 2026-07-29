import { Bug, Bot, Layers, Terminal } from 'lucide-react';

import neekoIcon from '@/assets/neeko-icon.png';

interface WelcomeScreenProps {
  onAddProject: () => void;
  onImportSessions?: () => void;
}

export function WelcomeScreen({ onAddProject, onImportSessions }: WelcomeScreenProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-accent-blue/15 flex items-center justify-center mb-5">
        <img src={neekoIcon} alt="" className="w-8 h-8" draggable={false} />
      </div>

      <p className="text-[var(--font-size)] text-text-secondary max-w-[300px] mb-8 leading-relaxed">
        Unified desktop workspace for AI agents, terminals, skills, and debugging
      </p>

      <div className="flex flex-col gap-2.5 w-full max-w-[280px] mb-6">
        <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-bg-hover/60 border border-border/50 text-left">
          <Bot size={18} className="text-accent-blue shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[var(--font-size)] font-medium text-text-primary">
              Multi-Agent Sessions
            </div>
            <div className="text-[11px] text-text-muted">
              Manage context across Claude, Codex, Gemini…
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-bg-hover/60 border border-border/50 text-left">
          <Terminal size={18} className="text-accent-blue shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[var(--font-size)] font-medium text-text-primary">
              Integrated Terminal
            </div>
            <div className="text-[11px] text-text-muted">Auto-locates project directory</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-bg-hover/60 border border-border/50 text-left">
          <Layers size={18} className="text-accent-blue shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[var(--font-size)] font-medium text-text-primary">
              Skill Library
            </div>
            <div className="text-[11px] text-text-muted">Cross-project skill sharing with tags</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-bg-hover/60 border border-border/50 text-left">
          <Bug size={18} className="text-accent-blue shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[var(--font-size)] font-medium text-text-primary">
              LSP & DAP Debug
            </div>
            <div className="text-[11px] text-text-muted">
              Code intelligence and breakpoints in-editor
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="add-project-btn w-full max-w-[280px] px-6 py-2.5 bg-accent-blue border-none rounded-md text-text-primary text-[var(--font-size)] font-medium cursor-pointer transition-colors duration-200 hover:opacity-90"
        onClick={onAddProject}
      >
        Add Your First Project
      </button>
      {onImportSessions && (
        <button
          type="button"
          className="mt-3 text-[12px] text-text-muted hover:text-text-secondary bg-transparent border-none cursor-pointer"
          onClick={onImportSessions}
        >
          or import from historical sessions
        </button>
      )}
    </div>
  );
}
