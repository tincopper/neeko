import { Terminal, Bot, Layers, FilePlus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, memo } from 'react';

/* eslint-disable import/no-restricted-paths -- guide binds project tag groups via skill domain */
import { resolveProjectTargetAgentIds, useBindProjectTagGroups } from '@/features/skill';
/* eslint-enable import/no-restricted-paths */
import { useSkillStore } from '@/features/skill/store';
import AgentIcon from '@/shared/components/AgentIcon';
import { useAppContext } from '@/shared/contexts/AppContext';
import type { AgentConfig } from '@/shared/types';
import type { Step } from '@/shared/types/step';

import { useProjectOnboarding } from '../hooks/useProjectOnboarding';

import { OnboardingSteps } from './OnboardingSteps';
import { QuickActionBar } from './QuickActionBar';

interface ProjectGuidePageProps {
  projectId: string;
  projectName: string;
  projectPath: string;
  /** Project selected_agents (ids) for disk sync targets. */
  selectedAgentIds?: string[];
  selectedAgent: AgentConfig | null;
  worktreePath?: string | null;
  onOpenTerminal: () => void;
  onOpenAgent: () => void;
  onOpenAgentChat: () => void;
  onNewFile: () => void;
  agents?: AgentConfig[];
  installedMap?: Map<string, boolean>;
  onSelectAgent?: (agent: AgentConfig) => void;
}

