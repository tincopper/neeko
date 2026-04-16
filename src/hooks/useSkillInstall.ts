import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export function useSkillInstall(onInstalled: () => void) {
  const [installing, setInstalling] = useState(false);

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
      await invoke("scan_local_skills");
      onInstalled();
    } catch (e) {
      console.error("Failed to scan skills:", e);
    } finally {
      setInstalling(false);
    }
  }, [onInstalled]);

  const createSkill = useCallback(async (name: string, description?: string) => {
    try {
      setInstalling(true);
      await invoke("create_skill", { name, description: description || null });
      onInstalled();
    } catch (e) {
      console.error("Failed to create skill:", e);
      throw e;
    } finally {
      setInstalling(false);
    }
  }, [onInstalled]);

  return { installing, installLocal, installGit, scanSkills, createSkill };
}
