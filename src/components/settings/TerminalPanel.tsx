import React from "react";
import { PRESET_SHELLS } from "./constants";
import { cn } from "../../utils/cn";
import { Input } from "../ui";

interface TerminalPanelProps {
  terminalFontSize: number;
  fontFamily: string;
  shellInput: string;
  fontSearch: string;
  fontsLoading: boolean;
  fontListOpen: boolean;
  isCustomShell: boolean;
  filteredFonts: string[];
  fontDropdownRef: React.Ref<HTMLDivElement>;
  onTerminalFontSizeChange: (size: number) => void;
  onToggleFontList: () => void;
  onFontSearchChange: (value: string) => void;
  onApplyFont: (font: string) => void;
  onShellInputChange: (value: string) => void;
  onApplyShell: (value: string) => void;
}

const TerminalPanel: React.FC<TerminalPanelProps> = ({
  terminalFontSize,
  fontFamily,
  shellInput,
  fontSearch,
  fontsLoading,
  fontListOpen,
  isCustomShell,
  filteredFonts,
  fontDropdownRef,
  onTerminalFontSizeChange,
  onToggleFontList,
  onFontSearchChange,
  onApplyFont,
  onShellInputChange,
  onApplyShell,
}) => {
  return (
    <>
      <div className="text-[1em] font-semibold text-text-primary mb-5 pb-2.5 border-b border-border">
        Terminal
      </div>

      <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Font Size
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Font size for terminals and terminal tabs.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="w-7 h-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
            onClick={() => onTerminalFontSizeChange(terminalFontSize - 1)}
            disabled={terminalFontSize <= 10}
          >
            &minus;
          </button>
          <span className="min-w-[44px] text-center text-[0.86em] text-text-primary tabular-nums">
            {terminalFontSize}px
          </span>
          <button
            className="w-7 h-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
            onClick={() => onTerminalFontSizeChange(terminalFontSize + 1)}
            disabled={terminalFontSize >= 24}
          >
            +
          </button>
        </div>
      </div>

      <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Font Family
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Terminal font. System fonts are loaded automatically. Takes effect
            immediately on existing sessions.
          </div>
        </div>

        <div className="relative w-full" ref={fontDropdownRef}>
          <button
            className={cn(
              "flex items-center justify-between w-full py-[7px] px-2.5 bg-bg-tertiary border border-border rounded text-[0.86em] text-text-primary cursor-pointer text-left box-border transition-[border-color] duration-150 gap-2 hover:border-accent-blue",
              fontListOpen && "!border-accent-blue",
            )}
            onClick={onToggleFontList}
            style={{
              fontFamily: fontFamily ? `'${fontFamily}', monospace` : "monospace",
            }}
          >
            <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
              {fontFamily || "Default (JetBrains Mono / Fira Code)"}
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              {fontFamily && (
                <span
                  className="text-text-muted cursor-pointer text-[0.79em] leading-none py-px px-[3px] rounded-[3px] hover:text-text-primary hover:bg-bg-hover"
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onApplyFont("");
                  }}
                  title="Reset to default"
                >
                  &times;
                </span>
              )}
              <span className="text-[0.72em] text-text-muted">
                {fontListOpen ? "\u2212" : "+"}
              </span>
            </span>
          </button>

          {fontListOpen && (
            <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-bg-secondary border border-accent-blue rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.5)] z-[100] overflow-hidden">
              <div className="py-2 px-2 pb-1.5 border-b border-border">
                <Input
                  className="w-full box-border py-1 px-2 text-[0.86em]"
                  type="text"
                  placeholder="Search fonts..."
                  value={fontSearch}
                  onChange={(e) => onFontSearchChange(e.target.value)}
                  autoFocus
                  spellCheck={false}
                />
              </div>
              <div className="w-full max-h-[200px] overflow-y-auto">
                {fontsLoading ? (
                  <div className="p-4 text-center text-[0.82em] text-text-muted">
                    Loading system fonts...
                  </div>
                ) : filteredFonts.length === 0 ? (
                  <div className="p-4 text-center text-[0.82em] text-text-muted">
                    No fonts found
                  </div>
                ) : (
                  filteredFonts.map((font) => (
                    <button
                      key={font}
                      className={cn(
                        "flex items-center justify-between w-full py-[7px] px-3 bg-none border-none border-b border-white/[0.03] text-text-secondary text-[0.86em] cursor-pointer text-left box-border transition-[background-color] duration-100 gap-3 hover:bg-bg-hover hover:text-text-primary [&:last-child]:border-b-0",
                        fontFamily === font && "!bg-accent-blue/15 !text-accent-blue",
                      )}
                      onClick={() => onApplyFont(font)}
                      title={font}
                    >
                      <span className="shrink-0 font-medium min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                        {font}
                      </span>
                      <span
                        className="text-[0.86em] text-text-muted whitespace-nowrap shrink-0"
                        style={{ fontFamily: `'${font}', monospace` }}
                      >
                        AaBbCc
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Shell</div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Select a preset or enter a custom shell path. Takes effect on the
            next terminal session.
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 w-full">
          {PRESET_SHELLS.map(({ label, value }) => (
            <button
              key={value}
              className={cn(
                "py-1 px-3 bg-bg-tertiary border border-border rounded text-text-secondary text-[0.82em] cursor-pointer transition-all duration-150 whitespace-nowrap hover:bg-bg-hover hover:text-text-primary hover:border-text-muted",
                shellInput === value && "!bg-accent-blue !border-accent-blue !text-white",
              )}
              onClick={() => onApplyShell(value)}
              title={value || "Use $SHELL environment variable"}
            >
              {label}
            </button>
          ))}
        </div>

        <Input
          className={cn("py-[7px] px-2.5 text-[0.86em]", isCustomShell && "!border-accent-blue")}
          type="text"
          placeholder="Custom path, e.g. /usr/bin/zsh"
          value={shellInput}
          onChange={(e) => onShellInputChange(e.target.value)}
          onBlur={(e) => onApplyShell(e.target.value.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onApplyShell(shellInput.trim());
            }
          }}
          spellCheck={false}
        />
      </div>
    </>
  );
};

export default React.memo(TerminalPanel);
