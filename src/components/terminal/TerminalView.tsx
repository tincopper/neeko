import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'
import { buildFontFamily } from '../../utils/terminal'
import { IS_MACOS } from '../../utils/platform'
import type { Project, AgentConfig } from '../../types'

interface TerminalViewProps {
  project: Project
  tabId?: string | null
  tabAgentId?: string | null
  fontSize?: number
  shell?: string
  fontFamily?: string
  suppressResizeRef?: React.MutableRefObject<boolean>
  agentCommandOverride?: string
  onTabStatusChange?: (status: "Idle" | "Running" | "Failed") => void
}

interface TerminalCache {
  term: Terminal
  fitAddon: FitAddon
  element: HTMLElement
  sessionId: string | null
  unlistenOutput: (() => void) | null
  unlistenClosed: (() => void) | null
}

// 全局缓存，切换项目时保留会话（key 可为 projectId 或 projectId+":side"）
export const terminalCache = new Map<string, TerminalCache>()

// 拖拽结束 flag：下一次 ResizeObserver 触发时需要同时做 PTY resize
export let pendingPtyResize = false
export function setPendingPtyResize(v: boolean) { pendingPtyResize = v }

// 存储每个 cacheKey 对应的"需要重建"回调，管道关闭时调用
export const terminalRebuildCallbacks = new Map<string, () => void>()

// 存储每个 cacheKey 对应的 DOM wrapper，供命令式切换 Agent 时使用
export const terminalWrapperRefs = new Map<string, HTMLDivElement>()

// 模块级：记录哪些 cacheKey 已经执行过 agent，生命周期与 terminalCache 绑定
// 不放在组件 state/ref 中，避免 unmount/remount 时丢失已执行标记
export const executedAgentKeys = new Set<string>()

function log(msg: string) {
  const ts = new Date().toLocaleTimeString()
  console.log(`[${ts}] [Terminal] ${msg}`)
}

export function destroyTerminalCache(cacheKey: string) {
  const cache = terminalCache.get(cacheKey)
  if (!cache) return
  cache.unlistenOutput?.()
  cache.unlistenClosed?.()
  cache.term.dispose()
  terminalCache.delete(cacheKey)
  executedAgentKeys.delete(cacheKey)
  log(`Cache destroyed for ${cacheKey}`)
}

/** 手动刷新终端：关闭后端 PTY + 销毁前端缓存 + 触发重建 */
export function refreshTerminal(projectId: string) {
  // Resolve actual cache key: bare projectId or tab-scoped `${projectId}:*`
  let resolvedKey = projectId
  if (!terminalCache.has(projectId)) {
    for (const key of terminalCache.keys()) {
      if (key.startsWith(projectId + ":")) { resolvedKey = key; break }
    }
  }
  const cache = terminalCache.get(resolvedKey)
  if (!cache) return
  const { sessionId, unlistenOutput, unlistenClosed } = cache
  // 取消所有事件监听，避免竞态下旧事件触发双重重建
  unlistenOutput?.()
  unlistenClosed?.()
  // 关闭后端 PTY
  if (sessionId) {
    invoke('close_terminal_session', { sessionId }).catch(() => {})
  }
  // 销毁前端 xterm 缓存
  destroyTerminalCache(resolvedKey)
  // 触发重建
  terminalRebuildCallbacks.get(resolvedKey)?.()
}

function sendToTerminal(projectId: string, text: string) {
  // Try bare projectId first, then fall back to any tab-scoped key `${projectId}:*`
  let cache = terminalCache.get(projectId)
  if (!cache) {
    for (const [key, c] of terminalCache.entries()) {
      if (key.startsWith(projectId + ":")) { cache = c; break }
    }
  }
  if (!cache?.sessionId) {
    log(`sendToTerminal: no session for ${projectId}`)
    return
  }
  const bytes = Array.from(new TextEncoder().encode(text))
  emit(`terminal-input-${cache.sessionId}`, bytes).catch((err) => {
    log(`sendToTerminal error: ${err}`)
  })
}

// 导出给外部调用（App.tsx 的 AgentSelector 回调）
export function launchAgentInTerminal(
  projectId: string,
  command: string,
  args: string[],
) {
  const cmdStr = [command, ...args].join(' ')
  sendToTerminal(projectId, '\x03')
  setTimeout(() => sendToTerminal(projectId, cmdStr + '\r'), 50)
}

/**
 * 即时切换 Agent：立即创建新 PTY + 启动新 Agent，后台异步关闭旧 PTY。
 * 替代 launchAgentInTerminal，消除"等旧 Agent 退出"的等待。
 */
