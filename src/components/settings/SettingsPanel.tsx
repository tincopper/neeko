import React, { useState } from "react";
import { useAppContext } from "../../context/app-context";
import { cn } from "../../utils/cn";
import type { AppConfig, DiffMode } from "../../types";
import { CloseIcon } from "../icons";
import { NAV_ITEMS, BUILTIN_FONTS, PRESET_SHELLS, type NavCategory } from "./constants";
import { useSettingsPanelState } from "./useSettingsPanelState";
import AppearancePanel from "./AppearancePanel";
import EditorPanel from "./EditorPanel";
import TerminalPanel from "./TerminalPanel";
import AgentsPanel from "./AgentsPanel";
import IdePanel from "./IdePanel";
import GitPanel from "./GitPanel";

export type { AppConfig, DiffMode };
export { BUILTIN_FONTS, PRESET_SHELLS };

interface SettingsPanelProps {
  onConfigChange: (next: AppConfig) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = React.memo(
  ({ onConfigChange, onClose }) => {
    const { config } = useAppContext();
    const [activeNav, setActiveNav] = useState<NavCategory>("editor");

    const state = useSettingsPanelState({
      config,
      activeNav,
      onConfigChange,
      onClose,
    });

    const renderPanel = () => {
      switch (activeNav) {
        case "appearance":
          return (
            <AppearancePanel
              appearanceFontSize={config.appearanceFontSize}
              theme={config.theme}
              onAppearanceFontSizeChange={state.setAppearanceFontSize}
              onThemeChange={(theme) => onConfigChange({ ...config, theme })}
            />
          );

        case "editor":
          return (
            <EditorPanel
              editorFontSize={config.editorFontSize}
              onEditorFontSizeChange={state.setEditorFontSize}
            />
          );

        case "terminal":
          return (
            <TerminalPanel
              terminalFontSize={config.terminalFontSize}
              fontFamily={config.fontFamily}
              shellInput={state.shellInput}
              fontSearch={state.fontSearch}
              fontsLoading={state.fontsLoading}
              fontListOpen={state.fontListOpen}
              isCustomShell={state.isCustomShell}
              filteredFonts={state.filteredFonts}
              fontDropdownRef={state.fontDropdownRef}
              onTerminalFontSizeChange={state.setTerminalFontSize}
              onToggleFontList={() => state.setFontListOpen((value) => !value)}
              onFontSearchChange={state.setFontSearch}
              onApplyFont={state.applyFont}
              onShellInputChange={state.setShellInput}
              onApplyShell={state.applyShell}
            />
          );

        case "agents":
          return (
            <AgentsPanel
              config={config}
              editingPresetId={state.editingPresetId}
              editingValue={state.editingValue}
              skillPathEditingAgentId={state.skillPathEditingAgentId}
              skillPathInputValue={state.skillPathInputValue}
              newAgentName={state.newAgentName}
              newAgentCommand={state.newAgentCommand}
              newAgentArgs={state.newAgentArgs}
              newAgentSkillPath={state.newAgentSkillPath}
              onConfigChange={onConfigChange}
              onEditingValueChange={state.setEditingValue}
              onSkillPathInputValueChange={state.setSkillPathInputValue}
              onNewAgentNameChange={state.setNewAgentName}
              onNewAgentCommandChange={state.setNewAgentCommand}
              onNewAgentArgsChange={state.setNewAgentArgs}
              onNewAgentSkillPathChange={state.setNewAgentSkillPath}
              onAddCustomAgent={() => {
                void state.addCustomAgent();
              }}
              onRemoveCustomAgent={(index) => {
                void state.removeCustomAgent(index);
              }}
              onStartEditAgent={state.startEditAgent}
              onSaveAgentOverride={state.saveAgentOverride}
              onCancelPresetEdit={state.cancelPresetEdit}
              getEffectiveAgentCommand={state.getEffectiveAgentCommand}
              getEffectiveSkillPath={state.getEffectiveSkillPath}
              onSelectSkillPath={(agentId, fallback) => {
                void state.selectSkillPath(agentId, fallback);
              }}
              onStartEditSkillPath={state.startEditSkillPath}
              onSaveSkillPath={state.saveSkillPath}
              onCancelSkillPathEdit={state.cancelSkillPathEdit}
            />
          );

        case "ide":
          return (
            <IdePanel
              config={config}
              editingPresetId={state.editingPresetId}
              editingValue={state.editingValue}
              newIdeName={state.newIdeName}
              newIdeCommand={state.newIdeCommand}
              onConfigChange={onConfigChange}
              onEditingValueChange={state.setEditingValue}
              onNewIdeNameChange={state.setNewIdeName}
              onNewIdeCommandChange={state.setNewIdeCommand}
              onAddCustomIde={state.addCustomIde}
              onRemoveCustomIde={state.removeCustomIde}
              onStartEditPreset={state.startEditPreset}
              onSavePresetOverride={state.savePresetOverride}
              onCancelPresetEdit={state.cancelPresetEdit}
              getEffectiveCommand={state.getEffectiveCommand}
            />
          );

        case "git":
          return (
            <GitPanel
              diffMode={config.diffMode}
              onDiffModeChange={state.setDiffMode}
            />
          );

        default:
          return null;
      }
    };

    return (
      <div
        className="fixed inset-0 bg-black/55 flex items-center justify-center z-[2000]"
        onClick={onClose}
      >
        <div
          className="w-[720px] h-[480px] bg-bg-secondary border border-border rounded-[10px] shadow-[0_24px_64px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-3.5 px-5 pb-3 border-b border-border shrink-0">
            <span className="text-[0.93em] font-semibold text-text-primary tracking-[0.2px]">
              Settings
            </span>
            <button
              className="bg-none border-none text-text-muted cursor-pointer p-1 rounded flex items-center justify-center transition-[background-color,color] duration-150 hover:bg-bg-hover hover:text-text-primary"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <nav className="w-[168px] shrink-0 bg-bg-primary border-r border-border p-2.5 px-1.5 flex flex-col gap-0.5 overflow-y-auto">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  className={cn(
                    "flex items-center gap-2.5 py-2 px-3 bg-none border-none rounded-md text-text-secondary text-[0.86em] cursor-pointer text-left transition-[background-color,color] duration-150 w-full hover:bg-bg-hover hover:text-text-primary",
                    activeNav === item.id && "!bg-accent-blue !text-white",
                  )}
                  onClick={() => setActiveNav(item.id)}
                >
                  <span
                    className={cn(
                      "text-text-muted shrink-0 flex items-center",
                      activeNav === item.id && "!text-white",
                    )}
                  >
                    {item.icon}
                  </span>
                  <span className="font-medium">{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="flex-1 p-6 px-7 overflow-y-auto">{renderPanel()}</div>
          </div>
        </div>
      </div>
    );
  },
);

export default SettingsPanel;
