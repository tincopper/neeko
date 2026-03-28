import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WSLProject, WSLEntrySession, AgentConfig } from "../../types";
import AgentIcon from "../layout/AgentIcon";
import { getDistroIcon } from "../../utils/distros";

interface WSLDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (entry: WSLEntrySession) => void;
  existingEntries: WSLEntrySession[];
  /** 传入时直接跳到 select-path 步骤并预选该发行版 */
  selectedEntryId?: string;
  agents: AgentConfig[];
}

export function WSLDialog({ isOpen, onClose, onAdd, existingEntries, selectedEntryId, agents }: WSLDialogProps) {
  const [step, setStep] = useState<"select-distro" | "select-path">("select-distro");
  const [distros, setDistros] = useState<string[]>([]);
  const [selectedDistro, setSelectedDistro] = useState<string>("");
  const [inputPath, setInputPath] = useState<string>("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [loadingDistros, setLoadingDistros] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeq = useRef(0); // 用于丢弃过期请求结果
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null); // 用于点击外侧关闭
  const agentDropdownRef = useRef<HTMLDivElement>(null);

  // 点击补全框外侧关闭下拉
  useEffect(() => {
    if (!showSuggestions) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSuggestions]);

  useEffect(() => {
    if (!isOpen) return;
    if (selectedEntryId) {
      const entry = existingEntries.find(e => e.id === selectedEntryId);
      if (entry) { handleSelectDistro(entry.distro); return; }
    }
    loadDistros();
  }, [isOpen]);

  const loadDistros = async () => {
    try {
      setLoadingDistros(true);
      setError(null);
      const result = await invoke<string[]>("get_wsl_distros");
      setDistros(result);
    } catch (err) {
      setError(`Failed to load WSL distros: ${err}`);
    } finally {
      setLoadingDistros(false);
    }
  };

  // 根据输入路径查询补全。使用序号丢弃过期结果，避免慢请求覆盖新结果。
  const fetchSuggestions = async (path: string, distro: string) => {
    const seq = ++fetchSeq.current;

    if (!path) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const lastSlash = path.lastIndexOf("/");
    const parentDir = lastSlash === -1 ? "/" : path.slice(0, lastSlash) || "/";
    const prefix = lastSlash === -1 ? path : path.slice(lastSlash + 1);

    setLoadingSuggestions(true);
    try {
      const dirs = await invoke<string[]>("get_wsl_directories", {
        distro,
        path: parentDir,
      });
      if (seq !== fetchSeq.current) return; // 过期，丢弃
      const base = parentDir === "/" ? "" : parentDir;
      const filtered = dirs
        .filter(d => d.toLowerCase().startsWith(prefix.toLowerCase()))
        .map(d => `${base}/${d}`);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      setActiveSuggestion(-1);
    } catch {
      if (seq !== fetchSeq.current) return;
      setSuggestions([]);
      setShowSuggestions(false);
    } finally {
      if (seq === fetchSeq.current) setLoadingSuggestions(false);
    }
  };

  const handleSelectDistro = async (distro: string) => {
    setSelectedDistro(distro);
    let homeDir = "/home";
    try {
      homeDir = await invoke<string>("get_wsl_home_dir", { distro });
    } catch { /* ignore */ }
    setInputPath(homeDir);
    setStep("select-path");
    setTimeout(() => {
      inputRef.current?.focus();
      fetchSuggestions(homeDir, distro);
    }, 50);
  };

  const handlePathChange = (newPath: string) => {
    setInputPath(newPath);
    setActiveSuggestion(-1);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    // 400ms debounce：减少在用户连续输入时的请求频率
    debounceTimer.current = setTimeout(() => fetchSuggestions(newPath, selectedDistro), 400);
  };

  // 选择一条建议：填入路径并立即展示该目录下的子目录
  const handleSelectSuggestion = (suggestion: string) => {
    setInputPath(suggestion);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    inputRef.current?.focus();
    // 展示所选目录的子目录列表
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => fetchSuggestions(suggestion + "/", selectedDistro), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSuggestion(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestion(prev => Math.max(prev - 1, -1));
    } else if (e.key === "Tab" || e.key === "Enter") {
      if (activeSuggestion >= 0) {
        e.preventDefault();
        handleSelectSuggestion(suggestions[activeSuggestion]);
      } else if (e.key === "Tab" && suggestions.length > 0) {
        e.preventDefault();
        handleSelectSuggestion(suggestions[0]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const handleConfirmPath = () => {
    const finalPath = inputPath.endsWith("/") ? inputPath.slice(0, -1) : inputPath;

    if (!finalPath || finalPath === "/") {
      setError("Please enter a valid path");
      return;
    }

    const existingEntry = existingEntries.find(e => e.distro === selectedDistro);
    const projectName = finalPath.split("/").filter(Boolean).pop() || finalPath;

    const newProject: WSLProject = {
      id: crypto.randomUUID(),
      name: projectName,
      path: finalPath,
      distro: selectedDistro,
      entry_id: existingEntry?.id || crypto.randomUUID(),
      selected_agent: selectedAgentId,
    };

    if (existingEntry) {
      if (existingEntry.projects.some(p => p.path === finalPath)) {
        setError("This path is already added");
        return;
      }
      onAdd({ ...existingEntry, projects: [...existingEntry.projects, newProject] });
    } else {
      onAdd({ id: crypto.randomUUID(), distro: selectedDistro, projects: [newProject] });
    }

    handleClose();
  };

  const handleClose = () => {
    setStep("select-distro");
    setSelectedDistro("");
    setInputPath("");
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    setError(null);
    setSelectedAgentId(null);
    setAgentDropdownOpen(false);
    onClose();
  };

  if (!isOpen) return null;

  const previewName = inputPath.replace(/\/$/, "").split("/").filter(Boolean).pop() || inputPath;
  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal wsl-modal" onClick={e => e.stopPropagation()}>
        <h3>{step === "select-distro" ? "Select WSL Distro" : "Add WSL Project"}</h3>

        {error && <p className="gh-dialog-error">{error}</p>}

        {step === "select-distro" ? (
          <>
            {loadingDistros ? (
              <p className="wsl-loading">Loading WSL distros...</p>
            ) : distros.length === 0 ? (
              <p className="wsl-empty">No WSL distros found. Please install a WSL distro first.</p>
            ) : (
              <div className="wsl-distro-list">
                {distros.map(distro => (
                  <div
                    key={distro}
                    className="wsl-distro-item"
                    onClick={() => handleSelectDistro(distro)}
                  >
                    <img className="wsl-distro-icon" src={getDistroIcon(distro)} width={15} height={15} alt="" />
                    <span className="wsl-distro-name">{distro}</span>
                    <span className="wsl-distro-arrow">›</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="wsl-path-header">
              <img className="wsl-distro-icon" src={getDistroIcon(selectedDistro)} width={15} height={15} alt="" />
              <span className="wsl-distro-label">{selectedDistro}</span>
            </div>

            <label className="gh-dialog-label">Project Path</label>
            <div className="wsl-path-autocomplete" ref={wrapperRef}>
              <input
                ref={inputRef}
                type="text"
                value={inputPath}
                onChange={e => handlePathChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder="/home/user/my-project"
                className="gh-dialog-input"
                autoComplete="off"
                spellCheck={false}
              />
              {showSuggestions && (
                <div className="wsl-suggestions">
                  {loadingSuggestions ? (
                    <div className="wsl-suggestion-loading">Loading...</div>
                  ) : (
                    suggestions.map((s, i) => {
                      const parts = s.split("/");
                      const name = parts[parts.length - 1] || s;
                      const parent = parts.slice(0, -1).join("/") || "/";
                      return (
                        <div
                          key={s}
                          className={`wsl-suggestion-item${i === activeSuggestion ? " active" : ""}`}
                          onMouseDown={() => handleSelectSuggestion(s)}
                        >
                          <span className="wsl-suggestion-icon">📁</span>
                          <span className="wsl-suggestion-name">{name}</span>
                          <span className="wsl-suggestion-parent">{parent}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {inputPath && inputPath !== "/" && (
              <div className="wsl-project-preview">
                <span className="wsl-preview-label">Project name:</span>
                <span className="wsl-preview-name">{previewName}</span>
              </div>
            )}

            {/* Agent 选择 */}
            <label className="gh-dialog-label" style={{ marginTop: 14 }}>Agent</label>
            <div className="agent-selector" ref={agentDropdownRef} style={{ width: "100%", marginTop: 4 }}>
              <button
                className="agent-dropdown-btn"
                style={{ width: "100%" }}
                onClick={() => setAgentDropdownOpen(v => !v)}
              >
                {selectedAgent ? (
                  <>
                    <AgentIcon icon={selectedAgent.icon} />
                    <span className="agent-name">{selectedAgent.name}</span>
                  </>
                ) : (
                  <>
                    <AgentIcon icon={null} fallback="⚡" />
                    <span className="agent-name">None</span>
                  </>
                )}
                <span className="dropdown-arrow" style={{ marginLeft: "auto" }}>
                  {agentDropdownOpen ? "−" : "+"}
                </span>
              </button>
              {agentDropdownOpen && (
                <div className="agent-dropdown" style={{ left: 0, right: 0, minWidth: "unset" }}>
                  <div
                    className={`agent-option${!selectedAgentId ? " selected" : ""}`}
                    onClick={() => { setSelectedAgentId(null); setAgentDropdownOpen(false); }}
                  >
                    <AgentIcon icon={null} fallback="⚡" />
                    <span className="agent-name">None</span>
                  </div>
                  {agents.filter(a => a.enabled).map(agent => (
                    <div
                      key={agent.id}
                      className={`agent-option${selectedAgentId === agent.id ? " selected" : ""}`}
                      onClick={() => { setSelectedAgentId(agent.id); setAgentDropdownOpen(false); }}
                    >
                      <AgentIcon icon={agent.icon} />
                      <span className="agent-name">{agent.name}</span>
                      <span className="agent-command">{agent.command}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={handleClose}>Cancel</button>
          {step === "select-path" && (
            <button
              className="modal-btn confirm"
              onClick={handleConfirmPath}
              disabled={!inputPath || inputPath === "/"}
            >
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
