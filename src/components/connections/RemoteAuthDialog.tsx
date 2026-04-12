import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AuthMethod } from "../../types";

interface RemoteAuthDialogProps {
  isOpen: boolean;
  host: string;
  port: number;
  username: string;
  onCancel: () => void;
  /** 认证成功后回调，返回用户输入的 auth 和可选的 Base64 编码凭据 */
  onSuccess: (auth: AuthMethod, saved_auth?: string | null) => void;
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
  const [saveCredentials, setSaveCredentials] = useState(false);

  const reset = () => {
    setAuthType("password");
    setPassword("");
    setKeyPath("");
    setError(null);
    setConnecting(false);
    setSaveCredentials(false);
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
      const encodedAuth = saveCredentials ? btoa(JSON.stringify(auth)) : null;
      reset();
      onSuccess(auth, encodedAuth);
    } catch (err) {
      setError(`Authentication failed: ${err}`);
    } finally {
      setConnecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000]" onClick={handleCancel}>
      <div className="bg-bg-secondary border border-border rounded-lg p-6 min-w-[460px] max-w-[560px] shadow-xl overflow-visible" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3 className="mb-3 text-lg font-semibold text-text-primary">Authentication Required</h3>
        <p style={{ margin: "0 0 12px", color: "var(--text-secondary, #888)", fontSize: 13 }}>
          {username}@{host}:{port}
        </p>

        {error && <p className="text-accent-red bg-accent-red/10 border border-accent-red rounded-md p-3 mb-4 text-[13px]">{error}</p>}

        <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">Auth Type</label>
        <div className="flex gap-5 mb-4">
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
            <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide" style={{ marginTop: 12 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !connecting && handleConnect()}
              placeholder="••••••••"
              className="w-full p-3 bg-bg-primary border border-border rounded-md text-text-primary text-[var(--font-size)] font-mono outline-none transition-border-color duration-200 focus:border-accent-blue"
              autoFocus
            />
          </>
        ) : (
          <>
            <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide" style={{ marginTop: 12 }}>Key File Path</label>
            <input
              type="text"
              value={keyPath}
              onChange={e => setKeyPath(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !connecting && handleConnect()}
              placeholder="~/.ssh/id_rsa"
              className="w-full p-3 bg-bg-primary border border-border rounded-md text-text-primary text-[var(--font-size)] font-mono outline-none transition-border-color duration-200 focus:border-accent-blue"
              autoFocus
            />
          </>
        )}

        <label className="custom-checkbox flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer" style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={saveCredentials}
            onChange={e => setSaveCredentials(e.target.checked)}
          />
          <span className="checkbox-mark" />
          记住密码（本地存储）
        </label>

        <div className="flex justify-end gap-3 mt-5">
          <button className="px-4 py-2 rounded-md text-[var(--font-size)] cursor-pointer transition-all duration-200 border border-border bg-bg-tertiary text-text-primary hover:bg-bg-hover" onClick={handleCancel}>Cancel</button>
          <button
            className="px-4 py-2 rounded-md text-[var(--font-size)] cursor-pointer transition-all duration-200 border border-accent-blue bg-accent-blue text-white hover:bg-[#519aba] disabled:opacity-50 disabled:cursor-not-allowed"
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