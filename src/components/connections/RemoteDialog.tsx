import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RemoteProject, RemoteEntrySession, AuthMethod } from "../../types";
import AgentIcon from "../layout/AgentIcon";
import { useAppContext } from "../../contexts";
import { getIdeCommand, getIdeIconSrc, IDE_PRESETS } from "../../utils/idePresets";
import { randomAvatarColor } from "../../utils/projectAvatar";
import serverIcon from "../../assets/server.svg";
import { cn } from "../../utils/cn";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";

interface RemoteDialogProps {
   isOpen: boolean;
   onClose: () => void;
   /** entry 为持久化数据；auth 为本次输入的认证信息（仅内存）；saved_auth 为 Base64 编码的持久化凭据 */
   onAdd: (entry: RemoteEntrySession, auth: AuthMethod | null, saved_auth?: string | null) => void;
   existingEntries: RemoteEntrySession[];
   addProjectMode?: boolean;
   selectedEntryId?: string;
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
   existingEntryAuth,
}: RemoteDialogProps) {
   const { agents, config } = useAppContext();
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
         avatar_color: randomAvatarColor(),
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

   return (
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
         <DialogContent className="min-w-[460px] max-w-[560px]">
            <DialogHeader>
               <DialogTitle>{step === "server-config" ? "Add Remote Server" : "Add Remote Project"}</DialogTitle>
            </DialogHeader>

            {error && <p className="text-accent-red bg-accent-red/10 border border-accent-red rounded-md p-3 mb-4 text-[13px]">{error}</p>}

            {step === "server-config" ? (
               <>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">Host</label>
                  <Input
                     type="text"
                     value={host}
                     onChange={e => setHost(e.target.value)}
                     placeholder="192.168.1.100 or example.com"
                  />

                  <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide mt-3">Port</label>
                  <Input
                     type="number"
                     value={port}
                     onChange={e => setPort(e.target.value)}
                     placeholder="22"
                  />

                  <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide mt-3">Username</label>
                  <Input
                     type="text"
                     value={username}
                     onChange={e => setUsername(e.target.value)}
                     placeholder="root"
                  />

                  <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide mt-3">Auth Type</label>
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
                        <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide mt-3">Password</label>
                        <Input
                           type="password"
                           value={password}
                           onChange={e => setPassword(e.target.value)}
                           placeholder="••••••••"
                        />
                     </>
                  ) : (
                     <>
                        <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide mt-3">Key File Path</label>
                        <Input
                           type="text"
                           value={keyPath}
                           onChange={e => setKeyPath(e.target.value)}
                           placeholder="~/.ssh/id_rsa"
                        />
                     </>
                  )}

                  <Checkbox
                     className="mt-3.5"
                     checked={saveCredentials}
                     onCheckedChange={c => setSaveCredentials(!!c)}
                     label="Save credentials (stored locally with Base64 obfuscation)"
                  />
               </>
            ) : (
               <>
                  {/* 服务器信息 */}
                  <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">Server</label>
                  <div className="flex items-center gap-2.5 px-3 py-2.5 bg-bg-tertiary border border-border rounded-md mb-4">
                     <img className="text-[16px] text-text-secondary" src={serverIcon} width={15} height={15} alt="" />
                     <span>{selectedServer ? selectedServer.host : `${host}:${port}`}</span>
                  </div>

                  {/* 路径输入 + 自动补全 */}
                  <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide mt-3">Project Path (on server)</label>
                  <div className="relative w-full" ref={pathWrapperRef}>
                     <input
                        ref={pathInputRef}
                        type="text"
                        value={projectPath}
                        onChange={e => handlePathChange(e.target.value)}
                        onKeyDown={handlePathKeyDown}
                        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                        placeholder="/home/user/my-project"
                        className="w-full p-3 bg-bg-primary border border-border rounded-md text-text-primary text-[var(--font-size)] font-mono outline-none transition-border-color duration-200 focus:border-accent-blue"
                        autoComplete="off"
                        spellCheck={false}
                     />
                     {showSuggestions && (
                        <div className="absolute top-[calc(100%+2px)] left-0 right-0 bg-bg-secondary border border-accent-blue rounded-md shadow-[0_6px_20px_rgba(0,0,0,0.45)] z-[1100] max-h-[220px] overflow-y-auto">
                           {loadingSuggestions ? (
                              <div className="p-3 text-center text-xs text-text-muted">Loading...</div>
                           ) : (
                              suggestions.map((s, i) => {
                                 const parts = s.split("/");
                                 const name = parts[parts.length - 1] || s;
                                 const parent = parts.slice(0, -1).join("/") || "/";
                                 return (
                                    <div
                                       key={s}
                                       className={cn("flex items-center gap-2 py-[7px] px-3 cursor-pointer border-b border-white/[0.04] transition-[background-color] duration-100 last:border-b-none hover:bg-[rgba(97,175,239,0.15)]", i === activeSuggestion && "bg-[rgba(97,175,239,0.15)]")}
                                       onMouseDown={() => handleSelectSuggestion(s)}
                                    >
                                       <span className="text-[13px] shrink-0 text-text-muted">&#128193;</span>
                                       <span className="font-mono text-[13px] text-text-primary font-medium whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0">{name}</span>
                                       <span className="font-mono text-[11px] text-text-muted whitespace-nowrap shrink-0 ml-1">{parent}</span>
                                    </div>
                                 );
                              })
                           )}
                        </div>
                     )}
                  </div>

                  {/* 项目名预览 */}
                  {projectPath && projectPath !== "/" && (
                     <div className="flex items-center gap-2.5 px-3 py-2.5 bg-[rgba(97,175,239,0.08)] border border-[rgba(97,175,239,0.3)] rounded-md mt-3">
                        <span className="text-xs text-text-secondary shrink-0">Project name:</span>
                        <span className="font-mono text-[13px] text-accent-blue font-medium whitespace-nowrap overflow-hidden text-ellipsis">{previewName}</span>
                     </div>
                  )}

                  {/* Agent 选择 */}
                  <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide mt-3.5">Agent</label>
                  <div className="relative w-full mt-1" ref={agentDropdownRef}>
                     <button
                        className="flex items-center gap-2 p-1.5 px-3 bg-bg-tertiary border border-border rounded-md cursor-pointer text-text-primary text-sm transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue w-full"
                        onClick={() => setAgentDropdownOpen(v => !v)}
                     >
                        {(() => {
                           const agent = agents.find(a => a.id === selectedAgentId);
                           return agent ? (
                              <>
                                 <AgentIcon icon={agent.icon} />
                                 <span className="font-medium">{agent.name}</span>
                              </>
                           ) : (
                              <>
                                 <AgentIcon icon={null} fallback="&#9889;" />
                                 <span className="font-medium">None</span>
                              </>
                           );
                        })()}
                        <span className="text-xs text-text-secondary ml-auto">
                           {agentDropdownOpen ? "\u2212" : "+"}
                        </span>
                     </button>
                     {agentDropdownOpen && (
                        <div className="absolute top-full mt-1 bg-bg-secondary border border-border rounded-md shadow-lg z-[100] overflow-hidden left-0 right-0 min-w-[unset]">
                           <div
                              className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", !selectedAgentId && "bg-accent-blue text-white")}
                              onClick={() => { setSelectedAgentId(null); setAgentDropdownOpen(false); }}
                           >
                              <AgentIcon icon={null} fallback="&#9889;" />
                              <span className="font-medium">None</span>
                           </div>
                           {agents.filter(a => a.enabled).map(agent => (
                              <div
                                 key={agent.id}
                                 className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", selectedAgentId === agent.id && "bg-accent-blue text-white")}
                                 onClick={() => { setSelectedAgentId(agent.id); setAgentDropdownOpen(false); }}
                              >
                                 <AgentIcon icon={agent.icon} />
                                 <span className="font-medium">{agent.name}</span>
                                 <span className="ml-auto text-xs text-text-muted">{agent.command}</span>
                              </div>
                           ))}
                        </div>
                     )}
                  </div>

                  {/* IDE 选择 */}
                  <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide mt-3.5">IDE</label>
                  <div className="relative w-full mt-1" ref={ideDropdownRef}>
                     <button
                        className="flex items-center gap-2 p-1.5 px-3 bg-bg-tertiary border border-border rounded-md cursor-pointer text-text-primary text-sm transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue w-full"
                        onClick={() => setIdeDropdownOpen(v => !v)}
                     >
                        {(() => {
                           const preset = selectedIdeId && !selectedIdeId.startsWith("custom:")
                              ? IDE_PRESETS.find(i => i.id === selectedIdeId) : null;
                           if (preset) return (
                              <>
                                 <img src={getIdeIconSrc(preset.icon)} alt="" className="w-4 h-4" />
                                 <span className="font-medium">{preset.name}</span>
                              </>
                           );
                           if (selectedIdeId?.startsWith("custom:")) {
                              const ci = parseInt(selectedIdeId.replace("custom:", ""), 10);
                              const customIde = config.customIdes?.[ci];
                              return (
                                 <>
                                    <img src={getIdeIconSrc(null)} alt="" className="w-4 h-4" />
                                    <span className="font-medium">{customIde?.name ?? "Custom IDE"}</span>
                                 </>
                              );
                           }
                           return <span className="font-medium opacity-50">None (VSCode/Cursor/Zed)</span>;
                        })()}
                        <span className="text-xs text-text-secondary ml-auto">
                           {ideDropdownOpen ? "\u2212" : "+"}
                        </span>
                     </button>
                     {ideDropdownOpen && (
                        <div className="absolute top-full mt-1 bg-bg-secondary border border-border rounded-md shadow-lg z-[100] overflow-hidden left-0 right-0 min-w-[unset]">
                           <div
                              className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", !selectedIdeId && "bg-accent-blue text-white")}
                              onClick={() => { setSelectedIdeId(null); setIdeDropdownOpen(false); }}
                           >
                              <span className="font-medium">None</span>
                           </div>
                           {IDE_PRESETS.filter(p => ["vscode", "cursor", "zed"].includes(p.id)).map(preset => (
                              <div
                                 key={preset.id}
                                 className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", selectedIdeId === preset.id && "bg-accent-blue text-white")}
                                 onClick={() => { setSelectedIdeId(preset.id); setIdeDropdownOpen(false); }}
                              >
                                 <img src={getIdeIconSrc(preset.icon)} alt="" className="w-4 h-4" />
                                 <span className="font-medium">{preset.name}</span>
                                 <span className="ml-auto text-xs text-text-muted">{config.ideCommandOverrides?.[preset.id] ?? getIdeCommand(preset)}</span>
                              </div>
                           ))}
                        </div>
                     )}
                  </div>
               </>
            )}

            <DialogFooter>
               <Button variant="secondary" onClick={handleClose}>Cancel</Button>
               {step === "server-config" ? (
                  <Button
                     variant="primary"
                     onClick={handleConnect}
                     disabled={!host || !username || connecting}
                  >
                     {connecting ? "Connecting..." : "Connect"}
                  </Button>
               ) : (
                  <Button
                     variant="primary"
                     onClick={handleAddProject}
                     disabled={!projectName || !projectPath}
                  >
                     Add
                  </Button>
               )}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
