import type { ManagedSkillDto } from '@/shared/types';

// ─── Dialog State ────────────────────────────────────────────────────────────

/**
 * 对话框状态：null 表示关闭，type 字段区分场景。
 * 对标 ProjectsPanel 的 DialogState 模式——对话框提升到 SkillContent 根级统一管理。
 */
export type SkillDialogState =
  | { type: 'create' }
  | { type: 'edit'; skill: ManagedSkillDto }
  | { type: 'view'; skill: ManagedSkillDto }
  | { type: 'git-install' }
  | { type: 'assign-tag'; skillId: string; skillName: string }
  | null;

// ─── Actions Interface ───────────────────────────────────────────────────────

/**
 * 子组件所需操作的统一接口，对标 ProjectItemActions。
 * 子组件不直接访问 store/context，通过此接口接收回调。
 */
export interface SkillItemActions {
  /** 选中/取消选中 skill */
  onSelectSkill: (skillId: string | null) => void;
  /** 打开编辑对话框 */
  onEditSkill: (skill: ManagedSkillDto) => void;
  /** 打开查看对话框 */
  onViewSkill: (skill: ManagedSkillDto) => void;
  /** 删除 skill */
  onDeleteSkill: (skillId: string) => void;
  /** 将 skill 加入指定标签组 */
  onAddToTagGroup?: (skillId: string, tagGroupId: string) => void;
  /** 检查 git skill 更新 */
  onCheckUpdate?: (skill: ManagedSkillDto) => void;
  /** 从源更新 skill */
  onUpdateSkill?: (skill: ManagedSkillDto) => void;
}

// ─── Component Props ─────────────────────────────────────────────────────────

/**
 * SkillListSection 接收的 props：
 * 所有数据和操作均通过 props 注入，零 store 直接依赖（对标 ProjectGroup / SessionRow）。
 */
export interface SkillListSectionProps {
  /** 经过 tag group + search query 过滤后的 skills 列表 */
  skills: ManagedSkillDto[];
  /** 是否处于首次加载 skeleton 状态 */
  loading: boolean;
  /** 当前选中的 skill id */
  selectedSkillId: string | null;
  /** 统一 actions 对象 */
  actions: SkillItemActions;
  /** 可选标签组（用于「加入标签组」菜单） */
  tagGroups?: Array<{ id: string; name: string }>;
  /** Description recovered from SKILL.md on the card */
  onDescriptionResolved?: (skillId: string, description: string) => void;
}
