import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Play } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../../store/projectStore";
import { useConnectionStore } from "../../store/connectionStore";
import {
  getIdeCommand,
  getIdeIconByCommand,
  getIdeIconSrc,
  IDE_PRESETS,
} from "../../utils/idePresets";
import type { AppConfig } from "../../types";

/**
 * OpenIdeButton — 标题栏中 TaskRunButton 左侧的 IDE 打开/选择按钮
 *
 * 左侧显示当前项目默认 IDE 的图标与名称，点击直接打开。
 * 右侧下拉箭头展开 IDE 列表：
 *   - 行点击 → 把该 IDE 设为当前项目默认（持久化），不打开。
 *   - 行右侧 ▶ 按钮 → 立即打开该 IDE（不改默认）。
 */
function OpenIdeButton() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeWslProject = useConnectionStore((s) => s.activeWslProject);
  const activeRemoteProject = useConnectionStore((s) => s.activeRemoteProject);
  const openIde = useProjectStore((s) => s.openIde);
  const setProjectIde = useProjectStore((s) => s.setProjectIde);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 加载 AppConfig（用于获取 customIdes / ideCommandOverrides）
  useEffect(() => {
    invoke<AppConfig>("load_config")
      .then((cfg) => setConfig(cfg))
      .catch((e) => console.error("[OpenIdeButton] Failed to load config:", e));
  }, []);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // 当前活跃项目的 IDE 命令 与 ID
  const ideCommand =
    activeProject?.selected_ide ??
    activeWslProject?.project.selected_ide ??
    activeRemoteProject?.project.selected_ide ??
    null;

  const projectId =
    activeProject?.id ??
    activeWslProject?.project.id ??
    activeRemoteProject?.project.id ??
    null;

  // 整合所有可用的 IDE 选项
  const allIdeOptions = React.useMemo(() => {
    const options: { id: string; name: string; command: string; icon: string }[] = [];

    // 预设 IDE
    for (const preset of IDE_PRESETS) {
      const cmd = config?.ideCommandOverrides?.[preset.id] ?? getIdeCommand(preset);
      options.push({
        id: preset.id,
        name: preset.name,
        command: cmd,
        icon: getIdeIconSrc(preset.icon),
      });
    }

    // 自定义 IDE
    if (config?.customIdes) {
      for (let i = 0; i < config.customIdes.length; i++) {
        const ide = config.customIdes[i];
        options.push({
          id: "custom:" + i,
          name: ide.name,
          command: ide.command,
          icon: "",
        });
      }
    }

    return options;
  }, [config]);

  // 点击左侧区域 → 直接打开当前默认 IDE
  const handleOpenDefault = useCallback(() => {
    if (!projectId || !ideCommand) return;
    openIde({ id: projectId, selected_ide: ideCommand });
  }, [projectId, ideCommand, openIde]);

  // 点击下拉中的某一行 → 把该 IDE 设为当前项目默认（持久化），不打开
  const handleSelectIde = useCallback(
    (cmd: string) => {
      if (!projectId) return;
      setProjectIde(projectId, cmd);
      setDropdownOpen(false);
    },
    [projectId, setProjectIde],
  );

  // 行右侧 ▶ 按钮 → 一次性打开该 IDE，不改默认
  const handleRunIde = useCallback(
    (cmd: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!projectId) return;
      openIde({ id: projectId, selected_ide: cmd });
      setDropdownOpen(false);
    },
    [projectId, openIde],
  );

  // 无 IDE 配置且无选项时隐藏
  if (!ideCommand && allIdeOptions.length === 0) return null;

  return (
    <div className="relative flex items-center" ref={dropdownRef}>
      <div className="flex items-center h-7 rounded-md hover:bg-bg-hover transition-colors">
        {/* IDE 图标 + 名称 — 点击直接打开 */}
        <button
          className="flex items-center gap-1.5 pl-1.5 pr-1.5 h-full text-text-primary transition-colors cursor-pointer"
          onClick={handleOpenDefault}
          title={ideCommand ? "Open in IDE (" + ideCommand + ")" : "No IDE configured"}
        >
          {ideCommand ? (
            <img
              src={getIdeIconByCommand(ideCommand)}
              className="w-3.5 h-3.5 object-contain shrink-0"
              alt=""
            />
          ) : null}
          <span className="text-[var(--font-size)] text-text-secondary max-w-[80px] truncate">
            {ideCommand ?? "IDE"}
          </span>
        </button>

        {/* 分隔线 */}
        <div className="w-px h-3.5 bg-border shrink-0" />

        {/* 下拉箭头 */}
        <button
          className="flex items-center justify-center w-5 h-full text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          onClick={() => setDropdownOpen(!dropdownOpen)}
          title="Select IDE"
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {/* 下拉菜单 */}
      {dropdownOpen && (
        <div className="absolute top-full right-0 mt-1.5 w-64 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden">
          {allIdeOptions.map((option) => {
            const isCurrent = option.command === ideCommand;
            return (
              <div
                key={option.id}
                className={"group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors " + (isCurrent
                    ? "bg-accent-blue/10 text-accent-blue"
                    : "hover:bg-bg-hover text-text-primary")}
                onClick={() => handleSelectIde(option.command)}
                title="Set as default IDE for this project"
              >
                {option.icon ? (
                  <img
                    src={option.icon}
                    className="w-4 h-4 object-contain shrink-0"
                    alt=""
                  />
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center text-xs shrink-0">💻</span>
                )}
                <span className="flex-1 text-[var(--font-size)] truncate">
                  {option.name}
                </span>
                <span className="text-[11px] text-text-muted truncate max-w-[80px]">
                  {option.command}
                </span>
                <button
                  type="button"
                  onClick={(e) => handleRunIde(option.command, e)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-accent-blue hover:bg-bg-hover shrink-0"
                  title="Open now without changing default"
                  aria-label={"Open " + option.name + " now"}
                >
                  <Play size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default React.memo(OpenIdeButton);
