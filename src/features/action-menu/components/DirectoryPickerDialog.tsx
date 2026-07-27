import React, { useState, useCallback, useRef } from 'react';

import {
  getRemoteHomeDir,
  getWslDirectories,
  getWslHomeDir,
  listRemoteDirectories,
} from '@/features/connection/api/connectionApi';
import type { AuthMethod } from '@/shared/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/Dialog';

type PickerTarget =
  | { type: 'wsl'; distro: string }
  | { type: 'remote'; host: string; port: number; username: string; auth: AuthMethod };

interface DirectoryPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PickerTarget;
  onSelect: (path: string) => void;
}

const DirectoryPickerDialog: React.FC<DirectoryPickerDialogProps> = ({
  open,
  onOpenChange,
  target,
  onSelect,
}) => {
  const [dirPath, setDirPath] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOpenRef = useRef(false);

  if (open && !lastOpenRef.current) {
    lastOpenRef.current = true;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      loadHome();
    });
  } else if (!open && lastOpenRef.current) {
    lastOpenRef.current = false;
    setDirPath('');
    setSuggestions([]);
    setLoading(false);
  }

  async function loadHome() {
    setLoading(true);
    try {
      let home: string;
      if (target.type === 'wsl') {
        home = await getWslHomeDir(target.distro);
      } else {
        home = await getRemoteHomeDir(target.host, target.port, target.username, target.auth);
      }
      setDirPath(home);
      await loadDirList(home);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function loadDirList(parent: string) {
    setLoading(true);
    try {
      let result: string[];
      if (target.type === 'wsl') {
        result = await getWslDirectories(target.distro, parent || null);
      } else {
        result = await listRemoteDirectories(
          target.host,
          target.port,
          target.username,
          target.auth,
          parent,
        );
      }
      setSuggestions(result.filter((d) => d !== '.' && d !== '..'));
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  const handleInputChange = (value: string) => {
    setDirPath(value);
    if (listTimerRef.current) {
      clearTimeout(listTimerRef.current);
    }
    if (value.length > 0) {
      listTimerRef.current = setTimeout(() => {
        loadDirList(value);
      }, 200);
    }
  };

  const handleSelect = useCallback(
    (path: string) => {
      onSelect(path);
      onOpenChange(false);
    },
    [onSelect, onOpenChange],
  );

  const handleConfirm = useCallback(() => {
    if (dirPath.trim()) {
      handleSelect(dirPath.trim());
    }
  }, [dirPath, handleSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && dirPath.trim()) {
        handleConfirm();
      }
    },
    [dirPath, handleConfirm],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>Select Directory</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <input
            ref={inputRef}
            value={dirPath}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="/home/user/project"
            className="w-full px-3 py-2 rounded-md border border-border bg-bg-primary text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue text-sm"
            autoComplete="off"
            spellCheck={false}
          />

          {loading && <p className="text-xs text-text-muted">Loading directories&hellip;</p>}

          {suggestions.length > 0 && (
            <div className="max-h-48 overflow-y-auto border border-border rounded-md bg-bg-primary">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer border-0 bg-transparent"
                  onClick={() => handleSelect(dirPath ? `${dirPath}/${s}` : s)}
                >
                  {dirPath ? `${dirPath}/${s}` : s}
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            className="px-4 py-1.5 rounded-md text-sm text-text-secondary bg-bg-primary border border-border hover:bg-bg-hover transition-colors cursor-pointer"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-4 py-1.5 rounded-md text-sm text-white bg-accent-blue hover:bg-accent-blue/90 disabled:opacity-50 transition-colors cursor-pointer"
            disabled={!dirPath.trim()}
            onClick={handleConfirm}
          >
            Select
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default React.memo(DirectoryPickerDialog);
