import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SkillsShSkill, InstallProgress } from "../types";

export type LeaderboardType = "hot" | "trending" | "alltime";

interface UseMarketplaceOptions {
  installedSkills: string[]; // List of installed skill names
  onSkillInstalled?: () => void; // Callback when a skill is installed
}

export function useMarketplace({ installedSkills, onSkillInstalled }: UseMarketplaceOptions) {
  // State
  const [leaderboard, setLeaderboard] = useState<SkillsShSkill[]>([]);
  const [searchResults, setSearchResults] = useState<SkillsShSkill[]>([]);
  const [board, setBoard] = useState<LeaderboardType>("hot");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [installProgress, setInstallProgress] = useState<Map<string, InstallProgress["phase"]>>(new Map());

  // Cache for leaderboard results
  const leaderboardCache = useRef<Map<string, SkillsShSkill[]>>(new Map());

  // Fetch leaderboard
  const fetchLeaderboard = useCallback(async (boardType: LeaderboardType) => {
    // Check cache first
    const cached = leaderboardCache.current.get(boardType);
    if (cached) {
      setLeaderboard(cached);
      return;
    }

    setLoading(true);
    try {
      const result = await invoke<SkillsShSkill[]>("fetch_leaderboard", { board: boardType });
      setLeaderboard(result);
      leaderboardCache.current.set(boardType, result);
    } catch (e) {
      console.error("Failed to fetch leaderboard:", e);
      setLeaderboard([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Search marketplace
  const searchMarketplace = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setLoading(true);
    try {
      const result = await invoke<SkillsShSkill[]>("search_skillssh", { 
        query: query.trim(), 
        limit: 20 
      });
      setSearchResults(result);
    } catch (e) {
      console.error("Failed to search marketplace:", e);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Install from marketplace
  const installFromMarket = useCallback(async (source: string, skillId: string) => {
    const fullId = `${source}/${skillId}`;
    
    if (installingIds.has(fullId)) return;

    setInstallingIds(prev => new Set(prev).add(fullId));
    setInstallProgress(prev => new Map(prev).set(fullId, "cloning"));

    try {
      await invoke("install_from_skillssh", { source, skillId });
    } catch (e) {
      console.error("Failed to install skill:", e);
      setInstallingIds(prev => {
        const next = new Set(prev);
        next.delete(fullId);
        return next;
      });
      setInstallProgress(prev => {
        const next = new Map(prev);
        next.delete(fullId);
        return next;
      });
      throw e;
    }
  }, [installingIds]);

  // Listen for install progress events
  useEffect(() => {
    const unlisten = listen<InstallProgress>("install-progress", (event) => {
      const { skill_id, phase } = event.payload;
      
      setInstallProgress(prev => new Map(prev).set(skill_id, phase));
      
      if (phase === "done") {
        setInstallingIds(prev => {
          const next = new Set(prev);
          next.delete(skill_id);
          return next;
        });
        // Clear progress after a delay
        setTimeout(() => {
          setInstallProgress(prev => {
            const next = new Map(prev);
            next.delete(skill_id);
            return next;
          });
        }, 2000);
        onSkillInstalled?.();
      } else if (phase === "error") {
        setInstallingIds(prev => {
          const next = new Set(prev);
          next.delete(skill_id);
          return next;
        });
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, [onSkillInstalled]);

  // Fetch leaderboard on mount and board change
  useEffect(() => {
    if (!searchQuery) {
      fetchLeaderboard(board);
    }
  }, [board, searchQuery, fetchLeaderboard]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      searchMarketplace(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, searchMarketplace]);

  // Check if a skill is installed
  const isInstalled = useCallback((skillName: string) => {
    return installedSkills.includes(skillName);
  }, [installedSkills]);

  // Get display list (search results or leaderboard)
  const displayList = searchQuery ? searchResults : leaderboard;

  return {
    // Data
    displayList,
    leaderboard,
    searchResults,
    
    // State
    board,
    setBoard,
    searchQuery,
    setSearchQuery,
    loading,
    installingIds,
    installProgress,
    
    // Actions
    fetchLeaderboard,
    searchMarketplace,
    installFromMarket,
    isInstalled,
  };
}
