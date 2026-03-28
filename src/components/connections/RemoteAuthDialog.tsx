import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AuthMethod } from "../../types";

interface RemoteAuthDialogProps {
  isOpen: boolean;
  host: string;
  port: number;
  username: string;
  onCancel: () => void;
  /** 认证成功后回调，返回用户输入的 auth */
  onSuccess: (auth: AuthMethod) => void;
}

export function RemoteAuthDialog({
  isOpen,
  host,
  port,
  username,
  onCancel,
  onSuccess,
}: RemoteAuthDialogProps) {
  const [authType, setAuthType] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const reset = () => {
    setAuthType("password");
    setPassword("");
    setKeyPath("");
    setError(null);
    setConnecting(false);
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const handleConnect = async () => {
    const auth: AuthMethod =
      authType === "password" ? { Password: password } : { KeyFile: keyPath };

    setError(null);
    setConnecting(true);
    try {
      await invoke("test_remote_connection", { host, port, username, auth });
      reset();
      onSuccess(auth);
    } catch (err) {
      setError(`Authentication failed: ${err}`);
    } finally {
      setConnecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal wsl-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3>Authentication Required</h3>
        <p style={{ margin: "0 0 12px", color: "var(--text-secondary, #888)", fontSize: 13 }}>
          {username}@{host}:{port}
        </p>

        {error && <p className="gh-dialog-error">{error}</p>}

        <label className="gh-dialog-label">Auth Type</label>
        <div className="auth-type-selector">
          <label>
            <input type="radio" checked={authType === "password"} onChange={() => setAuthType("password")} />
            Password
          </label>
          <label>
            <input type="radio" checked={authType === "key"} onChange={() => setAuthType("key")} />
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
              onKeyDown={e => e.key === "Enter" && !connecting && handleConnect()}
              placeholder="••••••••"
              className="gh-dialog-input"
              autoFocus
            />
          </>
        ) : (
          <>
            <label className="gh-dialog-label" style={{ marginTop: 12 }}>Key File Path</label>
            <input
              type="text"
              value={keyPath}
              onChange={e => setKeyPath(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !connecting && handleConnect()}
              placeholder="~/.ssh/id_rsa"
              className="gh-dialog-input"
              autoFocus
            />
          </>
        )}

        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={handleCancel}>Cancel</button>
          <button
            className="modal-btn confirm"
            onClick={handleConnect}
            disabled={connecting || (authType === "password" ? !password : !keyPath)}
          >
            {connecting ? "Connecting..." : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