function ProjectGuidePageImpl({
  projectId,
  projectName,
  projectPath,
  selectedAgentIds,
  selectedAgent,
  worktreePath,
  onOpenTerminal,
  onOpenAgent,
  onOpenAgentChat,
  onNewFile,
  agents = [],
  installedMap = new Map(),
  onSelectAgent,
}: ProjectGuidePageProps) {
  const { showToast } = useAppContext();
  const { state, markStepComplete, dismissOnboarding, undismissOnboarding } = useProjectOnboarding(
    projectId,
    worktreePath,
  );

  const tagGroups = useSkillStore((s) => s.tagGroups);
  const projectTagGroups = useSkillStore((s) => s.projectTagGroups);
  const projectBindingsLoading = useSkillStore((s) => s.projectBindingsLoading);
  const refreshTagGroups = useSkillStore((s) => s.refreshTagGroups);
  const loadProjectTagGroups = useSkillStore((s) => s.loadProjectTagGroups);

  const boundIds = useMemo(() => projectTagGroups.map((g) => g.id), [projectTagGroups]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [tagGroupsReady, setTagGroupsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setTagGroupsReady(false);
      try {
        await Promise.all([refreshTagGroups(), loadProjectTagGroups(projectId)]);
      } catch (e) {
        console.error('[ProjectGuidePage] failed to load tag groups:', e);
      } finally {
        if (!cancelled) setTagGroupsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshTagGroups, loadProjectTagGroups]);

  useEffect(() => {
    // Reset user selection when the persisted bindings change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedTagIds(projectTagGroups.map((g) => g.id));
  }, [projectTagGroups]);

  const agentIdsForBind = useMemo(() => {
    if (selectedAgentIds && selectedAgentIds.length > 0) return selectedAgentIds;
    return selectedAgent ? [selectedAgent.id] : [];
  }, [selectedAgentIds, selectedAgent]);

  const targetAgentIds = useMemo(
    () => resolveProjectTargetAgentIds(agents, agentIdsForBind),
    [agents, agentIdsForBind],
  );

  const {
    bind,
    saving: tagSaving,
    openSkillsProject,
  } = useBindProjectTagGroups({
    projectId,
    projectPath,
    previousBoundIds: boundIds,
    targetAgentIds,
    openSkillsOnSuccess: true,
    onSuccess: () => {
      setTagsExpanded(false);
      markStepComplete('tags').catch((e) => {
        console.error('[ProjectGuidePage] Failed to save onboarding state:', e);
        showToast('Tag groups bound, but progress could not be saved', 'error');
      });
    },
  });

  const steps = useMemo<Step[]>(
    () => [
      {
        type: 'default',
        id: 'terminal',
        title: 'Open Terminal',
        description: worktreePath
          ? 'Start a terminal in worktree directory'
          : 'Start a terminal in project directory',
        icon: <Terminal size={18} />,
        actionLabel: 'Open Terminal',
        recommended: true,
      },
      {
        type: 'agent',
        id: 'agent',
        title: 'Start AI Agent Session',
        description: selectedAgent
          ? `Chat with ${selectedAgent.name}`
          : 'Select and open a configured agent',
        icon: selectedAgent ? <AgentIcon icon={selectedAgent.icon} size={18} /> : <Bot size={18} />,
        actionLabel: 'Open Agent',
        recommended: true,
      },
      {
        type: 'default',
        id: 'agent-chat',
        title: 'Agent Chat',
        description: 'Start a multi-turn conversation with an AI agent in a chat interface',
        icon: <Bot size={18} />,
        actionLabel: 'Open Chat',
        recommended: true,
      },
      {
        type: 'default',
        id: 'new-file',
        title: 'New File',
        description: 'Create an empty file and edit it; save when ready',
        icon: <FilePlus size={18} />,
        actionLabel: 'New File',
      },
      {
        type: 'tag',
        id: 'tags',
        title: 'Bind Tag Groups',
        description: 'Pick tag groups so related skills can install for this project',
        icon: <Layers size={18} />,
        actionLabel: 'Bind Tags',
      },
    ],
    [selectedAgent, worktreePath],
  );
  const handleStepAction = useCallback(
    (stepId: string) => {
      switch (stepId) {
        case 'terminal':
          onOpenTerminal();
          void markStepComplete(stepId);
          break;
        case 'agent':
          onOpenAgent();
          void markStepComplete(stepId);
          break;
        case 'agent-chat':
          onOpenAgentChat();
          void markStepComplete(stepId);
          break;
        case 'new-file':
          onNewFile();
          void markStepComplete(stepId);
          break;
        case 'tags':
          setTagsExpanded(true);
          break;
        default:
          break;
      }
    },
    [onOpenTerminal, onOpenAgent, onOpenAgentChat, onNewFile, markStepComplete],
  );

  const handleApplyTagBinding = useCallback(() => {
    void bind(selectedTagIds);
  }, [bind, selectedTagIds]);

  const completedSteps = state?.completedSteps ?? [];
  const dismissed = state?.dismissed ?? false;
  const tagsLoading = !tagGroupsReady || projectBindingsLoading;

  if (dismissed) {
    return (
      <QuickActionBar
        steps={steps}
        onStepAction={(stepId) => {
          if (stepId === 'tags') {
            openSkillsProject();
            return;
          }
          handleStepAction(stepId);
        }}
        onExpand={() => {
          void undismissOnboarding();
        }}
        agents={agents}
        selectedAgentId={selectedAgent?.id ?? null}
        installedMap={installedMap}
        onSelectAgent={onSelectAgent}
      />
    );
  }

  return (
    <OnboardingSteps
      projectName={projectName}
      steps={steps}
      completedSteps={completedSteps}
      onStepAction={handleStepAction}
      onStepComplete={(stepId) => void markStepComplete(stepId)}
      onDismiss={() => void dismissOnboarding()}
      agents={agents}
      selectedAgentId={selectedAgent?.id ?? null}
      installedMap={installedMap}
      onSelectAgent={onSelectAgent}
      tagGroups={tagGroups}
      boundTagGroupIds={boundIds}
      selectedTagGroupIds={selectedTagIds}
      tagGroupsLoading={tagsLoading}
      tagBindingSaving={tagSaving}
      tagsExpanded={tagsExpanded}
      onTagsExpandedChange={setTagsExpanded}
      onTagSelectionChange={setSelectedTagIds}
      onApplyTagBinding={handleApplyTagBinding}
      onViewSkills={openSkillsProject}
    />
  );
}

export const ProjectGuidePage = memo(ProjectGuidePageImpl);
