import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RemoteProject, RemoteEntrySession, AuthMethod, AgentConfig, AppConfig } from "../../types";
import AgentIcon from "../layout/AgentIcon";
import { getIdeCommand, getIdeIconSrc, IDE_PRESETS } from "../../utils/idePresets";
import serverIcon from "../../assets/server.svg";

interface RemoteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** entry 为持久化数据；auth 为本次输入的认证信息（仅内存）；saved_auth 为 Base64 编码的持久化凭据 */
  onAdd: (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null) => void;
  existingEntries: RemoteEntrySession[];
  addProjectMode?: boolean;
  selectedEntryId?: string;
  agents: AgentConfig[];
  config: AppConfig;
  /** 已有服务器的 auth 缓存（entryId → AuthMethod），用于向已有服务器添加项目时的路径补全 */
  existingEntryAuth?: Map<string, AuthMethod>;
}

export function RemoteDialog({
  isOpen,
  onClose,
  onAdd,
  existingEntries,
  addProjectMode = false,
  selectedEntryId: selectedEntryIdProp,
  agents,
  config,
  existingEntryAuth,
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
  const [saveCredentials, setSaveCredentials] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [selectedServer, setSelectedServer] = useState<RemoteEntrySession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const agentDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedIdeId, setSelectedIdeId] = useState<string | null>(null);
  const [ideDropdownOpen, setIdeDropdownOpen] = useState(false);
  const ideDropdownRef = useRef<HTMLDivElement>(null);

  // 路径自动补全状态
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const pathDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeq = useRef(0);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const pathWrapperRef = useRef<HTMLDivElement>(null);

  // 点击补全框外侧关闭
  useEffect(() => {
    if (!showSuggestions) return;
    const handleClick = (e: MouseEvent) => {
      if (pathWrapperRef.current && !pathWrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSuggestions]);

  useEffect(() => {
    if (isOpen && addProjectMode && selectedEntryIdProp) {
      const entry = existingEntries.find(e => e.id === selectedEntryIdProp);
      if (entry) {
        setSelectedServer(entry);
        setStep("add-project");
      }
    }
  }, [isOpen, addProjectMode, selectedEntryIdProp, existingEntries]);

  // 获取当前 add-project 步骤可用的 auth
  const getCurrentAuth = (): AuthMethod | null => {
    if (selectedServer) {
      return existingEntryAuth?.get(selectedServer.id) ?? null;
    }
    if (authType === "password" && password) return { Password: password };
    if (authType === "key" && keyPath) return { KeyFile: keyPath };
    return null;
  };

  const getCurrentHost = () => selectedServer?.host ?? host;
  const getCurrentPort = () => selectedServer ? selectedServer.port : (parseInt(port) || 22);
  const getCurrentUsername = () => selectedServer?.username ?? username;

  const fetchSuggestions = async (inputPath: string) => {
    const seq = ++fetchSeq.current;
    const auth = getCurrentAuth();
    if (!auth || !getCurrentHost()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    if (!inputPath) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const lastSlash = inputPath.lastIndexOf("/");
    const parentDir = lastSlash === -1 ? "/" : inputPath.slice(0, lastSlash) || "/";
    const prefix = lastSlash === -1 ? inputPath : inputPath.slice(lastSlash + 1);

    setLoadingSuggestions(true);
    try {
      const dirs = await invoke<string[]>("list_remote_directories", {
        host: getCurrentHost(),
        port: getCurrentPort(),
        username: getCurrentUsername(),
        auth,
        path: parentDir,
      });
      if (seq !== fetchSeq.current) return;
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

  const handlePathChange = (newPath: string) => {
    setProjectPath(newPath);
    if (newPath) {
      const name = newPath.replace(/\/$/, "").split("/").filter(Boolean).pop() || "";
      setProjectName(name);
    }
    setActiveSuggestion(-1);
    if (pathDebounceTimer.current) clearTimeout(pathDebounceTimer.current);
    pathDebounceTimer.current = setTimeout(() => fetchSuggestions(newPath), 400);
  };

  const handleSelectSuggestion = (suggestion: string) => {
    setProjectPath(suggestion);
    const name = suggestion.replace(/\/$/, "").split("/").filter(Boolean).pop() || "";
    setProjectName(name);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
    pathInputRef.current?.focus();
    if (pathDebounceTimer.current) clearTimeout(pathDebounceTimer.current);
    pathDebounceTimer.current = setTimeout(() => fetchSuggestions(suggestion + "/"), 0);
  };

  const handlePathKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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

  const handleConnect = async () => {
    if (!host || !username) {
      setError("Please fill in host and username");
      return;
    }
    const auth: AuthMethod =
      authType === "password" ? { Password: password } : { KeyFile: keyPath };

    setError(null);
    setConnecting(true);
    try {
      await invoke("test_remote_connection", {
        host,
        port: parseInt(port) || 22,
        username,
        auth,
      });
      setStep("add-project");
      // 连接成功后聚焦路径输入并触发初始补全
      setTimeout(() => {
        pathInputRef.current?.focus();
        fetchSuggestions("/");
      }, 50);
    } catch (err) {
      setError(`Connection failed: ${err}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleAddProject = () => {
    if (!projectName || !projectPath) {
      setError("Please fill in all fields");
      return;
    }

    // 解析 selected_ide 命令
    let selectedIdeCommand: string | null = null;
    if (selectedIdeId) {
      if (selectedIdeId.startsWith("custom:")) {
        const customIdx = parseInt(selectedIdeId.replace("custom:", ""), 10);
        selectedIdeCommand = config.customIdes?.[customIdx]?.command ?? null;
      } else {
        const preset = IDE_PRESETS.find(i => i.id === selectedIdeId);
        if (preset) selectedIdeCommand = config.ideCommandOverrides?.[preset.id] ?? getIdeCommand(preset);
      }
    }

    const newProject: RemoteProject = {
      id: crypto.randomUUID(),
      name: projectName,
      path: projectPath,
      entry_id: selectedServer?.id || crypto.randomUUID(),
      selected_agent: selectedAgentId,
      selected_ide: selectedIdeCommand,
    };

    if (selectedServer) {
      const updatedEntry: RemoteEntrySession = {
        ...selectedServer,
        projects: [...selectedServer.projects, newProject],
      };
      onAdd(updatedEntry, null);
    } else {
      const auth: AuthMethod =
        authType === "password"
          ? { Password: password }
          : { KeyFile: keyPath };
      const encodedAuth = saveCredentials ? btoa(JSON.stringify(auth)) : null;
      const newEntry: RemoteEntrySession = {
        id: crypto.randomUUID(),
        host,
        port: parseInt(port) || 22,
        username,
        projects: [newProject],
        saved_auth: encodedAuth,
      };
      onAdd(newEntry, auth, encodedAuth);
    }

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
    setSaveCredentials(false);
    setProjectName("");
    setProjectPath("");
    setSelectedServer(null);
    setError(null);
    setConnecting(false);
    setSelectedAgentId(null);
    setAgentDropdownOpen(false);
    setSuggestions([]);
    setShowSuggestions(false);
    setActiveSuggestion(-1);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const previewName = projectPath.replace(/\/$/, "").split("/").filter(Boolean).pop() || projectPath;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal wsl-modal" onClick={e => e.stopPropagation()}>
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
              <label className="custom-radio">
                <input type="radio" checked={authType === "password"} onChange={() => setAuthType("password")} />
                <span className="radio-mark" />
                Password
              </label>
              <label className="custom-radio">
                <input type="radio" checked={authType === "key"} onChange={() => setAuthType("key")} />
                <span className="radio-mark" />
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

            <label className="custom-checkbox save-credentials-label" style={{ marginTop: 14 }}>
              <input
                type="checkbox"
                checked={saveCredentials}
                onChange={e => setSaveCredentials(e.target.checked)}
              />
              <span className="checkbox-mark" />
              Save credentials (stored locally with Base64 obfuscation)
            </label>
          </>
        ) : (
          <>
            {/* 服务器信息 */}
            <label className="gh-dialog-label">Server</label>
            <div className="remote-selected-server">
              <img className="remote-server-icon" src={serverIcon} width={15} height={15} alt="" />
              <span>{selectedServer ? selectedServer.host : `${host}:${port}`}</span>
            </div>

            {/* 路径输入 + 自动补全 */}
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>Project Path (on server)</label>
            <div className="wsl-path-autocomplete" ref={pathWrapperRef}>
              <input
                ref={pathInputRef}
                type="text"
                value={projectPath}
                onChange={e => handlePathChange(e.target.value)}
                onKeyDown={handlePathKeyDown}
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

            {/* 项目名预览 */}
            {projectPath && projectPath !== "/" && (
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
                {(() => {
                  const agent = agents.find(a => a.id === selectedAgentId);
                  return agent ? (
                    <>
                      <AgentIcon icon={agent.icon} />
                      <span className="agent-name">{agent.name}</span>
                    </>
                  ) : (
                    <>
                      <AgentIcon icon={null} fallback="⚡" />
                      <span className="agent-name">None</span>
                    </>
                  );
                })()}
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

            {/* IDE 选择 */}
            <label className="gh-dialog-label" style={{ marginTop: 14 }}>IDE</label>
            <div className="agent-selector" ref={ideDropdownRef} style={{ width: "100%", marginTop: 4 }}>
              <button
                className="agent-dropdown-btn"
                style={{ width: "100%" }}
                onClick={() => setIdeDropdownOpen(v => !v)}
              >
                {(() => {
                  const preset = selectedIdeId && !selectedIdeId.startsWith("custom:")
                    ? IDE_PRESETS.find(i => i.id === selectedIdeId) : null;
                  if (preset) return (
                    <>
                      <img src={getIdeIconSrc(preset.icon)} alt="" style={{ width: 16, height: 16 }} />
                      <span className="agent-name">{preset.name}</span>
                    </>
                  );
                  if (selectedIdeId?.startsWith("custom:")) {
                    const ci = parseInt(selectedIdeId.replace("custom:", ""), 10);
                    const customIde = config.customIdes?.[ci];
                    return (
                      <>
                        <img src={getIdeIconSrc(null)} alt="" style={{ width: 16, height: 16 }} />
                        <span className="agent-name">{customIde?.name ?? "Custom IDE"}</span>
                      </>
                    );
                  }
                  return <span className="agent-name" style={{ opacity: 0.5 }}>None (VSCode/Cursor/Zed)</span>;
                })()}
                <span className="dropdown-arrow" style={{ marginLeft: "auto" }}>
                  {ideDropdownOpen ? "−" : "+"}
                </span>
              </button>
              {ideDropdownOpen && (
                <div className="agent-dropdown" style={{ left: 0, right: 0, minWidth: "unset" }}>
                  <div
                    className={`agent-option${!selectedIdeId ? " selected" : ""}`}
                    onClick={() => { setSelectedIdeId(null); setIdeDropdownOpen(false); }}
                  >
                    <span className="agent-name">None</span>
                  </div>
                  {IDE_PRESETS.filter(p => ["vscode", "cursor", "zed"].includes(p.id)).map(preset => (
                    <div
                      key={preset.id}
                      className={`agent-option${selectedIdeId === preset.id ? " selected" : ""}`}
                      onClick={() => { setSelectedIdeId(preset.id); setIdeDropdownOpen(false); }}
                    >
                      <img src={getIdeIconSrc(preset.icon)} alt="" style={{ width: 16, height: 16 }} />
                      <span className="agent-name">{preset.name}</span>
                      <span className="agent-command">{config.ideCommandOverrides?.[preset.id] ?? getIdeCommand(preset)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={handleClose}>Cancel</button>
          {step === "server-config" ? (
            <button
              className="modal-btn confirm"
              onClick={handleConnect}
              disabled={!host || !username || connecting}
            >
              {connecting ? "Connecting..." : "Connect"}
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
