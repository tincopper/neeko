import { LayoutGrid, List, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  deployMcpToAgent,
  listDeployedMcp,
  removeDeployedMcp,
} from '@/features/library/api/libraryApi';
import { useMcpStore } from '@/features/library/store/mcpStore';
import { cn } from '@/lib/utils';
import { useNotificationStore } from '@/shared/store/notificationStore';
import { useProjectStore } from '@/shared/store/projectStore';
import type { McpServer } from '@/shared/types/mcpServer';
import { Button } from '@/ui/Button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/Dialog';

interface McpAgentContentProps {
  agentId: string;
}

/** Narrow the untyped deployer boundary (`Vec<serde_json::Value>`) to named entries. */
function isDeployedEntry(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string'
  );
}

const McpAgentContent: React.FC<McpAgentContentProps> = React.memo(({ agentId }) => {
  const mcpServers = useMcpStore((s) => s.mcpServers);
  const setMcpView = useMcpStore((s) => s.setMcpView);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const [deployedNames, setDeployedNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [importOpen, setImportOpen] = useState(false);

  const refreshDeployed = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listDeployedMcp(agentId, activeProjectId ?? undefined);
      setDeployedNames(result.filter(isDeployedEntry).map((entry) => entry.name));
    } catch {
      setDeployedNames([]);
    } finally {
      setLoading(false);
    }
  }, [agentId, activeProjectId]);

  useEffect(() => {
    void refreshDeployed();
  }, [refreshDeployed]);

  const deployedServers = useMemo(
    () => mcpServers.filter((s) => deployedNames.includes(s.name)),
    [mcpServers, deployedNames],
  );

  const availableServers = useMemo(
    () => mcpServers.filter((s) => !deployedNames.includes(s.name)),
    [mcpServers, deployedNames],
  );

  const filteredDeployed = useMemo(() => {
    if (!searchQuery.trim()) return deployedServers;
    const q = searchQuery.toLowerCase();
    return deployedServers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q) ||
        s.transport.includes(q),
    );
  }, [deployedServers, searchQuery]);

  const handleUndeploy = useCallback(
    async (serverName: string) => {
      try {
        await removeDeployedMcp(serverName, agentId, activeProjectId ?? undefined);
        useNotificationStore.getState().addNotification({
          type: 'info',
          title: 'MCP Undeploy',
          message: "Removed '" + serverName + "' from agent",
        });
        await refreshDeployed();
      } catch (e) {
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'Undeploy Failed',
          message: String(e),
        });
      }
    },
    [agentId, activeProjectId, refreshDeployed],
  );

  const handleImport = useCallback(
    async (serverIds: string[]) => {
      for (const sid of serverIds) {
        try {
          await deployMcpToAgent(sid, agentId, activeProjectId ?? undefined);
        } catch (e) {
          useNotificationStore.getState().addNotification({
            type: 'error',
            title: 'Deploy Failed',
            message: String(e),
          });
        }
      }
      useNotificationStore.getState().addNotification({
        type: 'info',
        title: 'MCP Deploy',
        message: 'Deployed ' + serverIds.length + ' server(s) to agent',
      });
      setImportOpen(false);
      await refreshDeployed();
    },
    [agentId, activeProjectId, refreshDeployed],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
          Agent:
        </span>
        <span className="text-[var(--font-size)] font-semibold text-text-primary">{agentId}</span>
        <span className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-medium bg-bg-hover text-text-muted border border-border">
          {deployedServers.length} deployed
        </span>
        <button
          type="button"
          onClick={() => setMcpView('installed')}
          className="ml-auto text-[11px] text-accent-blue hover:text-accent-blue/80 transition-colors"
        >
          ← Back to all
        </button>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search deployed MCP servers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 rounded-lg bg-bg-hover/50 border border-border/80 text-text-primary placeholder:text-text-muted outline-none focus:border-border focus:bg-bg-primary transition-colors text-[var(--font-size)]"
          />
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => void refreshDeployed()}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              viewMode === 'grid'
                ? 'bg-bg-selected text-text-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
            )}
            title="Grid view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              viewMode === 'list'
                ? 'bg-bg-selected text-text-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
            )}
            title="List view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setImportOpen(true)}
            className="h-8 px-3 ml-1 text-xs gap-1.5 font-medium"
          >
            <Plus className="h-3.5 w-3.5" /> Add MCP Server
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">
            Loading...
          </div>
        ) : filteredDeployed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-text-muted gap-2 px-6">
            <p className="text-[var(--font-size)] text-text-secondary text-center">
              {deployedServers.length === 0
                ? 'No MCP servers deployed to this agent yet.'
                : 'No servers match the current search.'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 content-start">
            {filteredDeployed.map((server) => (
              <div
                key={server.id}
                className="group flex flex-col rounded-lg border border-border bg-bg-primary hover:bg-bg-hover transition-colors p-3 gap-2 border-l-[3px] border-l-accent-blue"
              >
                <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">
                  {server.name}
                </span>
                {server.description && (
                  <p className="text-[11px] text-text-muted line-clamp-2">{server.description}</p>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
                    {server.transport}
                  </span>
                  <span className="text-[10px] text-text-muted">{server.scope}</span>
                </div>
                <div className="flex items-center gap-1 mt-auto pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    className="flex-1 h-7 text-[11px] font-medium rounded-md border border-red/30 text-red hover:bg-red/10 flex items-center justify-center gap-1"
                    onClick={() => void handleUndeploy(server.name)}
                  >
                    <Trash2 className="h-3 w-3" /> Undeploy
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {filteredDeployed.map((server) => (
              <div
                key={server.id}
                className="group flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-bg-primary hover:bg-bg-hover transition-colors border-l-[3px] border-l-accent-blue"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[var(--font-size)] font-semibold text-text-primary">
                    {server.name}
                  </span>
                  <span className="ml-2 text-[11px] text-text-muted">{server.transport}</span>
                </div>
                <button
                  type="button"
                  className="text-[10px] px-2 py-1 rounded border border-red/30 text-red hover:bg-red/10 transition-colors shrink-0"
                  onClick={() => void handleUndeploy(server.name)}
                >
                  <Trash2 className="h-3 w-3" /> Undeploy
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {importOpen && (
        <McpImportToAgentDialog
          agentId={agentId}
          availableServers={availableServers}
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
        />
      )}
    </div>
  );
});

McpAgentContent.displayName = 'McpAgentContent';

interface McpImportDialogProps {
  agentId: string;
  availableServers: McpServer[];
  onClose: () => void;
  onImport: (serverIds: string[]) => Promise<void>;
}

const McpImportToAgentDialog: React.FC<McpImportDialogProps> = React.memo(
  ({ agentId, availableServers, onClose, onImport }) => {
    const [query, setQuery] = useState('');
    const [transportFilter, setTransportFilter] = useState<'all' | 'stdio' | 'http' | 'sse'>('all');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [importing, setImporting] = useState(false);

    const filtered = useMemo(() => {
      let list = availableServers;
      if (query.trim()) {
        const q = query.toLowerCase();
        list = list.filter(
          (s) => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q),
        );
      }
      if (transportFilter !== 'all') {
        list = list.filter((s) => s.transport === transportFilter);
      }
      return list;
    }, [availableServers, query, transportFilter]);

    const toggleAll = useCallback(() => {
      if (selected.size === filtered.length) setSelected(new Set());
      else setSelected(new Set(filtered.map((s) => s.id)));
    }, [filtered, selected]);

    const toggle = useCallback((id: string) => {
      setSelected((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    }, []);

    const handleImport = useCallback(async () => {
      if (selected.size === 0) return;
      setImporting(true);
      try {
        await onImport(Array.from(selected));
      } finally {
        setImporting(false);
      }
    }, [selected, onImport]);

    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Add MCP Servers to {agentId}</DialogTitle>
          </DialogHeader>
          <div className="px-4 py-2 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search servers..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-8 pl-8 pr-3 rounded-lg bg-bg-hover/50 border border-border/80 text-text-primary placeholder:text-text-muted outline-none focus:border-border focus:bg-bg-primary transition-colors text-[var(--font-size)]"
              />
            </div>
            <div className="flex gap-1">
              {(['all', 'stdio', 'http', 'sse'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTransportFilter(t)}
                  className={cn(
                    'h-7 px-2.5 text-[11px] font-medium rounded-md border transition-colors',
                    transportFilter === t
                      ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/40'
                      : 'text-text-muted border-border hover:bg-bg-hover',
                  )}
                >
                  {t === 'all' ? 'All' : t}
                </button>
              ))}
            </div>
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              <label className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-text-muted cursor-pointer hover:bg-bg-hover rounded">
                <input
                  type="checkbox"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onChange={toggleAll}
                  className="accent-accent-blue"
                  aria-label="Select all"
                />
                <span>Select all ({filtered.length})</span>
              </label>
              {filtered.map((server) => (
                <label
                  key={server.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-bg-hover transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(server.id)}
                    onChange={() => toggle(server.id)}
                    className="accent-accent-blue"
                    aria-label={server.name}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-[var(--font-size)] font-medium text-text-primary">
                      {server.name}
                    </span>
                    <span className="ml-2 text-[11px] text-text-muted">{server.transport}</span>
                  </div>
                </label>
              ))}
              {filtered.length === 0 && (
                <p className="text-[11px] text-text-muted text-center py-4">No servers available</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={selected.size === 0 || importing}
              onClick={() => void handleImport()}
            >
              {importing ? 'Deploying...' : 'Deploy (' + selected.size + ')'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);

McpImportToAgentDialog.displayName = 'McpImportToAgentDialog';

export default McpAgentContent;
