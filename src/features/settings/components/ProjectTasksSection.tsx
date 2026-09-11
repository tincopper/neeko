/** 项目任务：scope tab、任务列表与 TaskDialog（自持状态与 store 订阅）。 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { TaskDialog } from '@/features/task';
import { cn } from '@/lib/utils';
import { Plus, Pencil, Trash2 } from '@/shared/components/icons';
import { useTaskStore } from '@/shared/store/taskStore';
import type { TaskConfig } from '@/shared/types/task';
import { Button } from '@/ui';

interface Props {
  projectId: string;
  projectPath: string | null;
}

export default function ProjectTasksSection({ projectId, projectPath }: Props) {
  const [activeTaskTab, setActiveTaskTab] = useState<'project' | 'app'>('project');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<TaskConfig | null>(null);

  const { configs, loadConfigs, addConfig, updateConfig, deleteConfig } = useTaskStore();

  useEffect(() => {
    if (projectPath) loadConfigs(projectPath);
  }, [projectPath, loadConfigs]);

  const projectTasks = useMemo(() => configs.filter((c) => c.scope === 'project'), [configs]);
  const appTasks = useMemo(() => configs.filter((c) => c.scope === 'app'), [configs]);

  const handleAddTask = useCallback(() => {
    setEditingConfig(null);
    setDialogOpen(true);
  }, []);

  const handleEditTask = useCallback((config: TaskConfig) => {
    setEditingConfig(config);
    setDialogOpen(true);
  }, []);

  const handleDeleteTask = useCallback(
    (config: TaskConfig) => {
      deleteConfig(config.id, config.scope, projectPath ?? undefined);
    },
    [deleteConfig, projectPath],
  );

  const handleDialogSubmit = useCallback(
    (taskName: string, command: string) => {
      if (editingConfig) {
        const updated: TaskConfig = {
          ...editingConfig,
          name: taskName || command,
          command,
        };
        updateConfig(updated, projectPath ?? undefined);
      } else {
        const config: TaskConfig = {
          id: crypto.randomUUID(),
          name: taskName || command,
          command,
          scope: activeTaskTab === 'app' ? 'app' : 'project',
          project_id: projectId,
        };
        addConfig(config, projectPath ?? undefined);
      }
      setDialogOpen(false);
      setEditingConfig(null);
    },
    [editingConfig, projectId, projectPath, activeTaskTab, addConfig, updateConfig],
  );

  const currentTasks = activeTaskTab === 'project' ? projectTasks : appTasks;

  return (
    <>
      <div className="text-[0.86em] text-text-primary font-medium mb-1">Tasks</div>
      <div className="text-[0.79em] text-text-muted mb-3">
        Shell commands run via the title bar Run button.
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border mb-3">
        <button
          className={cn(
            'px-4 py-2 text-[0.82em] font-medium border-b-2 transition-colors cursor-pointer',
            activeTaskTab === 'project'
              ? 'text-accent-blue border-accent-blue'
              : 'text-text-muted border-transparent hover:text-text-primary',
          )}
          onClick={() => setActiveTaskTab('project')}
        >
          Project
        </button>
        <button
          className={cn(
            'px-4 py-2 text-[0.82em] font-medium border-b-2 transition-colors cursor-pointer',
            activeTaskTab === 'app'
              ? 'text-accent-blue border-accent-blue'
              : 'text-text-muted border-transparent hover:text-text-primary',
          )}
          onClick={() => setActiveTaskTab('app')}
        >
          App (global)
        </button>
      </div>

      {/* Task list */}
      <div className="flex flex-col gap-1.5">
        {currentTasks.length === 0 ? (
          <div className="py-6 text-center text-[0.82em] text-text-muted border border-dashed border-border rounded-md">
            {activeTaskTab === 'project'
              ? 'No project tasks configured.'
              : 'No app-level tasks configured.'}
          </div>
        ) : (
          currentTasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2.5 px-3 py-2.5 bg-bg-tertiary border border-border rounded-md"
            >
              <span className="text-[0.86em] text-text-primary font-medium min-w-[60px]">
                {task.name}
              </span>
              <span className="flex-1 text-[0.79em] text-text-muted font-mono truncate">
                {task.command}
              </span>
              <button
                className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                onClick={() => handleEditTask(task)}
                title="Edit"
              >
                <Pencil size={13} />
              </button>
              <button
                className="p-1 rounded text-text-muted hover:text-accent-red hover:bg-bg-hover transition-colors cursor-pointer"
                onClick={() => handleDeleteTask(task)}
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      {activeTaskTab === 'app' && (
        <div className="mt-2 text-[0.75em] text-text-muted">
          App-level tasks are visible in all projects. Stored in ~/.neeko/tasks.json
        </div>
      )}

      <Button variant="outline" size="sm" className="mt-3" onClick={handleAddTask}>
        <Plus size={13} />
        Add Task
      </Button>
      {dialogOpen && (
        <TaskDialog
          onClose={() => {
            setDialogOpen(false);
            setEditingConfig(null);
          }}
          onSubmit={handleDialogSubmit}
          editConfig={editingConfig ?? undefined}
        />
      )}
    </>
  );
}
