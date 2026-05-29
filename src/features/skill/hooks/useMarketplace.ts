import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SkillsShSkill, InstallProgress, LeaderboardType } from "../../../types";

export type { LeaderboardType };

interface UseMarketplaceOptions {
  installedSkills: string[];
  onSkillInstalled?: () => void;
}

export const PAGE_SIZE_OPTIONS = [20, 40, 80] as const;
export const DEFAULT_PAGE_SIZE = 40;

export function useMarketplace({ installedSkills, onSkillInstalled }: UseMarketplaceOptions) {
  // Core data
  const [leaderboard, setLeaderboard] = useState<SkillsShSkill[]>([]);
  const [searchResults, setSearchResults] = useState<SkillsShSkill[]>([]);
  const [board, setBoard] = useState<LeaderboardType>("hot");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // Install state
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [installProgress, setInstallProgress] = useState<Map<string, InstallProgress["phase"]>>(new Map());

  // Source filter
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PAGE_SIZE);

  // Cache
  const leaderboardCache = useRef<Map<string, SkillsShSkill[]>>(new Map());

  // Fetch leaderboard
  const fetchLeaderboard = useCallback(async (boardType: LeaderboardType) => {
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
        limit: 100
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

  // Derived: full unfiltered list
  const rawList = searchQuery ? searchResults : leaderboard;

  // Derived: unique owner list (extract org from "owner/repo")
  const availableSources = useMemo(() => {
    const ownerSet = new Set<string>();
    for (const skill of rawList) {
      const owner = skill.source.split("/")[0];
      if (owner) ownerSet.add(owner);
    }
    return Array.from(ownerSet).sort();
  }, [rawList]);

  // Derived: filtered list by source owner
  const filteredList = useMemo(() => {
    if (!sourceFilter) return rawList;
    return rawList.filter(s => s.source.startsWith(sourceFilter + "/"));
  }, [rawList, sourceFilter]);

  // Derived: pagination
  const totalItems = filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const safePage = Math.min(page, totalPages);

  const paginatedList = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return filteredList.slice(start, start + perPage);
  }, [filteredList, safePage, perPage]);

  // Reset page when filter or source changes
  useEffect(() => {
    setPage(1);
  }, [sourceFilter, searchQuery, board]);

  // Reset source filter when switching boards or searching
  useEffect(() => {
    setSourceFilter(null);
  }, [board]);

  const isInstalled = useCallback((skillName: string) => {
    return installedSkills.includes(skillName);
  }, [installedSkills]);

  return {
    // Data
    displayList: paginatedList,
    leaderboard,
    searchResults,

    // Source filter
    availableSources,
    sourceFilter,
    setSourceFilter,

    // Pagination
    page: safePage,
    setPage,
    perPage,
    setPerPage,
    totalItems,
    totalPages,

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
