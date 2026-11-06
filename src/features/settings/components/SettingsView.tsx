import React, { useState, useMemo, useCallback, useEffect } from 'react';

import { useAppContext } from '@/shared/contexts';
import { useScrollMemory } from '@/shared/hooks/useScrollMemory';
import { useAgentStore } from '@/shared/store/agentStore';
import { useAppViewStore } from '@/shared/store/appViewStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { AppConfig } from '@/shared/types';
import { buildScrollKey } from '@/shared/utils/scrollMemory';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { Island } from '@/ui/Island';

import AboutPanel from './AboutPanel';
import AgentsPanel from './AgentsPanel';
import AppearancePanel from './AppearancePanel';
import { NAV_ITEMS, type SettingsNavId } from './constants';
import DebugPanel from './DebugPanel';
import EditorSettingsPanel from './EditorSettingsPanel';
import GitPanel from './GitPanel';
import IdePanel from './IdePanel';
import LspPanel from './LspPanel';
import NotificationSettingsSection from './NotificationSettingsSection';
import ProjectPanel from './ProjectPanel';
import SettingsSidebar from './SettingsSidebar';
import ShortcutPanel from './ShortcutPanel';
import TerminalPanel from './TerminalPanel';
import { useSettingsPanelState } from './useSettingsPanelState';

/** 滚动视图身份：全局唯一 surface 常量（sub 段按导航项隔离）。 */
const SCROLL_SURFACE = 'settings.content';

