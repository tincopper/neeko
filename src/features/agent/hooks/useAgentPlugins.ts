/**
 * AgentPlugins — Zustand-style hook for managing built-in AgentPlugin state.
 *
 * Provides access to built-in plugin definitions, detection results,
 * and path resolution for the Agent Plugin System.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import type { AgentPlugin } from '@/shared/types/agentPlugin';

import {
  listAgentPlugins,
  detectInstalledAgents,
  type AgentDetectionResult,
} from '../api/agentPluginApi';

interface UseAgentPluginsResult {
  plugins: AgentPlugin[];
  loading: boolean;
  error: string | null;
  detectionResults: Record<string, AgentDetectionResult>;
  detecting: boolean;
  refresh: () => Promise<void>;
  detect: (projectPath?: string | null) => Promise<void>;
  getPlugin: (id: string) => AgentPlugin | undefined;
  getInstalledPlugins: () => AgentPlugin[];
  getUninstalledPlugins: () => AgentPlugin[];
}

export function useAgentPlugins(projectPath?: string | null): UseAgentPluginsResult {
  const [plugins, setPlugins] = useState<AgentPlugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectionResults, setDetectionResults] = useState<Record<string, AgentDetectionResult>>(
    {},
  );
  const [detecting, setDetecting] = useState(false);
  const initializedRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAgentPlugins();
      // Defensive: invoke mock may return undefined in tests.
      setPlugins(Array.isArray(result) ? result : []);
    } catch (e) {
      const msg = String(e);
      console.error('[useAgentPlugins] Failed to load plugins:', e);
      setError(msg);
      setPlugins([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const detect = useCallback(async (pp?: string | null) => {
    setDetecting(true);
    try {
      const results = await detectInstalledAgents(pp);
      if (!Array.isArray(results)) {
        return;
      }
      const map: Record<string, AgentDetectionResult> = {};
      for (const r of results) {
        map[r.plugin_id] = r;
      }
      setDetectionResults(map);
    } catch (e) {
      console.error('[useAgentPlugins] Detection failed:', e);
    } finally {
      setDetecting(false);
    }
  }, []);

  // Load plugins on mount (run once). Defer to avoid sync setState in effect.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    Promise.resolve().then(() => refresh());
  }, [refresh]);

  // Detect installed agents when plugins are loaded or project changes.
  // Defer to avoid sync setState in effect.
  useEffect(() => {
    if (plugins.length > 0) {
      Promise.resolve().then(() => detect(projectPath));
    }
  }, [plugins.length, projectPath, detect]);

  const getPlugin = useCallback((id: string) => plugins.find((p) => p.id === id), [plugins]);

  const getInstalledPlugins = useCallback(
    () => plugins.filter((p) => detectionResults[p.id]?.installed ?? false),
    [plugins, detectionResults],
  );

  const getUninstalledPlugins = useCallback(
    () => plugins.filter((p) => !(detectionResults[p.id]?.installed ?? false)),
    [plugins, detectionResults],
  );

  return {
    plugins,
    loading,
    error,
    detectionResults,
    detecting,
    refresh,
    detect,
    getPlugin,
    getInstalledPlugins,
    getUninstalledPlugins,
  };
}

export default useAgentPlugins;
