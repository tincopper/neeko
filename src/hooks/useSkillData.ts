import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ManagedSkillDto } from "../types";

export function useSkillData() {
  const [skills, setSkills] = useState<ManagedSkillDto[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshSkills = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<ManagedSkillDto[]>("get_managed_skills");
      setSkills(result);
    } catch (e) {
      console.error("Failed to load skills:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteSkill = useCallback(async (id: string) => {
    try {
      await invoke("delete_managed_skill", { skillId: id });
      setSkills((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error("Failed to delete skill:", e);
    }
  }, []);

  return { skills, loading, refreshSkills, deleteSkill };
}
