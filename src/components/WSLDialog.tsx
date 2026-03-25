import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WSLProject, WSLEntrySession, RemoteProject, RemoteEntrySession } from "../types";

interface WSLDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (entry: WSLEntrySession) => void;
  existingEntries: WSLEntrySession[];
}

export function WSLDialog({ isOpen, onClose, onAdd, existingEntries }: WSLDialogProps) {
  const [step, setStep] = useState<"select-distro" | "add-project">("select-distro");
  const [distros, setDistros] = useState<string[]>([]);
  const [selectedDistro, setSelectedDistro] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [projectPath, setProjectPath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadDistros();
    }
  }, [isOpen]);

  const loadDistros = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await invoke<string[]>("get_wsl_distros");
      setDistros(result);
    } catch (err) {
      setError(`Failed to load WSL distros: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDistro = (distro: string) => {
    setSelectedDistro(distro);
    setStep("add-project");
  };

  const handleAddProject = () => {
    if (!selectedDistro || !projectName || !projectPath) {
      setError("Please fill in all fields");
      return;
    }

    const existingEntry = existingEntries.find(e => e.distro === selectedDistro);
    
    const newProject: WSLProject = {
      id: crypto.randomUUID(),
      name: projectName,
      path: projectPath,
      distro: selectedDistro,
      entry_id: existingEntry?.id || crypto.randomUUID(),
    };

    if (existingEntry) {
      // 添加到现有发行版
      const updatedEntry: WSLEntrySession = {
        ...existingEntry,
        projects: [...existingEntry.projects, newProject],
      };
      onAdd(updatedEntry);
    } else {
      // 创建新发行版
      const newEntry: WSLEntrySession = {
        id: crypto.randomUUID(),
        distro: selectedDistro,
        projects: [newProject],
      };
      onAdd(newEntry);
    }

    // 重置状态
    setStep("select-distro");
    setSelectedDistro("");
    setProjectName("");
    setProjectPath("");
    setError(null);
    onClose();
  };

  const handleClose = () => {
    setStep("select-distro");
    setSelectedDistro("");
    setProjectName("");
    setProjectPath("");
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{step === "select-distro" ? "Select WSL Distro" : "Add WSL Project"}</h3>
        
        {error && <p className="gh-dialog-error">{error}</p>}
        
        {step === "select-distro" ? (
          <>
            {loading ? (
              <p>Loading WSL distros...</p>
            ) : distros.length === 0 ? (
              <p>No WSL distros found. Please install a WSL distro first.</p>
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
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <label className="gh-dialog-label">Distro</label>
            <div className="wsl-selected-distro">
              <span className="wsl-distro-icon">🐧</span>
              <span>{selectedDistro}</span>
            </div>
            
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>Project Name</label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="my-project"
              className="gh-dialog-input"
            />
            
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>Project Path (in WSL)</label>
            <input
              type="text"
              value={projectPath}
              onChange={e => setProjectPath(e.target.value)}
              placeholder="/home/user/my-project"
              className="gh-dialog-input"
            />
          </>
        )}
        
        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={handleClose}>Cancel</button>
          {step === "add-project" && (
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
            
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>Project Name</label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="my-project"
              className="gh-dialog-input"
            />
            
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>Project Path (on server)</label>
            <input
              type="text"
              value={projectPath}
              onChange={e => setProjectPath(e.target.value)}
              placeholder="/home/user/my-project"
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
