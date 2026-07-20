// ─── Skill Feature Barrel ────────────────────────────────────────────────────

// Store
export { useSkillStore, initialSkillState } from "./store";

// Domain Types
export type {
  SkillRecord,
  ManagedSkillDto,
  TagGroup,
  SkillTargetRecord,
  SkillDocumentDto,
  DiscoveredSkillDto,
  LeaderboardType,
  SkillsShSkill,
  InstallProgress,
} from "./types";

// Hooks
export { useMarketplace, PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from "./hooks/useMarketplace";
export { useApplyProjectSkills } from "./hooks/useApplyProjectSkills";

// Types & Hooks (public contract)
export type { SkillDialogState, SkillItemActions, SkillListSectionProps } from "./components/skillItemTypes";
export { useLocalSkillActions } from "./components/useLocalSkillActions";

// Panel Components
export { default as SkillsPanel } from "./components/SkillsPanel";
export { default as SkillContent } from "./components/SkillContent";
export { default as LocalSkillContent } from "./components/LocalSkillContent";
export { default as MarketplaceContent } from "./components/MarketplaceContent";
export { default as ProjectSkillContent } from "./components/ProjectSkillContent";

// Skill Cards & List
export { default as SkillCard } from "./components/SkillCard";
export { default as MarketSkillCard } from "./components/MarketSkillCard";
export { default as SkillListSection } from "./components/SkillListSection";

// Local Skill Controls
export { default as SkillHeader } from "./components/SkillHeader";
export { default as SkillSearchInput } from "./components/SkillSearchInput";
export { default as DiscoveredSkillsList } from "./components/DiscoveredSkillsList";

// Dialogs
export { default as CreateSkillDialog } from "./components/CreateSkillDialog";
export { default as EditSkillDialog } from "./components/EditSkillDialog";
export { default as ViewSkillDialog } from "./components/ViewSkillDialog";

// Editors
export { default as MarkdownEditor } from "./components/MarkdownEditor";

// Marketplace Controls
export { default as LeaderboardToggle } from "./components/LeaderboardToggle";
export { default as SourceFilter } from "./components/SourceFilter";
export { default as Pagination } from "./components/Pagination";