function SettingsView() {
  const setAppView = useAppViewStore((s) => s.setAppView);
  const { config, customThemes, saveConfig } = useAppContext();
  const projects = useProjectStore((s) => s.projects);
  const [activeNav, setActiveNav] = useState<SettingsNavId>('appearance');
  const [searchQuery, setSearchQuery] = useState('');

  // 滚动记忆：按导航项各自记忆；离开设置（卸载）后返回也恢复上次位置。
  const scrollRef = useScrollMemory<HTMLDivElement>(
    buildScrollKey(SCROLL_SURFACE, null, activeNav),
  );
  // agent 列表来自唯一缓存（`ensure` 幂等，重复调用只请求一次）。
  // 不再用 `useState` + `listAgents()` 维护本地快照 —— 那是同类副本。
  const agentSnapshot = useAgentStore((s) => s.agents);
  const ensureAgents = useAgentStore((s) => s.ensure);
  useEffect(() => {
    void ensureAgents().catch((e) => console.error('[SettingsView] Failed to load agents:', e));
  }, [ensureAgents]);
  const builtinAgents = useMemo(
    () => (agentSnapshot ?? []).filter((a) => a.is_builtin === true),
    [agentSnapshot],
  );
  const allAgents = agentSnapshot ?? [];

  const handleBack = useCallback(() => {
    setAppView('normal');
  }, [setAppView]);

  /**
   * config.json 的写入 → **交给唯一写点**（`useAppConfigOwner.saveConfig`，它自带串行门与
   * 读盘合并）。此处不再包 `runConfigWrite`：那会在队列内二次入队，自我等待成死锁。
   *
   * 返回 Promise 给调用方（LspPanel 的失败提示依赖它）。
   */
  const onConfigChange = useCallback((next: AppConfig) => saveConfig(next), [saveConfig]);

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
    setActiveNav('appearance');
  }, []);

  const renderPanel = () => {
    if (activeNav.startsWith('project:')) {
      const projectId = activeNav.slice(8);
      return (
        <ProjectPanel
          projectId={projectId as ProjectId}
          customIdes={config.customIdes}
          onProjectRemoved={handleProjectRemoved}
        />
      );
    }

    switch (activeNav) {
      case 'appearance':
        return (
          <AppearancePanel
            appearanceFontSize={config.appearanceFontSize}
            theme={config.theme}
            enablePiThemeSync={config.enablePiThemeSync}
            enableOpenCodeThemeSync={config.enableOpenCodeThemeSync}
            enableDevTools={config.enableDevTools}
            customThemes={customThemes}
            onAppearanceFontSizeChange={state.setAppearanceFontSize}
            onThemeChange={(theme) => onConfigChange({ ...config, theme })}
            onPiThemeSyncChange={(enabled) =>
              onConfigChange({ ...config, enablePiThemeSync: enabled })
            }
            onOpenCodeThemeSyncChange={(enabled) =>
              onConfigChange({ ...config, enableOpenCodeThemeSync: enabled })
            }
            onDevToolsChange={(enabled) => onConfigChange({ ...config, enableDevTools: enabled })}
          />
        );

      case 'editor':
        return (
          <EditorSettingsPanel
            config={config}
            onConfigChange={onConfigChange}
            agents={allAgents}
            onEditorFontSizeChange={state.setEditorFontSize}
          />
        );

      case 'lsp':
        return <LspPanel config={config} onConfigChange={onConfigChange} />;

      case 'terminal':
        return (
          <TerminalPanel
            terminalFontSize={config.terminalFontSize}
            fontFamily={config.monoFontFamily ?? config.fontFamily ?? ''}
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
            onRefreshFonts={state.refreshFonts}
            onShellInputChange={state.setShellInput}
            onApplyShell={state.applyShell}
            gpuAcceleration={config.terminalGpuAcceleration}
            onGpuAccelerationChange={state.setGpuAcceleration}
          />
        );

      case 'agents':
        return (
          <AgentsPanel
            config={config}
            builtinAgents={builtinAgents}
            skillPathEditingAgentId={state.skillPathEditingAgentId}
            skillPathInputValue={state.skillPathInputValue}
            onConfigChange={onConfigChange}
            onSkillPathInputValueChange={state.setSkillPathInputValue}
            onSaveAgent={state.saveCustomAgent}
            onToggleAgentEnabled={state.setAgentEnabled}
            onRemoveAgent={(agentId) => {
              void state.removeCustomAgentById(agentId);
            }}
            onSaveBuiltinAgent={state.saveBuiltinOverride}
            onResetBuiltinAgent={(agentId) => {
              void state.resetBuiltinOverride(agentId);
            }}
            getEffectiveAgent={state.getEffectiveAgent}
            onSelectSkillPath={(agent) => {
              void state.selectSkillPath(agent);
            }}
            onStartEditSkillPath={state.startEditSkillPath}
            onSaveSkillPath={state.saveSkillPath}
            onCancelSkillPathEdit={state.cancelSkillPathEdit}
          />
        );

      case 'ide':
        return (
          <IdePanel
            config={config}
            editingPresetId={state.editingPresetId}
            editingValue={state.editingValue}
            newIdeName={state.newIdeName}
            newIdeCommand={state.newIdeCommand}
            onConfigChange={onConfigChange}
            onEditingValueChange={state.setEditingValue}
            onCancelPresetEdit={state.cancelPresetEdit}
            onNewIdeNameChange={state.setNewIdeName}
            onNewIdeCommandChange={state.setNewIdeCommand}
            onAddCustomIde={state.addCustomIde}
            onRemoveCustomIde={state.removeCustomIde}
            onStartEditPreset={state.startEditPreset}
            onSavePresetOverride={state.savePresetOverride}
            getEffectiveCommand={state.getEffectiveCommand}
          />
        );

      case 'git':
        return <GitPanel diffMode={config.diffMode} onDiffModeChange={state.setDiffMode} />;

      case 'debug':
        return (
          <DebugPanel
            javaBackend={config.dap?.javaBackend ?? 'auto'}
            onJavaBackendChange={(javaBackend) =>
              onConfigChange({ ...config, dap: { ...config.dap, javaBackend } })
            }
          />
        );

      case 'shortcuts':
        return <ShortcutPanel config={config} onConfigChange={onConfigChange} />;

      case 'notifications':
        return <NotificationSettingsSection />;

      case 'about':
        return <AboutPanel />;

      default:
        return null;
    }
  };

  return (
    <Island className="flex-1" data-settings-view>
      <div className="flex flex-1 overflow-hidden">
        <SettingsSidebar
          onBack={handleBack}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          navItems={filteredNavItems}
          activeNav={activeNav}
          onSelectNav={setActiveNav}
          projects={projects}
        />

        {/* Right content area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 px-10">
          <div className="max-w-[640px]">{renderPanel()}</div>
        </div>
      </div>
    </Island>
  );
}

export default React.memo(SettingsView);
