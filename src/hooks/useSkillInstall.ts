import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DiscoveredSkillDto, ManagedSkillDto } from "../types";

export function useSkillInstall(onInstalled: () => void) {
  const [installing, setInstalling] = useState(false);
  const [discoveredSkills, setDiscoveredSkills] = useState<DiscoveredSkillDto[]>([]);

  const installLocal = useCallback(async () => {
    try {
      const selected = await open({ multiple: false, directory: true });
      if (!selected) return;
      setInstalling(true);
      await invoke("install_local_skill", { sourcePath: selected, name: null });
      onInstalled();
    } catch (e) {
      console.error("Failed to install skill:", e);
    } finally {
      setInstalling(false);
    }
  }, [onInstalled]);

  const installGit = useCallback(async (url: string, branch?: string) => {
    // Git install would use preview_git_install + confirm_git_install
    console.log("Git install not yet implemented:", url, branch);
  }, []);

  const scanSkills = useCallback(async () => {
    try {
      setInstalling(true);
      const result = await invoke<DiscoveredSkillDto[]>("scan_local_skills");
      setDiscoveredSkills(result);
      console.log(`[scan] Found ${result.length} discovered skills`);
    } catch (e) {
      console.error("Failed to scan skills:", e);
    } finally {
      setInstalling(false);
    }
  }, []);

  const importDiscoveredSkill = useCallback(async (discoveredPath: string, name?: string) => {
    try {
      setInstalling(true);
      await invoke<ManagedSkillDto>("import_discovered_skill", { 
        discoveredPath, 
        name: name || null 
      });
      setDiscoveredSkills(prev => prev.filter(s => s.found_path !== discoveredPath));
      onInstalled();
    } catch (e) {
      console.error("Failed to import skill:", e);
      throw e;
    } finally {
      setInstalling(false);
    }
  }, [onInstalled]);

  const clearDiscovered = useCallback(() => {
    setDiscoveredSkills([]);
  }, []);

  const createSkill = useCallback(async (name: string, skillContent: string) => {
    try {
      setInstalling(true);
      await invoke("create_skill", { name, skillContent });
      onInstalled();
    } catch (e) {
      console.error("Failed to create skill:", e);
      throw e;
    } finally {
      setInstalling(false);
    }
  }, [onInstalled]);

  return { 
    installing, 
    installLocal, 
    installGit, 
    scanSkills, 
    createSkill,
    discoveredSkills,
    importDiscoveredSkill,
    clearDiscovered
  };
}
