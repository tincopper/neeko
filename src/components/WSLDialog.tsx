import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WSLProject, WSLEntrySession, RemoteProject, RemoteEntrySession } from "../types";

interface WSLDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (entry: WSLEntrySession) => void;
  existingEntries: WSLEntrySession[];
  /** 传入时直接跳到 select-path 步骤并预选该发行版 */
  selectedEntryId?: string;
}

export function WSLDialog({ isOpen, onClose, onAdd, existingEntries, selectedEntryId }: WSLDialogProps) {
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
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeq = useRef(0); // 用于丢弃过期请求结果
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null); // 用于点击外侧关闭

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
    onClose();
  };

  if (!isOpen) return null;

  const previewName = inputPath.replace(/\/$/, "").split("/").filter(Boolean).pop() || inputPath;

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
                    <span className="wsl-distro-icon">🐧</span>
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
              <span className="wsl-distro-icon">🐧</span>
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

interface RemoteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (entry: RemoteEntrySession) => void;
  existingEntries: RemoteEntrySession[];
  addProjectMode?: boolean;
  selectedEntryId?: string;
}

export function RemoteDialog({ 
  isOpen, 
  onClose, 
  onAdd, 
  existingEntries,
  addProjectMode = false,
  selectedEntryId: selectedEntryIdProp,
}: RemoteDialogProps) {
  const [step, setStep] = useState<"server-config" | "add-project">(
    addProjectMode ? "add-project" : "server-config"
  );
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [selectedServer, setSelectedServer] = useState<RemoteEntrySession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && addProjectMode && selectedEntryIdProp) {
      const entry = existingEntries.find(e => e.id === selectedEntryIdProp);
      if (entry) {
        setSelectedServer(entry);
        setStep("add-project");
      }
    }
  }, [isOpen, addProjectMode, selectedEntryIdProp, existingEntries]);

  const handleConnect = () => {
    if (!host || !username) {
      setError("Please fill in host and username");
      return;
    }

    setStep("add-project");
  };

  const handlePathChange = (path: string) => {
    setProjectPath(path);
    // 自动从路径中提取项目名
    if (path) {
      const name = path.split("/").filter(Boolean).pop() || "";
      setProjectName(name);
    }
  };

  const handleAddProject = () => {
    if (!projectName || !projectPath) {
      setError("Please fill in all fields");
      return;
    }

    const newProject: RemoteProject = {
      id: crypto.randomUUID(),
      name: projectName,
      path: projectPath,
      entry_id: selectedServer?.id || crypto.randomUUID(),
    };

    if (selectedServer) {
      // 添加到现有服务器
      const updatedEntry: RemoteEntrySession = {
        ...selectedServer,
        projects: [...selectedServer.projects, newProject],
      };
      onAdd(updatedEntry);
    } else {
      // 创建新服务器
      const newEntry: RemoteEntrySession = {
        id: crypto.randomUUID(),
        host,
        port: parseInt(port) || 22,
        username,
        projects: [newProject],
      };
      onAdd(newEntry);
    }

    // 重置状态
    resetState();
    onClose();
  };

  const resetState = () => {
    setStep("server-config");
    setHost("");
    setPort("22");
    setUsername("");
    setAuthType("password");
    setPassword("");
    setKeyPath("");
    setProjectName("");
    setProjectPath("");
    setSelectedServer(null);
    setError(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{step === "server-config" ? "Add Remote Server" : "Add Remote Project"}</h3>
        
        {error && <p className="gh-dialog-error">{error}</p>}
        
        {step === "server-config" ? (
          <>
            <label className="gh-dialog-label">Host</label>
            <input
              type="text"
              value={host}
              onChange={e => setHost(e.target.value)}
              placeholder="192.168.1.100 or example.com"
              className="gh-dialog-input"
            />
            
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>Port</label>
            <input
              type="number"
              value={port}
              onChange={e => setPort(e.target.value)}
              placeholder="22"
              className="gh-dialog-input"
            />
            
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="root"
              className="gh-dialog-input"
            />
            
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>Auth Type</label>
            <div className="auth-type-selector">
              <label>
                <input
                  type="radio"
                  checked={authType === "password"}
                  onChange={() => setAuthType("password")}
                />
                Password
              </label>
              <label>
                <input
                  type="radio"
                  checked={authType === "key"}
                  onChange={() => setAuthType("key")}
                />
                Key File
              </label>
            </div>
            
            {authType === "password" ? (
              <>
                <label className="gh-dialog-label" style={{ marginTop: 12 }}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="gh-dialog-input"
                />
              </>
            ) : (
              <>
                <label className="gh-dialog-label" style={{ marginTop: 12 }}>Key File Path</label>
                <input
                  type="text"
                  value={keyPath}
                  onChange={e => setKeyPath(e.target.value)}
                  placeholder="~/.ssh/id_rsa"
                  className="gh-dialog-input"
                />
              </>
            )}
          </>
        ) : (
          <>
            {selectedServer ? (
              <>
                <label className="gh-dialog-label">Server</label>
                <div className="remote-selected-server">
                  <span className="remote-server-icon">🖥️</span>
                  <span>{selectedServer.host}</span>
                </div>
              </>
            ) : (
              <>
                <label className="gh-dialog-label">Server</label>
                <div className="remote-selected-server">
                  <span className="remote-server-icon">🖥️</span>
                  <span>{host}:{port}</span>
                </div>
              </>
            )}
            
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>Project Path (on server)</label>
            <input
              type="text"
              value={projectPath}
              onChange={e => handlePathChange(e.target.value)}
              placeholder="/home/user/my-project"
              className="gh-dialog-input"
            />
            
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>Project Name</label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="Auto-generated from path"
              className="gh-dialog-input"
            />
          </>
        )}
        
        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={handleClose}>Cancel</button>
          {step === "server-config" ? (
            <button 
              className="modal-btn confirm" 
              onClick={handleConnect}
              disabled={!host || !username}
            >
              Connect
            </button>
          ) : (
            <button 
              className="modal-btn confirm" 
              onClick={handleAddProject}
              disabled={!projectName || !projectPath}
            >
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
