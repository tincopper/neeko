import React from "react";
import type { AppConfig } from "../../types";
import type { IdePreset } from "../../utils/idePresets";
import { IDE_PRESETS, getIdeIconSrc } from "../../utils/idePresets";
import { cn } from "../../utils/cn";
import { Input, Button } from "../ui";

interface IdePanelProps {
  config: AppConfig;
  editingPresetId: string | null;
  editingValue: string;
  newIdeName: string;
  newIdeCommand: string;
  onConfigChange: (next: AppConfig) => void;
  onEditingValueChange: (value: string) => void;
  onNewIdeNameChange: (value: string) => void;
  onNewIdeCommandChange: (value: string) => void;
  onAddCustomIde: () => void;
  onRemoveCustomIde: (index: number) => void;
  onStartEditPreset: (ide: IdePreset) => void;
  onSavePresetOverride: (ideId: string) => void;
  onCancelPresetEdit: () => void;
  getEffectiveCommand: (ide: IdePreset) => string;
}

const IdePanel: React.FC<IdePanelProps> = ({
  config,
  editingPresetId,
  editingValue,
  newIdeName,
  newIdeCommand,
  onConfigChange,
  onEditingValueChange,
  onNewIdeNameChange,
  onNewIdeCommandChange,
  onAddCustomIde,
  onRemoveCustomIde,
  onStartEditPreset,
  onSavePresetOverride,
  onCancelPresetEdit,
  getEffectiveCommand,
}) => {
  return (
    <>
      <div className="text-[1em] font-semibold text-text-primary mb-5 pb-2.5 border-b border-border">
        IDE
      </div>

      <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Preset IDEs
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Built-in IDE presets. Select one when adding a project, or use Ctrl+O
            to open.
          </div>
        </div>

        <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
          {IDE_PRESETS.map((ide) => {
            const isEditing = editingPresetId === ide.id;
            const effectiveCmd = getEffectiveCommand(ide);
            const isOverridden = !!config.ideCommandOverrides?.[ide.id];
            const iconSrc = getIdeIconSrc(ide.icon);

            return (
              <div
                key={ide.id}
                className="flex items-center gap-2.5 py-[7px] px-3 border-b border-white/[0.03] text-[0.86em] [&:last-child]:border-b-0"
              >
                <img
                  src={iconSrc}
                  className="text-[0.93em] w-[18px] h-[18px] text-center shrink-0 object-contain"
                  alt=""
                />
                <span className="text-text-primary font-medium min-w-[100px] shrink-0">
                  {ide.name}
                </span>

                {isEditing ? (
                  <Input
                    className="flex-1 min-w-0 py-0.5 px-1.5 text-[0.82em]"
                    value={editingValue}
                    autoFocus
                    spellCheck={false}
                    onChange={(e) => onEditingValueChange(e.target.value)}
                    onBlur={() => onSavePresetOverride(ide.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onSavePresetOverride(ide.id);
                      }
                      if (e.key === "Escape") {
                        onCancelPresetEdit();
                      }
                    }}
                  />
                ) : (
                  <span
                    className={cn(
                      "text-text-muted font-mono text-[0.82em] flex-1 overflow-hidden text-ellipsis whitespace-nowrap cursor-text rounded py-px px-1 transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary",
                      isOverridden && "!text-accent-blue",
                    )}
                    title="Double-click to edit"
                    onDoubleClick={() => onStartEditPreset(ide)}
                  >
                    {effectiveCmd}
                  </span>
                )}

                {isOverridden && !isEditing && (
                  <button
                    className="bg-none border-none text-text-muted cursor-pointer text-[0.93em] py-0.5 px-1 rounded shrink-0 transition-colors duration-150 leading-none hover:text-accent-blue"
                    title="Reset to default"
                    onClick={() => {
                      const overrides = { ...(config.ideCommandOverrides || {}) };
                      delete overrides[ide.id];
                      onConfigChange({ ...config, ideCommandOverrides: overrides });
                    }}
                  >
                    &#x21BA;
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-start gap-3 py-3 border-b border-white/[0.04] [&:last-child]:border-b-0 mt-2">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Custom IDEs
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Add custom IDEs by specifying a name and executable path or command.
          </div>
        </div>

        {(config.customIdes || []).length > 0 && (
          <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
            {(config.customIdes || []).map((ide, index) => (
              <div
                key={index}
                className="flex items-center gap-2.5 py-[7px] px-3 border-b border-white/[0.03] text-[0.86em] [&:last-child]:border-b-0"
              >
                <img
                  src={getIdeIconSrc(null)}
                  className="text-[0.93em] w-[18px] h-[18px] text-center shrink-0 object-contain"
                  alt=""
                />
                <span className="text-text-primary font-medium min-w-[100px] shrink-0">
                  {ide.name}
                </span>
                <span className="text-text-muted font-mono text-[0.82em] flex-1">
                  {ide.command}
                </span>
                <button
                  className="bg-none border-none text-text-muted cursor-pointer text-[0.79em] py-0.5 px-1 rounded ml-auto shrink-0 hover:text-text-primary hover:bg-bg-hover"
                  onClick={() => onRemoveCustomIde(index)}
                  title="Remove"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5 w-full">
          <Input
            className="py-[7px] px-2.5 text-[0.86em]"
            type="text"
            placeholder="Name, e.g. My Editor"
            value={newIdeName}
            onChange={(e) => onNewIdeNameChange(e.target.value)}
            spellCheck={false}
          />
          <Input
            className="py-[7px] px-2.5 text-[0.86em]"
            type="text"
            placeholder="Command or path, e.g. D:/zed.exe"
            value={newIdeCommand}
            onChange={(e) => onNewIdeCommandChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onAddCustomIde();
              }
            }}
            spellCheck={false}
          />
          <Button
            variant="primary"
            size="sm"
            className="self-end"
            onClick={onAddCustomIde}
            disabled={!newIdeName.trim() || !newIdeCommand.trim()}
          >
            Add IDE
          </Button>
        </div>
      </div>
    </>
  );
};

export default React.memo(IdePanel);