export async function switchAgentInTerminal(
  projectId: string,
  projectPath: string,
  projectName: string,
  agentId: string,
  fontSize: number,
  shell: string,
  fontFamily: string,
  agentCommandOverrides?: Record<string, string>,
) {
  // Resolve actual cache key: bare projectId or tab-scoped `${projectId}:*`
  let resolvedKey = projectId
  if (!terminalWrapperRefs.has(projectId)) {
    for (const key of terminalWrapperRefs.keys()) {
      if (key.startsWith(projectId + ":")) { resolvedKey = key; break }
    }
  }

  const wrapper = terminalWrapperRefs.get(resolvedKey)
  if (!wrapper) {
    // wrapper 未就绪（组件未挂载），回退到旧路径
    const agent = await invoke<AgentConfig>('get_agent', { agentId }).catch(() => null)
    if (agent) {
      const cmd = agentCommandOverrides?.[agent.id] ?? agent.command
      launchAgentInTerminal(projectId, cmd, agent.args)
    }
    return
  }

  // 1. 摘除旧缓存的事件监听，防止 terminal-closed 触发意外重建
  const oldCache = terminalCache.get(resolvedKey)
  if (oldCache) {
    oldCache.unlistenOutput?.()
    oldCache.unlistenClosed?.()
  }

  // 2. 从 Map 删除旧条目（槽位空出），新建时会重新填入同一 key
  terminalCache.delete(resolvedKey)

  // 3. 清空 wrapper 中旧的 xterm DOM 节点
  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild)
  }

  // 4. 创建新终端（复用 createTerminalForProject，直接携带 agentId）
  try {
    const newCache = await createTerminalForProject(
      resolvedKey,
      projectPath,
      projectName,
      agentId,
      fontSize,
      wrapper,
      shell,
      fontFamily,
      undefined,
      agentCommandOverrides,
    )
    requestAnimationFrame(() => {
      newCache.fitAddon.fit()
      if (newCache.sessionId) {
        invoke('resize_terminal', {
          sessionId: newCache.sessionId,
          cols: newCache.term.cols,
          rows: newCache.term.rows,
        }).catch(() => {})
      }
      newCache.term.focus()
    })
    // 5. 新终端创建成功后再关闭旧 PTY（不阻塞 UI）
    if (oldCache?.sessionId) {
      invoke('close_terminal_session', { sessionId: oldCache.sessionId }).catch(() => {})
    }
    oldCache?.term.dispose()
  } catch (err) {
    log(`switchAgentInTerminal: createTerminalForProject failed: ${err}`)
    // 创建失败时触发重建，避免用户看到空白终端
    terminalRebuildCallbacks.get(projectId)?.()
  }
}

