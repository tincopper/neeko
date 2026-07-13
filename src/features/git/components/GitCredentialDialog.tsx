import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/dialog';

interface GitCredentialDialogProps {
  open: boolean;
  host: string;
  usernameHint: string | null;
  onSubmit: (username: string, password: string) => void;
  onCancel: () => void;
}

const GitCredentialDialog: React.FC<GitCredentialDialogProps> = ({
  open,
  host,
  usernameHint,
  onSubmit,
  onCancel,
}) => {
  const [username, setUsername] = useState(usernameHint ?? '');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && password.trim()) {
      onSubmit(username.trim(), password);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Git Authentication Required</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#888' }}>Host</label>
            <div style={{
              padding: '8px 12px',
              background: '#2c313c',
              borderRadius: 4,
              fontSize: 13,
              color: '#abb2bf',
            }}>
              {host}
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#888' }}>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#1e2229',
                border: '1px solid #3b4049',
                borderRadius: 4,
                color: '#abb2bf',
                fontSize: 13,
                outline: 'none',
              }}
              placeholder="e.g. your GitHub username"
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#888' }}>
              Password / Personal Access Token
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: '#1e2229',
                border: '1px solid #3b4049',
                borderRadius: 4,
                color: '#abb2bf',
                fontSize: 13,
                outline: 'none',
              }}
              placeholder="ghp_xxx or git password"
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={onCancel}
              style={{
                padding: '6px 16px',
                background: '#2c313c',
                border: '1px solid #3b4049',
                borderRadius: 4,
                color: '#abb2bf',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!username.trim() || !password.trim()}
              style={{
                padding: '6px 16px',
                background: '#528bff',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 13,
                opacity: !username.trim() || !password.trim() ? 0.5 : 1,
              }}
            >
              Authenticate
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default GitCredentialDialog;
