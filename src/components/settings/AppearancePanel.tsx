import React from "react";
import type { AppTheme } from "../../types";
import { cn } from "../../utils/cn";

interface AppearancePanelProps {
  appearanceFontSize: number;
  theme: AppTheme;
  onAppearanceFontSizeChange: (size: number) => void;
  onThemeChange: (theme: AppTheme) => void;
}

const AppearancePanel: React.FC<AppearancePanelProps> = ({
  appearanceFontSize,
  theme,
  onAppearanceFontSizeChange,
  onThemeChange,
}) => {
  return (
    <div className="flex flex-col">
      <h3 className="text-base font-semibold text-text-primary mb-4">Appearance</h3>
      <div className="flex items-center justify-between py-3 mb-4 border-b border-white/[0.04] gap-6">
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
            className="w-7 h-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
            onClick={() => onAppearanceFontSizeChange(appearanceFontSize - 1)}
            disabled={appearanceFontSize <= 10}
          >
            &minus;
          </button>
          <span className="min-w-[44px] text-center text-[0.86em] text-text-primary tabular-nums">
            {appearanceFontSize}px
          </span>
          <button
            className="w-7 h-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
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
        <button
          className={cn(
            "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150 cursor-pointer bg-bg-tertiary hover:bg-bg-hover",
            theme === "dark" ? "border-accent-blue" : "border-transparent",
          )}
          onClick={() => onThemeChange("dark")}
        >
          <div className="w-16 h-10 rounded border border-white/10 bg-[#000000] flex items-center justify-center">
            <span className="text-[#61afef] text-xs font-semibold">Aa</span>
          </div>
          <span className="text-sm text-text-primary">Dark</span>
        </button>

        <button
          className={cn(
            "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150 cursor-pointer bg-bg-tertiary hover:bg-bg-hover",
            theme === "one-dark-pro" ? "border-accent-blue" : "border-transparent",
          )}
          onClick={() => onThemeChange("one-dark-pro")}
        >
          <div className="w-16 h-10 rounded border border-white/10 bg-[#282c34] flex items-center justify-center">
            <span className="text-[#61afef] text-xs font-semibold">Aa</span>
          </div>
          <span className="text-sm text-text-primary">One Dark Pro</span>
        </button>

        <button
          className={cn(
            "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150 cursor-pointer bg-bg-tertiary hover:bg-bg-hover",
            theme === "claude" ? "border-accent-blue" : "border-transparent",
          )}
          onClick={() => onThemeChange("claude")}
        >
          <div className="w-16 h-10 rounded border border-black/10 bg-[#f5f0e8] flex items-center justify-center">
            <span className="text-[#c96442] text-xs font-semibold">Aa</span>
          </div>
          <span className="text-sm text-text-primary">Claude</span>
        </button>

        <button
          className={cn(
            "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all duration-150 cursor-pointer bg-bg-tertiary hover:bg-bg-hover",
            theme === "light" ? "border-accent-blue" : "border-transparent",
          )}
          onClick={() => onThemeChange("light")}
        >
          <div className="w-16 h-10 rounded border border-black/10 bg-[#ffffff] flex items-center justify-center">
            <span className="text-[#2f7cd3] text-xs font-semibold">Aa</span>
          </div>
          <span className="text-sm text-text-primary">Light</span>
        </button>
      </div>
    </div>
  );
};

export default React.memo(AppearancePanel);