export async function createTerminalForProject(
  projectId: string, // cache key（可为 "uuid" 或 "uuid:side"）
  _projectPath: string,
  projectName: string,
  _selectedAgentId: string | null, // 保留参数以兼容旧代码，但不再使用
  fontSize: number,
  wrapper: HTMLElement,
  shell: string,
  fontFamily: string,
  backendProjectId?: string, // 后端查找项目用的真实 project ID，默认同 projectId
  _agentCommandOverrides?: Record<string, string>, // 保留参数以兼容旧代码，但不再使用
): Promise<TerminalCache> {
  log(`Creating new terminal for project ${projectName}`)

  const element = document.createElement('div')
  element.style.width = '100%'
  element.style.height = '100%'

  const cssVar = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim()

  const term = new Terminal({
    cursorBlink: true,
    fontSize: fontSize,
    fontFamily: buildFontFamily(fontFamily),
    theme: {
      background: cssVar('--bg-primary') || '#000000',
      foreground: cssVar('--text-primary') || '#ededed',
      cursor: cssVar('--accent-blue') || '#ffffff',
      selectionBackground: cssVar('--terminal-selection') || '#333333',
      selectionForeground: cssVar('--text-primary') || '#ededed',
      black: '#000000',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    },
    scrollback: 10000,
    overviewRuler: { width: 0 },
    allowProposedApi: true,
  })

  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)

  // Unicode11：正确处理中文等宽字符的宽度计算
  const unicode11 = new Unicode11Addon()
  term.loadAddon(unicode11)
  term.unicode.activeVersion = '11'

  // 先挂载到 DOM，再 open，这样 fitAddon.fit() 能拿到真实容器尺寸
  wrapper.appendChild(element)
  term.open(element)
  fitAddon.fit()
  const initCols = term.cols
  const initRows = term.rows
  log(`Initial size: ${initCols}x${initRows}`)

  const cache: TerminalCache = {
    term,
    fitAddon,
    element,
    sessionId: null,
    unlistenOutput: null,
    unlistenClosed: null,
  }

  terminalCache.set(projectId, cache)
  term.write('\x1b[33m[Terminal] Connecting...\x1b[0m\r\n')

  try {
    const session = await invoke<{ id: string; pid: number | null }>(
      'create_terminal_session',
      {
        projectId: backendProjectId ?? projectId,
        cols: initCols,
        rows: initRows,
        shell: shell || null,
        workingDir: _projectPath || null,
      },
    )
    const sid = session.id
    cache.sessionId = sid
    log(`Session created: ${sid}, PID: ${session.pid}`)
    term.write(
      `\x1b[32m[Terminal] Connected (PID: ${session.pid})\x1b[0m\r\n\r\n`,
    )

    const unlistenOutput = await listen<number[]>(
      `terminal-output-${sid}`,
      (event) => {
        const bytes = new Uint8Array(event.payload)
        // 跳过 DEL (0x7f) 字符，避免 xterm.js 解析错误
        // PTY 处理删除逻辑，过滤不影响删除效果
        const filtered = bytes.filter((b) => b !== 0x7f)
        if (filtered.length > 0) {
          term.write(new Uint8Array(filtered))
        }
      },
    )
    cache.unlistenOutput = unlistenOutput

    // 监听管道关闭事件：清理 cache 并立即触发重建
    const unlistenClosed = await listen<null>(
      `terminal-closed-${sid}`,
      async () => {
        log(`Session ${sid} closed by backend`)
        unlistenClosed()
        destroyTerminalCache(projectId)
        terminalRebuildCallbacks.get(projectId)?.()
      },
    )
    cache.unlistenClosed = unlistenClosed

    // ── IME 输入处理 ──────────────────────────────────────────────────────
    // 问题：Linux 下 keydown(229) 先于 compositionstart 触发，xterm.js 的
    // onData 在 compositionstart 之前就会被调用，导致中间文本被发送到 PTY，
    // 同时 PTY 回显与前端显示叠加，产生「我是我」式重复输入。
    //
    // 解决方案（Unix）：
    //   1. Rust 端已禁用 PTY 回显（ECHO），由前端负责显示用户输入
    //   2. keydown(229) 时立即设 isComposing=true，阻断 onData 提前发送
    //   3. compositionend 时手动发送最终字符到 PTY，并在前端显示
    //   4. onData 用 compositionPendingText 过滤 compositionend 后的重复触发
    //
    // Windows：PTY 回显由系统负责，onData 正常发送即可（IME 行为不同）
    let isComposing = false
    let compositionPendingText = ''

    const sendInput = (text: string) => {
      // Forward all input to PTY, let shell handle line editing
      // This fixes Tab completion, arrow keys, and backspace on Linux
      const bytes = Array.from(new TextEncoder().encode(text))
      emit(`terminal-input-${sid}`, bytes).catch((err) => {
        log(`Input emit error: ${err}`)
      })
    }

    const textarea = term.textarea
    if (textarea) {
      // 将 helper textarea 定位到光标位置，使 IME 候选窗口出现在正确位置
      // 修复 xterm.js 6.x 中 textarea 位置未同步的问题（7.x 已修复：PR #5759）
      const syncTextareaToCursor = () => {
        // 在 xterm 容器内查找光标元素
        const cursorEl = element.querySelector('.xterm-cursor')
        if (!cursorEl) return
        const cursorRect = cursorEl.getBoundingClientRect()
        const containerRect = element.getBoundingClientRect()
        // 计算相对于 xterm 容器的偏移
        const top = cursorRect.top - containerRect.top
        const left = cursorRect.left - containerRect.left
        textarea.style.top = `${top}px`
        textarea.style.left = `${left}px`
      }

      // keyCode 229：IME 组合开始的信号，在 compositionstart 之前触发
      // Linux 下必须在此处提前设置 isComposing，否则 onData 会先一步发出
      // macOS：e.isComposing 是 W3C 标准属性，比 keyCode 229 更可靠
      textarea.addEventListener('keydown', (e: KeyboardEvent) => {
        if ((e.isComposing || e.keyCode === 229) && !isComposing) {
          isComposing = true
          compositionPendingText = ''
          // 在 IME 开始前同步 textarea 位置到光标
          syncTextareaToCursor()
        }
      })
      textarea.addEventListener('compositionstart', () => {
        isComposing = true
        compositionPendingText = ''
        // 确保 compositionstart 时 textarea 也在光标位置
        syncTextareaToCursor()
      })
      textarea.addEventListener('compositionend', (e: CompositionEvent) => {
        const committed = e.data || ''
        if (committed) {
          compositionPendingText = committed
          sendInput(committed)
          // macOS 上事件循环延迟更大，需要更长的超时防止误发
          const resetDelay = IS_MACOS ? 150 : 50
          setTimeout(() => {
            isComposing = false
            compositionPendingText = ''
          }, resetDelay)
        } else {
          isComposing = false
          compositionPendingText = ''
        }
      })
    }

    term.onData((data) => {
      // composing 期间阻断
      if (isComposing) return
      // compositionend 后 onData 可能携带相同文本，跳过避免重复发送
      if (compositionPendingText && data === compositionPendingText) {
        compositionPendingText = ''
        return
      }
      sendInput(data)
    })
    // 注意：不再自动执行 Agent 命令
    // 点击 "+" 只打开空白终端，点击 Agent 按钮才会执行命令
  } catch (err) {
    log(`ERROR: ${err}`)
    term.write(`\x1b[31m[Terminal] Connection failed: ${err}\x1b[0m\r\n`)
  }

  return cache
}

