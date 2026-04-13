import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AuthMethod } from "../../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";

interface RemoteAuthDialogProps {
  isOpen: boolean;
  host: string;
  port: number;
  username: string;
  onCancel: () => void;
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Authentication Required</DialogTitle>
        </DialogHeader>
        <p className="text-[13px] text-text-secondary mb-3">
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
            <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">Password</label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !connecting && handleConnect()}
              placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
              autoFocus
            />
          </>
        ) : (
          <>
            <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">Key File Path</label>
            <Input
              type="text"
              value={keyPath}
              onChange={e => setKeyPath(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !connecting && handleConnect()}
              placeholder="~/.ssh/id_rsa"
              autoFocus
            />
          </>
        )}

        <div className="mt-3.5">
          <Checkbox
            checked={saveCredentials}
            onCheckedChange={checked => setSaveCredentials(!!checked)}
            label="\u8BB0\u4F4F\u5BC6\u7801\uFF08\u672C\u5730\u5B58\u50A8\uFF09"
          />
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={handleCancel}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleConnect}
            disabled={connecting || (authType === "password" ? !password : !keyPath)}
          >
            {connecting ? "Connecting..." : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
