import type { ManagedSkillDto } from '../../../types';

// ─── Dialog State ────────────────────────────────────────────────────────────

/**
 * 对话框状态：null 表示关闭，type 字段区分场景。
 * 对标 ProjectsPanel 的 DialogState 模式——对话框提升到 SkillContent 根级统一管理。
 */
export type SkillDialogState =
  | { type: 'create' }
  | { type: 'edit'; skill: ManagedSkillDto }
  | { type: 'view'; skill: ManagedSkillDto }
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
}
