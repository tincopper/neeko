import { useState, useCallback, useMemo } from 'react';

import { useNotificationStore } from '@/features/notification/notificationStore';
import { useSkillStore } from '@/features/skill/store';
import type { ManagedSkillDto, DiscoveredSkillDto } from '@/shared/types';

import type { SkillDialogState, SkillItemActions } from './skillItemTypes';

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * 封装 Local Skills 视图的瞬�?UI 逻辑�?
 * - scan 结果（DiscoveredSkills）生命周期管�?
 * - install / scan / import �?async 调用
 * - 对话框触发（通过 setDialog 委托�?SkillContent 根级�?
 *
 * 对标 useProjectItemDrag / useProjectItemMenu 模式�?
 * 组件只需消费返回值，不持有任何业务逻辑�?
 */
export function useLocalSkillActions(setDialog: (state: SkillDialogState) => void) {
  const [discoveredSkills, setDiscoveredSkills] = useState<DiscoveredSkillDto[]>([]);
  const [scanning, setScanning] = useState(false);
  const [refreshingMeta, setRefreshingMeta] = useState(false);
  const toast = useNotificationStore.getState().addNotification;

  // ── Store actions ───────────────────────────────────────────────────────────
  const installLocal = useSkillStore((s) => s.installLocal);
  const scanSkills = useSkillStore((s) => s.scanSkills);
  const refreshMetadata = useSkillStore((s) => s.refreshMetadata);
  const importDiscoveredSkill = useSkillStore((s) => s.importDiscoveredSkill);
  const deleteSkill = useSkillStore((s) => s.deleteSkill);
  const addSkillToTagGroup = useSkillStore((s) => s.addSkillToTagGroup);
  const checkSkillUpdate = useSkillStore((s) => s.checkSkillUpdate);
  const updateSkillFromSource = useSkillStore((s) => s.updateSkillFromSource);
  const setSkillEnabled = useSkillStore((s) => s.setSkillEnabled);
  const setSelectedSkillId = useSkillStore((s) => s.setSelectedSkillId);

  // ── Header callbacks ────────────────────────────────────────────────────────

  const handleCreate = useCallback(() => {
    setDialog({ type: 'create' });
  }, [setDialog]);

  const handleInstall = useCallback(async () => {
    try {
      await installLocal();
    } catch (e) {
      console.error('[useLocalSkillActions] install failed:', e);
    }
  }, [installLocal]);

  const handleInstallGit = useCallback(() => {
    setDialog({ type: 'git-install' });
  }, [setDialog]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const results = await scanSkills();
      setDiscoveredSkills(results);
      toast(
        results.length > 0
          ? {
              type: 'success',
              title: 'Scan complete',
              message: `Found ${results.length} new skill${results.length > 1 ? 's' : ''}`,
            }
          : { type: 'info', title: 'Scan complete', message: 'No new skills found' },
      );
    } catch (e) {
      console.error('[useLocalSkillActions] scan failed:', e);
      setDiscoveredSkills([]);
      toast({ type: 'error', title: 'Scan failed', message: String(e) });
    } finally {
      setScanning(false);
    }
  }, [scanSkills, toast]);

  const handleRefreshMetadata = useCallback(async () => {
    setRefreshingMeta(true);
    try {
      const updated = await refreshMetadata();
      toast(
        updated > 0
          ? {
              type: 'success',
              title: 'Metadata refreshed',
              message: `Updated ${updated} skill description${updated > 1 ? 's' : ''}`,
            }
          : {
              type: 'info',
              title: 'Metadata refreshed',
              message: 'All descriptions already up to date',
            },
      );
    } catch (e) {
      console.error('[useLocalSkillActions] metadata refresh failed:', e);
      toast({ type: 'error', title: 'Metadata refresh failed', message: String(e) });
    } finally {
      setRefreshingMeta(false);
    }
  }, [refreshMetadata, toast]);

  // ── Discovered skills callbacks ─────────────────────────────────────────────

  const handleImport = useCallback(
    async (discoveredPath: string, name?: string) => {
      await importDiscoveredSkill(discoveredPath, name);
      setDiscoveredSkills((prev) => prev.filter((d) => d.found_path !== discoveredPath));
    },
    [importDiscoveredSkill],
  );

  const handleClearDiscovered = useCallback(() => {
    setDiscoveredSkills([]);
  }, []);

  // ── SkillItemActions (注入�?SkillListSection) ──────────────────────────────

  const actions: SkillItemActions = useMemo(
    () => ({
      onSelectSkill: (skillId: string | null) => setSelectedSkillId(skillId),
      onEditSkill: (skill: ManagedSkillDto) => setDialog({ type: 'edit', skill }),
      onViewSkill: (skill: ManagedSkillDto) => setDialog({ type: 'view', skill }),
      onDeleteSkill: (skillId: string) => {
        void deleteSkill(skillId).catch(console.error);
      },
      onAddToTagGroup: (skillId: string, tagGroupId: string) => {
        void addSkillToTagGroup(tagGroupId, skillId).catch(console.error);
      },
      onCheckUpdate: async (skill: ManagedSkillDto) => {
        try {
          const result = await checkSkillUpdate(skill.id);
          if (result.status === 'update_available') {
            toast({
              type: 'info',
              title: 'Update available',
              message: `"${skill.name}" has a remote update ready`,
            });
          } else {
            toast({
              type: 'success',
              title: 'Up to date',
              message: `"${skill.name}" is already at the latest version`,
            });
          }
        } catch (e) {
          console.error('[useLocalSkillActions] check update failed:', e);
          toast({ type: 'error', title: 'Check failed', message: String(e) });
        }
      },
      onUpdateSkill: (skill: ManagedSkillDto) => {
        void updateSkillFromSource(skill.id).catch(console.error);
      },
      onToggleEnabled: async (skill: ManagedSkillDto, enabled: boolean) => {
        try {
          await setSkillEnabled(skill.id, enabled);
          toast({
            type: 'success',
            title: enabled ? 'Enabled' : 'Disabled',
            message: enabled
              ? `"${skill.name}" can be synced / installed again`
              : `"${skill.name}" won’t sync until re-enabled (existing installs kept)`,
          });
        } catch (e) {
          console.error('[useLocalSkillActions] toggle enabled failed:', e);
          toast({ type: 'error', title: 'Toggle failed', message: String(e) });
          throw e;
        }
      },
    }),
    [
      setDialog,
      setSelectedSkillId,
      deleteSkill,
      addSkillToTagGroup,
      checkSkillUpdate,
      updateSkillFromSource,
      setSkillEnabled,
      toast,
    ],
  );

  return {
    discoveredSkills,
    scanning,
    refreshingMeta,
    handleCreate,
    handleInstall,
    handleInstallGit,
    handleScan,
    handleRefreshMetadata,
    handleImport,
    handleClearDiscovered,
    actions,
  };
}
