import React, { useState, useMemo, useCallback, useEffect } from "react";
import { listAgents } from "../../agent/api/agentApi";
import { ArrowLeft, Search, FolderOpen } from "@/shared/components/icons"
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useProjectStore } from '@/features/project/store';
import { useAppContext } from '@/shared/contexts';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, type SettingsNavId } from "./constants";
import { useSettingsPanelState } from "./useSettingsPanelState";
import AppearancePanel from "./AppearancePanel";
import EditorPanel from "./EditorPanel";
import TerminalPanel from "./TerminalPanel";
import AgentsPanel from "./AgentsPanel";
import IdePanel from "./IdePanel";
import GitPanel from "./GitPanel";
import ShortcutPanel from "./ShortcutPanel";
import ProjectPanel from "./ProjectPanel";
import LspPanel from "./LspPanel";
import type { AgentConfig, AppConfig } from '@/shared/types';

function SettingsView() {
  const setAppView = useAppViewStore((s) => s.setAppView);
  const { config, customThemes, saveConfig } = useAppContext();
  const projects = useProjectStore((s) => s.projects);
  const [activeNav, setActiveNav] = useState<SettingsNavId>("appearance");
  const [searchQuery, setSearchQuery] = useState("");
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
        console.error("[SettingsView] Failed to list agents:", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleBack = useCallback(() => {
    setAppView("normal");
  }, [setAppView]);

  const onConfigChange = useCallback(
    (next: AppConfig) => saveConfig(next),
    [saveConfig],
  );

  const state = useSettingsPanelState({
    config,
    activeNav,
    builtinAgents,
    onConfigChange,
    onClose: handleBack,
  });

  const filteredNavItems = useMemo(() => {
    if (!searchQuery.trim()) return NAV_ITEMS;
    const query = searchQuery.toLowerCase().trim();
    return NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(query));
  }, [searchQuery]);

  const handleProjectRemoved = useCallback(() => {
    setActiveNav("appearance");
  }, []);

  const renderPanel = () => {
    if (activeNav.startsWith("project:")) {
      const projectId = activeNav.slice(8);
      return (
        <ProjectPanel
          projectId={projectId}
          customIdes={config.customIdes}
          onProjectRemoved={handleProjectRemoved}
        />
      );
    }

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

      case "lsp":
        return (
          <LspPanel
            config={config}
            onConfigChange={onConfigChange}
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
            onSelectSkillPath={(agent) => {
              void state.selectSkillPath(agent);
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

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden bg-bg-secondary rounded-lg shadow-sm"
      data-settings-view
    >
      <div className="flex flex-1 overflow-hidden">
        {/* Left navigation sidebar */}
        <nav className="w-[200px] shrink-0 border-r border-border flex flex-col overflow-hidden">
          {/* Back button */}
          <div className="px-3 pt-3 pb-2">
            <button
              className="flex items-center gap-1.5 text-[0.86em] text-text-secondary hover:text-text-primary transition-colors duration-150 cursor-pointer"
              onClick={handleBack}
            >
              <ArrowLeft size={14} strokeWidth={2} />
              <span>Back</span>
            </button>
          </div>

          {/* Search box */}
          <div className="px-3 pb-2">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
              />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-7 pl-7 pr-2 text-[0.82em] bg-bg-tertiary border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors duration-150"
              />
            </div>
          </div>

          {/* Navigation items */}
          <div className="flex-1 overflow-y-auto px-1.5 pb-2 flex flex-col gap-0.5">
            {filteredNavItems.map((item) => (
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

            {/* Projects section */}
            {projects.length > 0 && (
              <>
                <div className="h-px bg-border mx-1.5 my-2" />
                <div className="px-3 py-1 text-[0.72em] font-semibold text-text-muted uppercase tracking-wider">
                  Projects
                </div>
                {projects.map((p) => {
                  const navId: SettingsNavId = `project:${p.id}`;
                  return (
                    <button
                      key={p.id}
                      className={cn(
                        "flex items-center gap-2.5 py-2 px-3 pl-5 bg-none border-none rounded-md text-text-secondary text-[0.86em] cursor-pointer text-left transition-[background-color,color] duration-150 w-full hover:bg-bg-hover hover:text-text-primary",
                        activeNav === navId && "!bg-accent-blue !text-[var(--text-on-accent)]",
                      )}
                      onClick={() => setActiveNav(navId)}
                    >
                      <FolderOpen
                        size={14}
                        className={cn(
                          "shrink-0 text-text-muted",
                          activeNav === navId && "!text-[var(--text-on-accent)]",
                        )}
                      />
                      <span className="font-medium truncate">{p.name}</span>
                    </button>
                  );
                })}
              </>
            )}

            {projects.length === 0 && (
              <>
                <div className="h-px bg-border mx-1.5 my-2" />
                <div className="px-3 py-1 text-[0.72em] font-semibold text-text-muted uppercase tracking-wider">
                  Projects
                </div>
                <div className="px-3 py-4 text-[0.79em] text-text-muted text-center">
                  No projects added yet.
                </div>
              </>
            )}
          </div>
        </nav>

        {/* Right content area */}
        <div className="flex-1 overflow-y-auto p-8 px-10">
          <div className="max-w-[640px]">
            {renderPanel()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(SettingsView);
