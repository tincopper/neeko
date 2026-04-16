import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import type { ManagedSkillDto, TagGroup, ToolInfo, SkillView } from "../types";
import { useSkillData } from "../hooks/useSkillData";
import { useTagGroups } from "../hooks/useTagGroups";
import { useSkillInstall } from "../hooks/useSkillInstall";
import { useToolStatus } from "../hooks/useToolStatus";

interface SkillContextValue {
  skills: ManagedSkillDto[];
  tagGroups: TagGroup[];
  tools: ToolInfo[];
  loading: boolean;
  activeSkillView: SkillView;
  activeTagGroupId: string | null;
  searchQuery: string;
  selectedSkillId: string | null;
  activeProjectId: string | null;

  setActiveSkillView: (view: SkillView) => void;
  refreshSkills: () => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  viewSkillDetail: (id: string | null) => void;

  refreshTagGroups: () => Promise<void>;
  createTagGroup: (name: string, description?: string, icon?: string) => Promise<void>;
  deleteTagGroup: (id: string) => Promise<void>;
  setActiveTagGroupId: (id: string | null) => void;

  installLocal: () => Promise<void>;
  scanSkills: () => Promise<void>;

  setSearchQuery: (q: string) => void;
}

const SkillContext = createContext<SkillContextValue | null>(null);

export function SkillProvider({ activeProjectId, children }: { activeProjectId: string | null; children: ReactNode }) {
  const { skills, loading: skillsLoading, refreshSkills, deleteSkill } = useSkillData();
  const { tagGroups, loading: tagLoading, refreshTagGroups, createTagGroup, deleteTagGroup } = useTagGroups();
  const { tools, refreshTools } = useToolStatus();
  const { installLocal, scanSkills } = useSkillInstall(refreshSkills);

  const [activeSkillView, setActiveSkillView] = useState<SkillView>("local");
  const [activeTagGroupId, setActiveTagGroupId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  useEffect(() => {
    refreshSkills();
    refreshTagGroups();
    refreshTools();
  }, [refreshSkills, refreshTagGroups, refreshTools]);

  const viewSkillDetail = useCallback((id: string | null) => {
    setSelectedSkillId(id);
  }, []);

  const value = useMemo<SkillContextValue>(() => ({
    skills, tagGroups, tools,
    loading: skillsLoading || tagLoading,
    activeSkillView, activeTagGroupId, searchQuery, selectedSkillId, activeProjectId,
    setActiveSkillView, refreshSkills, deleteSkill, viewSkillDetail,
    refreshTagGroups, createTagGroup, deleteTagGroup, setActiveTagGroupId,
    installLocal, scanSkills, setSearchQuery,
  }), [skills, tagGroups, tools, skillsLoading, tagLoading, activeSkillView, activeTagGroupId, searchQuery, selectedSkillId, activeProjectId, refreshSkills, deleteSkill, viewSkillDetail, refreshTagGroups, createTagGroup, deleteTagGroup, installLocal, scanSkills]);

  return <SkillContext.Provider value={value}>{children}</SkillContext.Provider>;
}

export function useSkillContext() {
  const ctx = useContext(SkillContext);
  if (!ctx) throw new Error("useSkillContext must be used within SkillProvider");
  return ctx;
}
