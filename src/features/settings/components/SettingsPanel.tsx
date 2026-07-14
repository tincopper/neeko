import React, { useEffect, useState } from "react";
import { listAgents } from "../../agent/api/agentApi";
import { useAppContext } from '@/shared/contexts';
import { cn } from '@/lib/utils';
import type { AgentConfig, AppConfig, DiffMode } from '@/shared/types';
import { CloseIcon } from "@/shared/components/icons";
import { NAV_ITEMS, BUILTIN_FONTS, PRESET_SHELLS, type NavCategory } from "./constants";
import { useSettingsPanelState } from "./useSettingsPanelState";
import AppearancePanel from "./AppearancePanel";
import EditorPanel from "./EditorPanel";
import TerminalPanel from "./TerminalPanel";
import AgentsPanel from "./AgentsPanel";
import IdePanel from "./IdePanel";
import GitPanel from "./GitPanel";
import ShortcutPanel from "./ShortcutPanel";

export type { AppConfig, DiffMode };
export { BUILTIN_FONTS, PRESET_SHELLS };

interface SettingsPanelProps {
   onConfigChange: (next: AppConfig) => void;
   onClose: () => void;
   fullPage?: boolean;
}

const SettingsPanel: React.FC<SettingsPanelProps> = React.memo(
   ({ onConfigChange, onClose, fullPage = false }) => {
      const { config, customThemes } = useAppContext();
      const [activeNav, setActiveNav] = useState<NavCategory>("appearance");
      const [builtinAgents, setBuiltinAgents] = useState<AgentConfig[]>([]);

      useEffect(() => {
         let alive = true;
         (async () => {
            try {
               const all = await listAgents();
               if (alive) {
                  setBuiltinAgents(all.filter((a) => a.is_builtin === true));
               }
            } catch (e) {
               console.error("[SettingsPanel] Failed to list agents:", e);
            }
         })();
         return () => {
            alive = false;
         };
      }, []);

      const state = useSettingsPanelState({
         config,
         activeNav,
         builtinAgents,
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
                      enablePiThemeSync={config.enablePiThemeSync}
                      enableOpenCodeThemeSync={config.enableOpenCodeThemeSync}
                      customThemes={customThemes}
                      onAppearanceFontSizeChange={state.setAppearanceFontSize}
                      onThemeChange={(theme) => onConfigChange({ ...config, theme })}
                      onPiThemeSyncChange={(enabled) => onConfigChange({ ...config, enablePiThemeSync: enabled })}
                      onOpenCodeThemeSyncChange={(enabled) => onConfigChange({ ...config, enableOpenCodeThemeSync: enabled })}
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
                     gpuAcceleration={config.terminalGpuAcceleration}
                     onGpuAccelerationChange={state.setGpuAcceleration}
                  />
               );

            case "agents":
               return (
                  <AgentsPanel
                     config={config}
                     builtinAgents={builtinAgents}
                     editingPresetId={state.editingPresetId}
                     editingValue={state.editingValue}
                     skillPathEditingAgentId={state.skillPathEditingAgentId}
                     skillPathInputValue={state.skillPathInputValue}
                     newAgentName={state.newAgentName}
                     newAgentCommand={state.newAgentCommand}
                     newAgentArgs={state.newAgentArgs}
                      newAgentSkillPath={state.newAgentSkillPath}
                      newAgentIcon={state.newAgentIcon}
                      onConfigChange={onConfigChange}
                      onEditingValueChange={state.setEditingValue}
                      onSkillPathInputValueChange={state.setSkillPathInputValue}
                      onNewAgentNameChange={state.setNewAgentName}
                      onNewAgentCommandChange={state.setNewAgentCommand}
                      onNewAgentArgsChange={state.setNewAgentArgs}
                      onNewAgentSkillPathChange={state.setNewAgentSkillPath}
                      onNewAgentIconChange={state.setNewAgentIcon}
                      onAddCustomAgent={() => {
                         void state.addCustomAgent();
                      }}
                      onRemoveCustomAgent={(index) => {
                         void state.removeCustomAgent(index);
                      }}
                      onUploadAgentIcon={() => {
                         void state.uploadAgentIcon();
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

            case "shortcuts":
               return (
                  <ShortcutPanel
                     config={config}
                     onConfigChange={onConfigChange}
                  />
               );

            default:
               return null;
         }
      };

      if (fullPage) {
         return (
            <div className="flex flex-col flex-1 min-h-0 tab-content">

               <div className="flex flex-1 overflow-hidden">
                  <nav className="w-[168px] shrink-0 p-2.5 px-1.5 flex flex-col gap-0.5 overflow-y-auto">
                     {NAV_ITEMS.map((item) => (
                        <button
                           key={item.id}
                           className={cn(
                              "flex items-center gap-2.5 py-2 px-3 bg-none border-none rounded-md text-text-secondary text-[0.86em] cursor-pointer text-left transition-[background-color,color] duration-150 w-full hover:bg-bg-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1",
                               activeNav === item.id && "!bg-accent-blue !text-[var(--text-on-accent)]",
                            )}
                            onClick={() => setActiveNav(item.id)}
                         >
                            <span
                               className={cn(
                                  "text-text-muted shrink-0 flex items-center",
                                  activeNav === item.id && "!text-[var(--text-on-accent)]",
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
         );
      }

      return (
         <div
            className="fixed inset-0 bg-black/55 flex items-center justify-center z-[2000]"
            data-modal="true"
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
                     className="bg-none border-none text-text-muted cursor-pointer p-1 rounded flex items-center justify-center transition-[background-color,color] duration-150 hover:bg-bg-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue"
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
                              "flex items-center gap-2.5 py-2 px-3 bg-none border-none rounded-md text-text-secondary text-[0.86em] cursor-pointer text-left transition-[background-color,color] duration-150 w-full hover:bg-bg-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1",
                              activeNav === item.id && "!bg-accent-blue !text-[var(--text-on-accent)]",
                           )}
                           onClick={() => setActiveNav(item.id)}
                        >
                           <span
                              className={cn(
                                 "text-text-muted shrink-0 flex items-center",
                                 activeNav === item.id && "!text-[var(--text-on-accent)]",
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