function TerminalView({
  project,
  tabId,
  tabAgentId,
  fontSize = 14,
  shell = '',
  fontFamily = '',
  suppressResizeRef,
  agentCommandOverride,
  onTabStatusChange,
}: TerminalViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const currentCacheKeyRef = useRef<string | null>(null)
  // 管道关闭时递增，触发 useEffect 重建终端
  const [rebuildCount, setRebuildCount] = useState(0)
  // executedAgentsRef 已移至模块级 executedAgentKeys，此处仅保留引用

  // 计算 cacheKey：如果有 tabId，使用 `${project.id}:${tabId}`，否则使用 project.id
  const cacheKey = tabId ? `${project.id}:${tabId}` : project.id

  // fontSize / fontFamily 变化时更新已有终端实例
  useEffect(() => {
    const cache = terminalCache.get(cacheKey)
    if (cache) {
      cache.term.options.fontSize = fontSize
      cache.term.options.fontFamily = buildFontFamily(fontFamily)
      cache.fitAddon.fit()
    }
  }, [fontSize, fontFamily, cacheKey])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    currentCacheKeyRef.current = cacheKey

    // 注册重建回调：管道关闭时，backend 会清理 session 并发 terminal-closed 事件，
    // createTerminalForProject 监听到后调用此 callback 触发 rebuildCount 递增，
    // 进而使当前 useEffect 重新运行，此时 cache 已被清除，会创建新终端
    terminalRebuildCallbacks.set(cacheKey, () => {
      if (currentCacheKeyRef.current === cacheKey) {
        log(`Rebuild triggered for ${cacheKey}`)
        setRebuildCount((c) => c + 1)
      }
    })
    // 注册 wrapper ref，供命令式 switchAgentInTerminal 使用
    terminalWrapperRefs.set(cacheKey, wrapper)

    const attach = (cache: TerminalCache) => {
      if (!wrapper.contains(cache.element)) {
        wrapper.appendChild(cache.element)
      }
      requestAnimationFrame(() => {
        if (currentCacheKeyRef.current !== cacheKey) return
        cache.fitAddon.fit()
        if (cache.sessionId) {
          invoke('resize_terminal', {
            sessionId: cache.sessionId,
            cols: cache.term.cols,
            rows: cache.term.rows,
          }).catch(() => {})
        }
        cache.term.focus()
      })
    }

    const detachAll = () => {
      while (wrapper.firstChild) {
        wrapper.removeChild(wrapper.firstChild)
      }
    }

    detachAll()

    if (terminalCache.has(cacheKey)) {
      log(`Reattaching existing terminal for ${project.name} (${cacheKey})`)
      attach(terminalCache.get(cacheKey)!)
    } else {
      // 传入 wrapper，让函数内先挂载 element 再 fit，确保初始尺寸正确
      // 注意：创建时不传递 agentId，不自动执行命令
      createTerminalForProject(
        cacheKey,
        project.path,
        project.name,
        null, // 创建时不自动执行 agent
        fontSize,
        wrapper,
        shell,
        fontFamily,
        project.id, // 后端查找项目用的真实 project ID
        undefined,
      ).then((cache) => {
        if (currentCacheKeyRef.current !== cacheKey) return
        // element 已在函数内挂载，只需 focus 并同步后端尺寸
        requestAnimationFrame(() => {
          if (currentCacheKeyRef.current !== cacheKey) return
          cache.fitAddon.fit()
          if (cache.sessionId) {
            invoke('resize_terminal', {
              sessionId: cache.sessionId,
              cols: cache.term.cols,
              rows: cache.term.rows,
            }).catch(() => {})
          }
          cache.term.focus()
        })
        
        // 终端创建完成后，如果 tabAgentId 存在且此 cacheKey 未执行过 agent，则执行
        if (tabAgentId && !executedAgentKeys.has(cacheKey) && cache.sessionId) {
          log(`Executing agent after terminal creation: ${tabAgentId}`);
          (async () => {
            try {
              const agent = await invoke<AgentConfig>('get_agent', { agentId: tabAgentId });
              const cmd = agentCommandOverride ?? agent.command;
              const cmdStr = cmd + (agent.args.length ? ' ' + agent.args.join(' ') : '') + '\r';
              
              const bytes = Array.from(new TextEncoder().encode(cmdStr));
              emit(`terminal-input-${cache.sessionId}`, bytes).catch((err) => {
                log(`Execute agent error: ${err}`);
              });
              
              executedAgentKeys.add(cacheKey);
              log(`Executed agent after creation: ${cmd}`);
              
              // 更新 Tab 状态为 Running
              onTabStatusChange?.("Running");
            } catch (err) {
              log(`Failed to execute agent after creation: ${err}`);
            }
          })();
        }
      })
    }

    const handleResize = () => {
      if (suppressResizeRef?.current) return
      const cache = terminalCache.get(cacheKey)
      if (!cache) return
      cache.fitAddon.fit()
      if (cache.sessionId) {
        invoke('resize_terminal', {
          sessionId: cache.sessionId,
          cols: cache.term.cols,
          rows: cache.term.rows,
        }).catch(() => {})
      }
    }
    window.addEventListener('resize', handleResize)

    // 监听容器尺寸变化：平时只做 fit（纯前端重排）
    // 拖拽结束后第一次触发时额外做 PTY resize（pendingPtyResize flag）
    let resizeRafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null;
        if (suppressResizeRef?.current) return
        const c = terminalCache.get(cacheKey)
        if (!c) return
        c.fitAddon.fit()
        if (pendingPtyResize && c.sessionId) {
          setPendingPtyResize(false)
          invoke('resize_terminal', {
            sessionId: c.sessionId,
            cols: c.term.cols,
            rows: c.term.rows,
          }).catch(() => {})
        }
      });
    });
    ro.observe(wrapper)

    return () => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      ro.disconnect()
      window.removeEventListener('resize', handleResize)
      detachAll()
      terminalRebuildCallbacks.delete(cacheKey)
      terminalWrapperRefs.delete(cacheKey)
    }
  }, [cacheKey, project.id, project.path, project.name, rebuildCount, fontSize, shell, fontFamily, agentCommandOverride, tabAgentId, onTabStatusChange])

  // 监听 tabAgentId 变化，执行 Agent 命令
  useEffect(() => {
    // 如果没有 agentId，或者此 cacheKey 已执行过 agent，则不执行
    if (!tabAgentId || executedAgentKeys.has(cacheKey)) return;

    const cache = terminalCache.get(cacheKey);
    if (!cache?.sessionId) return;

    // 执行 Agent 命令
    const executeAgent = async () => {
      try {
        const agent = await invoke<AgentConfig>('get_agent', { agentId: tabAgentId });
        const cmd = agentCommandOverride ?? agent.command;
        const cmdStr = cmd + (agent.args.length ? ' ' + agent.args.join(' ') : '') + '\r';

        // 发送命令到终端
        const bytes = Array.from(new TextEncoder().encode(cmdStr));
        emit(`terminal-input-${cache.sessionId}`, bytes).catch((err) => {
          log(`Execute agent error: ${err}`);
        });

        executedAgentKeys.add(cacheKey);
        log(`Executed agent: ${cmd}`);
        
        // 更新 Tab 状态为 Running
        onTabStatusChange?.("Running");
      } catch (err) {
        log(`Failed to execute agent: ${err}`);
      }
    };

    executeAgent();
  }, [tabAgentId, cacheKey, agentCommandOverride]);

  return (
    <div className='flex-1 flex flex-col overflow-hidden min-w-0'>
      <div className='terminal-wrapper flex-1 p-0 bg-bg-primary overflow-hidden min-w-0 min-h-0' ref={wrapperRef} />
    </div>
  )
}

export default React.memo(TerminalView, (prev, next) =>
  prev.project.id === next.project.id &&
  prev.tabId === next.tabId &&
  prev.tabAgentId === next.tabAgentId &&
  prev.fontSize === next.fontSize &&
  prev.shell === next.shell &&
  prev.fontFamily === next.fontFamily &&
  prev.agentCommandOverride === next.agentCommandOverride &&
  prev.onTabStatusChange === next.onTabStatusChange
)
