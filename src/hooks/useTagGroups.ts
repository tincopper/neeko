import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TagGroup } from "../types";

export function useTagGroups() {
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshTagGroups = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<TagGroup[]>("get_tag_groups");
      setTagGroups(result);
    } catch (e) {
      console.error("Failed to load tag groups:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const createTagGroup = useCallback(async (name: string, description?: string, icon?: string) => {
    try {
      const result = await invoke<TagGroup>("create_tag_group", { name, description, icon });
      setTagGroups((prev) => [...prev, result]);
    } catch (e) {
      console.error("Failed to create tag group:", e);
    }
  }, []);

  const deleteTagGroup = useCallback(async (id: string) => {
    try {
      await invoke("delete_tag_group_cmd", { id });
      setTagGroups((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      console.error("Failed to delete tag group:", e);
    }
  }, []);

  return { tagGroups, loading, refreshTagGroups, createTagGroup, deleteTagGroup };
}
