import React from "react";
import type { AppTheme, ThemeListItem } from '@/features/settings/types';
import { cn } from '@/lib/utils';
import { Switch } from "@/ui";

interface AppearancePanelProps {
  appearanceFontSize: number;
  theme: AppTheme;
  enablePiThemeSync: boolean;
  enableOpenCodeThemeSync: boolean;
  customThemes: ThemeListItem[];
  onAppearanceFontSizeChange: (size: number) => void;
  onThemeChange: (theme: AppTheme) => void;
  onPiThemeSyncChange: (enabled: boolean) => void;
  onOpenCodeThemeSyncChange: (enabled: boolean) => void;
}

const BUILTIN_THEME_SWATCHES: { id: string; label: string; bg: string; textColor: string }[] = [
  { id: "dark",          label: "Dark",         bg: "#1f1f1f", textColor: "#78a0dc" },
  { id: "classic-dark",  label: "Classic Dark", bg: "#26292F", textColor: "#2997ff" },
  { id: "one-dark-pro",  label: "One Dark Pro", bg: "#282c34", textColor: "#61afef" },
  { id: "claude",        label: "Claude",        bg: "#f5f0e8", textColor: "#c96442" },
  { id: "light",         label: "Light",         bg: "#ffffff", textColor: "#2f7cd3" },
];

const AppearancePanel: React.FC<AppearancePanelProps> = ({
  appearanceFontSize,
  theme,
  enablePiThemeSync,
  enableOpenCodeThemeSync,
  customThemes,
  onAppearanceFontSizeChange,
  onThemeChange,
  onPiThemeSyncChange,
  onOpenCodeThemeSyncChange,
}) => {
  return (
    <div className="flex flex-col">
      <h3 className="text-base font-semibold text-text-primary mb-4">Appearance</h3>
      <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Font Size
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Controls sidebar, project list, file tree, and tab font size.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="size-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
            onClick={() => onAppearanceFontSizeChange(appearanceFontSize - 1)}
            disabled={appearanceFontSize <= 10}
          >
            &minus;
          </button>
          <span className="min-w-[44px] text-center text-[0.86em] text-text-primary tabular-nums">
            {appearanceFontSize}px
          </span>
          <button
            className="size-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
            onClick={() => onAppearanceFontSizeChange(appearanceFontSize + 1)}
            disabled={appearanceFontSize >= 24}
          >
            +
          </button>
        </div>
      </div>

      <label className="text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">
        Theme
      </label>
      <div className="flex gap-3 flex-wrap">
        {BUILTIN_THEME_SWATCHES.map((s) => (
          <button
            key={s.id}
            className={cn(
              "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150 cursor-pointer bg-bg-tertiary hover:bg-bg-hover",
              theme === s.id ? "border-accent-blue" : "border-transparent",
            )}
            onClick={() => onThemeChange(s.id)}
          >
            <div
              className="w-16 h-10 rounded border border-white/10 flex items-center justify-center"
              style={{ backgroundColor: s.bg }}
            >
              <span className="text-xs font-semibold" style={{ color: s.textColor }}>Aa</span>
            </div>
            <span className="text-sm text-text-primary">{s.label}</span>
          </button>
        ))}
      </div>

      {customThemes.length > 0 && (
        <>
          <label className="text-xs font-medium text-text-secondary mt-4 mb-1.5 uppercase tracking-wide">
            Custom Themes
          </label>
          <div className="flex gap-3 flex-wrap">
            {customThemes.map((ct) => (
              <button
                key={ct.name}
                className={cn(
                  "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150 cursor-pointer bg-bg-tertiary hover:bg-bg-hover",
                  theme === ct.name ? "border-accent-blue" : "border-transparent",
                )}
                onClick={() => onThemeChange(ct.name)}
              >
                <div className="w-16 h-10 rounded border border-white/10 bg-bg-primary flex items-center justify-center">
                  <span className="text-accent-blue text-xs font-semibold">Aa</span>
                </div>
                <span className="text-sm text-text-primary">{ct.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="text-[0.72em] text-text-muted mt-3">
        Theme files location: ~/.neeko/themes/*.json
      </div>

      {/* Pi Theme Sync Toggle */}
      <div className="flex items-center justify-between py-3 border-b border-white/[0.04]">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Sync Pi Theme
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Automatically write .pi/settings.json theme to project directories.
          </div>
        </div>
        <Switch
          checked={enablePiThemeSync}
          onCheckedChange={onPiThemeSyncChange}
        />
      </div>

      {/* OpenCode Theme Sync Toggle */}
      <div className="flex items-center justify-between py-3">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Sync OpenCode Theme
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Automatically write .opencode/tui.json theme to project directories.
          </div>
        </div>
        <Switch
          checked={enableOpenCodeThemeSync}
          onCheckedChange={onOpenCodeThemeSyncChange}
        />
      </div>
    </div>
  );
};

export default React.memo(AppearancePanel);
