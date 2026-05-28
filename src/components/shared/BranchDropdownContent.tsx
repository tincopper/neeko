/**
 * BranchDropdownContent — 纯 UI 展示组件
 *
 * 职责：渲染分支下拉面板的内容（搜索框 + 分支列表 + footer slot）。
 * 无副作用：不调用 invoke，不管弹出定位，不管 open/close 生命周期。
 * 使用者通过 footer prop 以组合模式注入底部操作区（如 New Branch 按钮）。
 */

import React, { useRef, useEffect, useMemo } from "react";
import { GitBranch } from "@/components/icons"
import { SearchIcon } from "../icons";

export interface BranchDropdownContentProps {
  /** 所有可选分支列表 */
  branches: string[];
  /** 当前分支名，用于高亮 */
  currentBranch: string;
  /** 选择分支时的回调，由外部决定副作用（checkout / close 等） */
  onSelect: (branchName: string) => void;
  /** 关闭下拉的通知，Escape 或选中时触发 */
  onClose: () => void;
  /** 底部操作区，通过组合模式注入（shadcn/ui composition pattern） */
  footer?: React.ReactNode;
}

function BranchDropdownContent({
  branches,
  currentBranch,
  onSelect,
  onClose,
  footer,
}: BranchDropdownContentProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = React.useState("");

  // Auto-focus search on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const filteredBranches = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return branches;
    return branches.filter((b) => b.toLowerCase().includes(q));
  }, [branches, searchQuery]);

  const handleSelect = (branchName: string) => {
    if (branchName === currentBranch) return;
    onClose();
    onSelect(branchName);
  };

  return (
    <div className="bg-bg-secondary border border-border rounded-lg min-w-[220px] max-w-[320px] shadow-xl overflow-hidden flex flex-col">
      {/* Search header */}
      <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-border">
        <SearchIcon size={12} className="text-text-muted shrink-0" />
        <input
          ref={searchInputRef}
          className="flex-1 bg-transparent border-none outline-none text-text-primary text-[var(--font-size)] placeholder:text-text-muted"
          placeholder="Search branches..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onClose();
            } else if (e.key === "Enter" && filteredBranches.length === 1) {
              handleSelect(filteredBranches[0]);
            }
          }}
        />
      </div>

      {/* Branch list */}
      <div className="max-h-[240px] overflow-y-auto py-1">
        {filteredBranches.length > 0 ? (
          filteredBranches.map((branch) => {
            const isCurrent = branch === currentBranch;
            return (
              <div
                key={branch}
                className={`flex items-center gap-1.5 py-1 px-3 text-[var(--font-size)] font-mono cursor-pointer transition-colors duration-100 hover:bg-bg-hover ${
                  isCurrent
                    ? "text-accent-blue cursor-default"
                    : "text-text-secondary hover:text-text-primary"
                }`}
                onClick={() => handleSelect(branch)}
                title={isCurrent ? "Current branch" : `Switch to ${branch}`}
              >
                <GitBranch size={11} className="shrink-0" />
                <span className="flex-1 truncate">{branch}</span>
                {isCurrent && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-accent-green shrink-0"
                    title="current"
                  />
                )}
              </div>
            );
          })
        ) : (
          <div className="px-3 py-3 text-center text-[var(--font-size)] text-text-muted">
            No branches found
          </div>
        )}
      </div>

      {/* Footer slot — composed by the caller */}
      {footer && <div className="border-t border-border py-1">{footer}</div>}
    </div>
  );
}

export default React.memo(BranchDropdownContent);
