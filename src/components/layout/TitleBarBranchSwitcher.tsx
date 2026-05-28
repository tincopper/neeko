/**
 * TitleBarBranchSwitcher — 顶部栏分支切换触发器
 *
 * 职责：
 *   - 渲染分支名触发器（绿色小字 + icon）
 *   - 管理下拉 open/close 及外部点击关闭
 *   - 将 BranchDropdownContent 作为下拉面板内容
 *   - footer slot 注入 "New Branch" 按钮，onNewBranch 回调向上传递
 *
 * 不包含：invoke 调用、GitDialog、业务副作用。
 */

import React, { useState, useRef, useEffect } from "react";
import { GitBranch, Plus, ChevronDown } from "@/components/icons"
import BranchDropdownContent from "../shared/BranchDropdownContent";

interface TitleBarBranchSwitcherProps {
  currentBranch: string;
  branches: string[];
  /** Worktree 模式：显示只读标签，禁止切换 */
  isWorktreeMode: boolean;
  /** 切换进行中：降低不透明度，禁止交互 */
  isSwitching: boolean;
  onCheckoutBranch: (branchName: string) => void;
  onNewBranch: () => void;
}

function TitleBarBranchSwitcher({
  currentBranch,
  branches,
  isWorktreeMode,
  isSwitching,
  onCheckoutBranch,
  onNewBranch,
}: TitleBarBranchSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isClickable = !isWorktreeMode && !isSwitching;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleTriggerClick = () => {
    if (!isClickable) return;
    setOpen((v) => !v);
  };

  const handleClose = () => setOpen(false);

  const handleNewBranch = () => {
    setOpen(false);
    onNewBranch();
  };

  // Footer composed here — "New Branch" button injected into BranchDropdownContent
  const footer = (
    <div
      className="flex items-center gap-1.5 py-1 px-3 text-[var(--font-size)] text-text-secondary cursor-pointer transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary"
      onClick={handleNewBranch}
    >
      <Plus size={11} className="shrink-0" />
      <span>New Branch</span>
    </div>
  );

  return (
    <div className="relative shrink-0" ref={containerRef}>
      {/* Trigger */}
      <span
        className={`flex items-center gap-1 text-[var(--font-size)] text-accent-green shrink-0 ${
          isClickable
            ? "cursor-pointer rounded px-1 py-0.5 -mx-1 -my-0.5 hover:bg-accent-green/10 transition-colors duration-150"
            : "cursor-default"
        } ${isSwitching ? "opacity-60" : ""}`}
        onClick={handleTriggerClick}
        title={
          isWorktreeMode
            ? `Worktree branch: ${currentBranch}`
            : isSwitching
            ? "Switching branch..."
            : `Branch: ${currentBranch} — click to switch`
        }
      >
        <GitBranch size={12} className="shrink-0" />
        <span className="max-w-[120px] truncate">{currentBranch}</span>
        {isWorktreeMode ? (
          <span className="text-[10px] text-accent-green/50 ml-0.5" title="Worktree branch (read-only)">
            WT
          </span>
        ) : (
          <ChevronDown
            size={11}
            className={`shrink-0 opacity-60 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        )}
      </span>

      {/* Dropdown panel — prevent drag region activation */}
      {open && (
        <div
          className="absolute top-[calc(100%+6px)] left-0 z-[9999]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <BranchDropdownContent
            branches={branches}
            currentBranch={currentBranch}
            onSelect={onCheckoutBranch}
            onClose={handleClose}
            footer={footer}
          />
        </div>
      )}
    </div>
  );
}

export default React.memo(TitleBarBranchSwitcher);
