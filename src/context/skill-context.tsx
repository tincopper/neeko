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

  // Dialog states
  editSkillDialogOpen: boolean;
  editSkillDialogData: ManagedSkillDto | null;
  viewSkillDialogOpen: boolean;
  viewSkillDialogData: ManagedSkillDto | null;

  setActiveSkillView: (view: SkillView) => void;
  refreshSkills: () => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  viewSkillDetail: (id: string | null) => void;
  openEditSkillDialog: (skill: ManagedSkillDto | null) => void;
  closeEditSkillDialog: () => void;
  openViewSkillDialog: (skill: ManagedSkillDto | null) => void;
  closeViewSkillDialog: () => void;

  refreshTagGroups: () => Promise<void>;
  createTagGroup: (name: string, description?: string, icon?: string) => Promise<void>;
  deleteTagGroup: (id: string) => Promise<void>;
  setActiveTagGroupId: (id: string | null) => void;

  installLocal: () => Promise<void>;
  scanSkills: () => Promise<void>;
  createSkill: (name: string, skillContent: string) => Promise<void>;

  setSearchQuery: (q: string) => void;
}

const SkillContext = createContext<SkillContextValue | null>(null);

export function SkillProvider({ activeProjectId, children }: { activeProjectId: string | null; children: ReactNode }) {
  const { skills, loading: skillsLoading, refreshSkills, deleteSkill } = useSkillData();
  const { tagGroups, loading: tagLoading, refreshTagGroups, createTagGroup, deleteTagGroup } = useTagGroups();
  const { tools, refreshTools } = useToolStatus();
  const { installLocal, scanSkills, createSkill } = useSkillInstall(refreshSkills);

  const [activeSkillView, setActiveSkillView] = useState<SkillView>("local");
  const [activeTagGroupId, setActiveTagGroupId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  // Dialog states
  const [editSkillDialogOpen, setEditSkillDialogOpen] = useState(false);
  const [editSkillDialogData, setEditSkillDialogData] = useState<ManagedSkillDto | null>(null);
  const [viewSkillDialogOpen, setViewSkillDialogOpen] = useState(false);
  const [viewSkillDialogData, setViewSkillDialogData] = useState<ManagedSkillDto | null>(null);

  useEffect(() => {
    refreshSkills();
    refreshTagGroups();
    refreshTools();
  }, [refreshSkills, refreshTagGroups, refreshTools]);

  const viewSkillDetail = useCallback((id: string | null) => {
    setSelectedSkillId(id);
  }, []);

  const openEditSkillDialog = useCallback((skill: ManagedSkillDto | null) => {
    console.log("[skill-context] openEditSkillDialog called, skill:", skill?.name);
    setEditSkillDialogData(skill);
    setEditSkillDialogOpen(!!skill);
    console.log("[skill-context] editSkillDialogOpen set to:", !!skill);
  }, []);

  const closeEditSkillDialog = useCallback(() => {
    setEditSkillDialogOpen(false);
    setEditSkillDialogData(null);
  }, []);

  const openViewSkillDialog = useCallback((skill: ManagedSkillDto | null) => {
    console.log("[skill-context] openViewSkillDialog called, skill:", skill?.name);
    setViewSkillDialogData(skill);
    setViewSkillDialogOpen(!!skill);
    console.log("[skill-context] viewSkillDialogOpen set to:", !!skill);
  }, []);

  const closeViewSkillDialog = useCallback(() => {
    setViewSkillDialogOpen(false);
    setViewSkillDialogData(null);
  }, []);

  const value = useMemo<SkillContextValue>(() => ({
    skills, tagGroups, tools,
    loading: skillsLoading || tagLoading,
    activeSkillView, activeTagGroupId, searchQuery, selectedSkillId, activeProjectId,
    editSkillDialogOpen, editSkillDialogData, viewSkillDialogOpen, viewSkillDialogData,
    setActiveSkillView, refreshSkills, deleteSkill, viewSkillDetail,
    openEditSkillDialog, closeEditSkillDialog, openViewSkillDialog, closeViewSkillDialog,
    refreshTagGroups, createTagGroup, deleteTagGroup, setActiveTagGroupId,
    installLocal, scanSkills, createSkill, setSearchQuery,
  }), [skills, tagGroups, tools, skillsLoading, tagLoading, activeSkillView, activeTagGroupId, searchQuery, selectedSkillId, activeProjectId, refreshSkills, deleteSkill, viewSkillDetail, refreshTagGroups, createTagGroup, deleteTagGroup, installLocal, scanSkills, createSkill, editSkillDialogOpen, editSkillDialogData, viewSkillDialogOpen, viewSkillDialogData]);

  return <SkillContext.Provider value={value}>{children}</SkillContext.Provider>;
}

export function useSkillContext() {
  const ctx = useContext(SkillContext);
  if (!ctx) throw new Error("useSkillContext must be used within SkillProvider");
  return ctx;
}
