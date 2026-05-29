import React from "react";
import { Plus, FolderDown, Radar } from "@/components/icons"
import { Button } from "@/ui";

interface SkillHeaderProps {
  onCreateClick: () => void;
  onInstallClick: () => void;
  onScanClick: () => void;
}

const SkillHeader: React.FC<SkillHeaderProps> = React.memo(
  ({ onCreateClick, onInstallClick, onScanClick }) => {
    return (
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-text-primary">Local Skills</span>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={onCreateClick} className="h-7 px-2.5 text-xs gap-1">
            <Plus className="h-3.5 w-3.5" />
            Create
          </Button>
          <Button variant="ghost" size="sm" onClick={onInstallClick} className="h-7 px-2.5 text-xs gap-1">
            <FolderDown className="h-3.5 w-3.5" />
            Install
          </Button>
          <Button variant="ghost" size="sm" onClick={onScanClick} className="h-7 px-2.5 text-xs gap-1">
            <Radar className="h-3.5 w-3.5" />
            Scan
          </Button>
        </div>
      </div>
    );
  }
);

SkillHeader.displayName = "SkillHeader";

export default SkillHeader;
