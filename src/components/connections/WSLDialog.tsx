import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WSLProject, WSLEntrySession } from "../../types";
import AgentIcon from "../layout/AgentIcon";
import { useAppContext } from "../../contexts";
import { getDistroIcon } from "../../utils/distros";
import { IDE_PRESETS, getIdeCommand, getIdeIconSrc } from "../../utils/idePresets";
import { randomAvatarColor } from "../../utils/projectAvatar";
import { cn } from "../../utils/cn";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Button } from "@/ui/button";

interface WSLDialogProps {
   isOpen: boolean;
   onClose: () => void;
   onAdd: (entry: WSLEntrySession) => void;
   existingEntries: WSLEntrySession[];
   /** 传入时直接跳到 select-path 步骤并预选该发行版 */
   selectedEntryId?: string;
}

export function WSLDialog({ isOpen, onClose, onAdd, existingEntries, selectedEntryId }: WSLDialogProps) {
   const { agents, config } = useAppContext();
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
   const [selectedIdeId, setSelectedIdeId] = useState<string | null>(null);
   const [ideDropdownOpen, setIdeDropdownOpen] = useState(false);
   const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
   const fetchSeq = useRef(0); // 用于丢弃过期请求结果
   const inputRef = useRef<HTMLInputElement>(null);
   const wrapperRef = useRef<HTMLDivElement>(null); // 用于点击外侧关闭
   const agentDropdownRef = useRef<HTMLDivElement>(null);
   const ideDropdownRef = useRef<HTMLDivElement>(null);

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

      const newProject: WSLProject = {
         id: crypto.randomUUID(),
         name: projectName,
         path: finalPath,
         distro: selectedDistro,
         entry_id: existingEntry?.id || crypto.randomUUID(),
         selected_agent: selectedAgentId,
         selected_ide: selectedIdeCommand,
         avatar_color: randomAvatarColor(),
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

   const previewName = inputPath.replace(/\/$/, "").split("/").filter(Boolean).pop() || inputPath;
   const selectedAgent = agents.find(a => a.id === selectedAgentId);

   return (
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
         <DialogContent className="max-w-[560px]">
            <DialogHeader>
               <DialogTitle>{step === "select-distro" ? "Select WSL Distro" : "Add WSL Project"}</DialogTitle>
            </DialogHeader>

            {error && <p className="text-accent-red bg-accent-red/10 border border-accent-red rounded-md p-3 mb-4 text-[13px]">{error}</p>}

            {step === "select-distro" ? (
               <>
                  {loadingDistros ? (
                     <p className="text-text-secondary text-center py-5">Loading WSL distros...</p>
                  ) : distros.length === 0 ? (
                     <p className="text-text-secondary text-center py-5">No WSL distros found. Please install a WSL distro first.</p>
                  ) : (
                     <div className="flex flex-col gap-1 mb-4 max-h-[300px] overflow-y-auto">
                        {distros.map(distro => (
                           <div
                              key={distro}
                              className="flex items-center gap-2.5 py-3 px-3.5 rounded-md cursor-pointer border border-border bg-bg-tertiary transition-all duration-150 hover:bg-bg-hover hover:border-accent-blue"
                              onClick={() => handleSelectDistro(distro)}
                           >
                              <img className="text-[18px] text-text-secondary" src={getDistroIcon(distro)} width={15} height={15} alt="" />
                              <span className="text-sm text-text-primary">{distro}</span>
                              <span className="ml-auto text-text-muted text-lg">›</span>
                           </div>
                        ))}
                     </div>
                  )}
               </>
            ) : (
               <>
                  <div className="flex items-center gap-2.5 px-3 py-2.5 bg-bg-tertiary rounded-md mb-4">
                     <img className="text-[18px] text-text-secondary" src={getDistroIcon(selectedDistro)} width={15} height={15} alt="" />
                     <span className="text-sm font-medium text-text-primary">{selectedDistro}</span>
                  </div>

                  <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide">Project Path</label>
                  <div className="relative w-full" ref={wrapperRef}>
                     <Input
                        ref={inputRef}
                        value={inputPath}
                        onChange={e => handlePathChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                        placeholder="/home/user/my-project"
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

                  {inputPath && inputPath !== "/" && (
                     <div className="flex items-center gap-2.5 px-3 py-2.5 bg-[rgba(97,175,239,0.08)] border border-[rgba(97,175,239,0.3)] rounded-md mt-3">
                        <span className="text-xs text-text-secondary shrink-0">Project name:</span>
                        <span className="font-mono text-[13px] text-accent-blue font-medium whitespace-nowrap overflow-hidden text-ellipsis">{previewName}</span>
                     </div>
                  )}

                  {/* Agent 选择 */}
                  <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide" style={{ marginTop: 14 }}>Agent</label>
                  <div className="relative w-full mt-1" ref={agentDropdownRef}>
                     <button
                        className="flex items-center gap-2 p-1.5 px-3 bg-bg-tertiary border border-border rounded-md cursor-pointer text-text-primary text-sm transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue w-full"
                        onClick={() => setAgentDropdownOpen(v => !v)}
                     >
                        {selectedAgent ? (
                           <>
                              <AgentIcon icon={selectedAgent.icon} />
                              <span className="font-medium">{selectedAgent.name}</span>
                           </>
                        ) : (
                           <>
                              <AgentIcon icon={null} fallback="&#9889;" />
                              <span className="font-medium">None</span>
                           </>
                        )}
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
                  <label className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wide" style={{ marginTop: 14 }}>IDE</label>
                  <div className="relative w-full mt-1" ref={ideDropdownRef}>
                     <button
                        className="flex items-center gap-2 p-1.5 px-3 bg-bg-tertiary border border-border rounded-md cursor-pointer text-text-primary text-sm transition-all duration-200 hover:bg-bg-hover hover:border-accent-blue w-full"
                        onClick={() => setIdeDropdownOpen(v => !v)}
                     >
                        {(() => {
                           const selectedPreset = selectedIdeId && !selectedIdeId.startsWith("custom:")
                              ? IDE_PRESETS.find(i => i.id === selectedIdeId) : null;
                           if (selectedPreset) {
                              return (
                                 <>
                                    <img src={getIdeIconSrc(selectedPreset.icon)} alt="" style={{ width: 16, height: 16 }} />
                                    <span className="font-medium">{selectedPreset.name}</span>
                                 </>
                              );
                           }
                           if (selectedIdeId?.startsWith("custom:")) {
                              const idx = Number(selectedIdeId.replace("custom:", ""));
                              const customIde = config.customIdes?.[idx];
                              return (
                                 <>
                                    <img src={getIdeIconSrc(null)} alt="" style={{ width: 16, height: 16 }} />
                                    <span className="font-medium">{customIde?.name ?? "Custom IDE"}</span>
                                 </>
                              );
                           }
                           return <><span className="font-medium opacity-50">None (VSCode/Cursor/Zed)</span></>;
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
                           {/* 支持 VSCode、Cursor 和 Zed */}
                           {IDE_PRESETS.filter(p => ["vscode", "cursor", "zed"].includes(p.id)).map(preset => (
                              <div
                                 key={preset.id}
                                 className={cn("flex items-center gap-2.5 p-2.5 px-3 cursor-pointer transition-colors duration-150 hover:bg-bg-hover", selectedIdeId === preset.id && "bg-accent-blue text-white")}
                                 onClick={() => { setSelectedIdeId(preset.id); setIdeDropdownOpen(false); }}
                              >
                                 <img src={getIdeIconSrc(preset.icon)} alt="" style={{ width: 16, height: 16 }} />
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
               {step === "select-path" && (
                  <Button
                     variant="primary"
                     onClick={handleConfirmPath}
                     disabled={!inputPath || inputPath === "/"}
                  >
                     Add
                  </Button>
               )}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
