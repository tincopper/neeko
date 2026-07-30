import { Cpu, Pencil, Server, TestTube, Trash2 } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import ConfirmDialog from '@/shared/components/ConfirmDialog';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { McpServer } from '@/shared/types/mcpServer';

interface McpListSectionProps {
  onEdit?: (server: McpServer) => void;
}

const McpListSection: React.FC<McpListSectionProps> = React.memo(({ onEdit }) => {
  const mcpServers = useLibraryStore((s) => s.mcpServers);
  const loading = useLibraryStore((s) => s.mcpServersLoading);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const viewMode = useLibraryStore((s) => s.viewMode);
  const sortMode = useLibraryStore((s) => s.sortMode);
  const deleteMcpServer = useLibraryStore((s) => s.deleteMcpServer);
  const testMcpConnection = useLibraryStore((s) => s.testMcpConnection);

  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const [testingId, setTestingId] = React.useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = [...mcpServers];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (sortMode === 'alphabetical') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'frequent') {
      list.sort((a, b) => b.usageCount - a.usageCount);
    } else {
      list.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return list;
  }, [mcpServers, searchQuery, sortMode]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteMcpServer(id);
        setPendingDeleteId(null);
      } catch (e) {
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'Error',
          message: `Failed to delete MCP server: ${String(e)}`,
        });
      }
    },
    [deleteMcpServer],
  );

  const handleTest = useCallback(
    async (id: string) => {
      setTestingId(id);
      try {
        const result = await testMcpConnection(id);
        useNotificationStore.getState().addNotification({
          type: result.commandFound ? 'info' : 'warning',
          title: 'MCP Test',
          message: result.message,
        });
      } catch (e) {
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'Test Failed',
          message: String(e),
        });
      } finally {
        setTestingId(null);
      }
    },
    [testMcpConnection],
  );

  if (loading && mcpServers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-[var(--font-size)]">
        Loading MCP servers…
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-text-muted gap-2 px-6">
        <Server className="h-8 w-8 opacity-30" />
        <p className="text-[var(--font-size)] text-text-secondary text-center">
          {mcpServers.length === 0
            ? 'No MCP servers yet. Add servers to connect your agents to tools.'
            : 'No MCP servers match the current filters.'}
        </p>
      </div>
    );
  }

  if (viewMode === 'grid') {
    return (
      <div className="p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 content-start">
        {filtered.map((server) => (
          <McpCard
            key={server.id}
            server={server}
            onEdit={() => onEdit?.(server)}
            onTest={() => void handleTest(server.id)}
            onDelete={() => setPendingDeleteId(server.id)}
            testing={testingId === server.id}
          />
        ))}
        <ConfirmDialog
          open={pendingDeleteId !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteId(null);
          }}
          title="Delete MCP server?"
          description={
            pendingDeleteId ? (
              <p className="text-sm text-text-secondary">
                Are you sure you want to delete{' '}
                <span className="font-medium text-text-primary">
                  {mcpServers.find((s) => s.id === pendingDeleteId)?.name ?? 'this server'}
                </span>
                ? This cannot be undone.
              </p>
            ) : null
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            if (pendingDeleteId) {
              const id = pendingDeleteId;
              void handleDelete(id);
            }
          }}
        />
      </div>
    );
  }

  // List view
  return (
    <div className="flex flex-col gap-1 p-2">
      {filtered.map((server) => (
        <McpListItem
          key={server.id}
          server={server}
          onEdit={() => onEdit?.(server)}
          onTest={() => void handleTest(server.id)}
          onDelete={() => setPendingDeleteId(server.id)}
          testing={testingId === server.id}
        />
      ))}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Delete MCP server?"
        description={
          pendingDeleteId ? (
            <p className="text-sm text-text-secondary">
              Are you sure you want to delete{' '}
              <span className="font-medium text-text-primary">
                {mcpServers.find((s) => s.id === pendingDeleteId)?.name ?? 'this server'}
              </span>
              ? This cannot be undone.
            </p>
          ) : null
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (pendingDeleteId) {
            const id = pendingDeleteId;
            void handleDelete(id);
          }
        }}
      />
    </div>
  );
});

McpListSection.displayName = 'McpListSection';

export default McpListSection;

// ── Card (grid) ─────────────────────────────────────────────────────────────

interface McpCardProps {
  server: McpServer;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
  testing: boolean;
}

const McpCard: React.FC<McpCardProps> = React.memo(
  ({ server, onEdit, onTest, onDelete, testing }) => {
    return (
      <div className="group relative flex flex-col rounded-lg border border-border bg-bg-primary hover:bg-bg-hover transition-colors p-3 gap-2">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <Server className="h-3 w-3 text-accent-blue shrink-0" />
            <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">
              {server.name}
            </span>
          </div>
        </div>
        {server.description && (
          <p className="text-[11px] text-text-muted line-clamp-2">{server.description}</p>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border font-mono truncate max-w-full">
            {server.command}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
            {server.transport}
          </span>
        </div>
        {server.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {server.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 mt-auto pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            className="flex-1 h-7 text-[11px] font-medium rounded-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 flex items-center justify-center gap-1 disabled:opacity-50"
            onClick={onTest}
            disabled={testing}
            title="Test connection"
          >
            <TestTube className="h-3 w-3" />
            {testing ? 'Testing…' : 'Test'}
          </button>
          <button
            type="button"
            className="h-7 w-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center"
            onClick={onEdit}
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="h-7 w-7 rounded-md text-text-muted hover:text-accent-red hover:bg-bg-hover flex items-center justify-center"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  },
);

McpCard.displayName = 'McpCard';

// ── List item ───────────────────────────────────────────────────────────────

const McpListItem: React.FC<McpCardProps> = React.memo(
  ({ server, onEdit, onTest, onDelete, testing }) => {
    return (
      <div className="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md hover:bg-bg-hover transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3 w-3 text-accent-blue shrink-0" />
            <span className="text-[var(--font-size)] font-medium text-text-primary truncate">
              {server.name}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border font-mono">
              {server.command}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
              {server.transport}
            </span>
          </div>
          {server.description && (
            <p className="text-[11px] text-text-muted truncate mt-0.5">{server.description}</p>
          )}
        </div>
        {server.tags.length > 0 && (
          <div className="hidden md:flex items-center gap-1 shrink-0">
            {server.tags.slice(0, 2).map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted border border-border"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            type="button"
            className="h-7 px-2 text-[11px] font-medium rounded-md bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 flex items-center gap-1 disabled:opacity-50"
            onClick={onTest}
            disabled={testing}
            title="Test connection"
          >
            <TestTube className="h-3 w-3" />
            Test
          </button>
          <button
            type="button"
            className="h-7 w-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center"
            onClick={onEdit}
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="h-7 w-7 rounded-md text-text-muted hover:text-accent-red hover:bg-bg-hover flex items-center justify-center"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  },
);

McpListItem.displayName = 'McpListItem';
