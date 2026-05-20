import { useState, useCallback, useMemo } from 'react';
import { useSkillStore } from '../../store/skillStore';
import type { ManagedSkillDto, DiscoveredSkillDto } from '../../types';
import type { SkillDialogState, SkillItemActions } from './skillItemTypes';

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * 封装 Local Skills 视图的瞬态 UI 逻辑：
 * - scan 结果（DiscoveredSkills）生命周期管理
 * - install / scan / import 的 async 调用
 * - 对话框触发（通过 setDialog 委托给 SkillContent 根级）
 *
 * 对标 useProjectItemDrag / useProjectItemMenu 模式：
 * 组件只需消费返回值，不持有任何业务逻辑。
 */
export function useLocalSkillActions(setDialog: (state: SkillDialogState) => void) {
  // ── 瞬态 scan 状态 ──────────────────────────────────────────────────────────
  const [discoveredSkills, setDiscoveredSkills] = useState<DiscoveredSkillDto[]>([]);

  // ── Store actions ───────────────────────────────────────────────────────────
  const installLocal = useSkillStore(s => s.installLocal);
  const scanSkills = useSkillStore(s => s.scanSkills);
  const importDiscoveredSkill = useSkillStore(s => s.importDiscoveredSkill);
  const deleteSkill = useSkillStore(s => s.deleteSkill);
  const setSelectedSkillId = useSkillStore(s => s.setSelectedSkillId);

  // ── Header callbacks ────────────────────────────────────────────────────────

  const handleCreate = useCallback(() => {
    setDialog({ type: 'create' });
  }, [setDialog]);

  const handleInstall = useCallback(async () => {
    await installLocal();
  }, [installLocal]);

  const handleScan = useCallback(async () => {
    const results = await scanSkills();
    setDiscoveredSkills(results);
  }, [scanSkills]);

  // ── Discovered skills callbacks ─────────────────────────────────────────────

  const handleImport = useCallback(
    async (discoveredPath: string, name?: string) => {
      await importDiscoveredSkill(discoveredPath, name);
      setDiscoveredSkills(prev => prev.filter(d => d.found_path !== discoveredPath));
    },
    [importDiscoveredSkill],
  );

  const handleClearDiscovered = useCallback(() => {
    setDiscoveredSkills([]);
  }, []);

  // ── SkillItemActions (注入给 SkillListSection) ──────────────────────────────

  const actions: SkillItemActions = useMemo(
    () => ({
      onSelectSkill: (skillId: string | null) => setSelectedSkillId(skillId),
      onEditSkill: (skill: ManagedSkillDto) => setDialog({ type: 'edit', skill }),
      onViewSkill: (skill: ManagedSkillDto) => setDialog({ type: 'view', skill }),
      onDeleteSkill: (skillId: string) => deleteSkill(skillId),
    }),
    [setDialog, setSelectedSkillId, deleteSkill],
  );

  return {
    // scan 状态
    discoveredSkills,
    // header 回调
    handleCreate,
    handleInstall,
    handleScan,
    // discovered 回调
    handleImport,
    handleClearDiscovered,
    // SkillListSection 的 actions 对象
    actions,
  };
}
