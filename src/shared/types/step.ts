import type { TagGroup } from '@/shared/types';

export interface BaseStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  actionLabel: string;
  recommended?: boolean;
}
export interface AgentStep extends BaseStep {
  type: 'agent';
}

export interface TagBindStep extends BaseStep {
  type: 'tag';
}

export interface DefaultStep extends BaseStep {
  type: 'default';
}

export type Step = AgentStep | TagBindStep | DefaultStep;

export interface TagBindProps {
  tagGroups?: TagGroup[];
  boundTagGroupIds?: string[];
  selectedTagGroupIds?: string[];
  tagGroupsLoading?: boolean;
  tagBindingSaving?: boolean;
  tagsExpanded?: boolean;
  onTagsExpandedChange?: (open: boolean) => void;
  onTagSelectionChange?: (ids: string[]) => void;
  onApplyTagBinding?: () => void;
  onViewSkills?: () => void;
}
