# Neeko Agent Chat 架构改进方案

> 基于 Synara 多 Provider 架构的第一性原理对比分析 · 改进路线图

---

## 一、背景与目标

### 1.1 现状

Neenko 当前 Agent Chat 支持 8 种 Agent（opencode、claude-code、gemini、codex、qoder、codebuddy、deepseek-harness、custom），但存在关键能力缺口：
- 单会话单 Provider，**无统一 Provider 抽象**
- 无会话持久化与恢复
- 无乐观更新与发送状态机
- 审批仅 2 级（Approve/Decline），无 Queue/Steer
- 前端状态管理原始（useState 散乱），无事件归约幂等性

### 1.2 目标

对标 Synara 的 **9 Provider 统一接入** 能力，结合 Neeko 桌面原生（Tauri + Rust）的约束，输出可落地的改进方案。核心设计原则：

1. **Provider 用最自然的方式保持多轮**（Neeko 已有进程/stdio 基础）
2. **Client 层不关心底层 Provider 差异**，只消费统一事件流
3. **新增 Provider = 新 Adapter 实现**，协议与页面不动（OCP）
4. **桌面原生优先**：SQLite 持久化替代服务端，Tauri IPC 替代 WebSocket

---

## 二、第一性原理对比回顾

| 原理 | Synara | Neeko（现状） | 差距 |
|------|--------|--------------|------|
| P1 协议异构 | Registry + Capability 声明 | Enum match 分派 | 中 |
| P2 会话连续 | 三层保持 + resumeCursor | 单层内存 Map，无持久化 | **大** |
| P3 事件流 | 统一投影 + 幂等归约 | 直接枚举，无投影层 | 中 |
| P4 状态一致 | 乐观更新 + 超时保护 | 无 | **大** |
| P5 可扩展 | Registry 去耦 | Enum + 编译期穷举 | 小 |
| P6 用户控制 | 4 级审批 + Queue/Steer | 2 级审批，无队列 | **大** |
| P7 传输无关 | 完全中立 | ACP 耦合 | 小 |

---

## 三、目标架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Neeko Desktop (Tauri + React)                  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                     AgentChatTabView                           │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │  │
│  │  │ Composer │  │Transcript│  │ WorkedCard│  │ ApprovalPanel│  │  │
│  │  └────┬─────┘  └────┬─────┘  └──────────┘  └──────────────┘  │  │
│  │       │              │                                          │  │
│  │  ┌────┴──────────────┴─────────────────────────────────────┐   │  │
│  │  │          Event Reducer (幂等 + sequence number)          │   │  │
│  │  └────────────────────────┬───────────────────────────────┘   │  │
│  └───────────────────────────┼───────────────────────────────────┘  │
│                              │ Tauri emit / invoke                  │
│  ┌───────────────────────────┼───────────────────────────────────┐  │
│  │  Rust Backend             ▼                                   │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │           AgentChatOrchestrator                         │  │  │
│  │  │  ┌──────────────────────────────────────────────────┐  │  │  │
│  │  │  │  ProviderRegistry                                 │  │  │  │
│  │  │  │   ├─ OpencodeAdapter  (CLI subprocess)            │  │  │  │
│  │  │  │   ├─ ClaudeCodeAdapter (CLI subprocess)           │  │  │  │
│  │  │  │   ├─ GeminiAdapter    (CLI subprocess)            │  │  │  │
│  │  │  │   ├─ CodexAdapter     (JSON-RPC stdio)            │  │  │  │
│  │  │  │   ├─ QoderAdapter     (CLI subprocess)            │  │  │  │
│  │  │  │   ├─ CodebuddyAdapter (CLI subprocess)            │  │  │  │
│  │  │  │   ├─ DeepSeekAdapter  (JSON-Lines stdio)          │  │  │  │
│  │  │  │   ├─ AcpAdapter       (ACP JSON-RPC, 通用)        │  │  │  │
│  │  │  │   └─ CustomAdapter    (user-defined)              │  │  │  │
│  │  │  └──────────────────────────────────────────────────┘  │  │  │
│  │  │  ┌────────────────────┐  ┌──────────────────────────┐  │  │  │
│  │  │  │ SessionStore       │  │ CapabilityRegistry        │  │  │  │
│  │  │  │ (SQLite 持久化)     │  │ (Provider 能力声明)       │  │  │  │
│  │  │  └────────────────────┘  └──────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 四、改进方案（分 5 个 Phase）

### Phase 1：会话持久化与恢复（P2 — 最大缺口）

**目标**：应用崩溃/重启后恢复会话，消息不丢失。

#### 1.1 数据结构

```rust
// src-tauri/src/agent/chat/session_store.rs

/// 会话恢复游标 — 断线/重启后恢复会话的关键
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResumeCursor {
    pub session_id: String,
    pub agent_kind: AgentKind,
    pub agent_id: String,
    /// Provider 内部的 thread/session 标识
    /// Codex → providerThreadId, Claude → sessionId, ACP → conversationId
    pub provider_thread_id: Option<String>,
    pub cwd: String,
    pub model: String,
    pub runtime_mode: RuntimeMode,
    /// 已完成的 turn 数量，用于 rollback
    pub turn_count: u32,
    pub last_activity: DateTime<Utc>,
    /// 会话状态
    pub status: SessionStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum SessionStatus {
    Ready,
    Running,
    AwaitingApproval,
    Closed,
}

/// 会话事件持久化 — 用于恢复后重放
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PersistedEvent {
    pub seq: u64,
    pub session_id: String,
    pub event: StreamEvent,
    pub created_at: DateTime<Utc>,
}
```

#### 1.2 持久化存储

```rust
pub trait SessionStore: Send + Sync {
    /// 保存/更新 resume cursor
    fn save_cursor(&self, cursor: &ResumeCursor) -> Result<()>;
    /// 加载指定会话的 cursor
    fn load_cursor(&self, session_id: &str) -> Option<ResumeCursor>;
    /// 列出所有活跃会话（用于启动时恢复）
    fn list_active(&self) -> Vec<ResumeCursor>;
    /// 追加事件（用于消息恢复）
    fn append_event(&self, session_id: &str, event: &PersistedEvent) -> Result<()>;
    /// 加载会话的所有事件
    fn load_events(&self, session_id: &str) -> Vec<PersistedEvent>;
    /// 更新 provider thread id（会话建立后回填）
    fn update_thread_id(&self, session_id: &str, thread_id: &str) <REDACTED> 
    /// 关闭会话
    fn close_session(&self, session_id: &str) <REDACTED> 
}

/// SQLite 实现 — 复用 Neeko 已有的 rusqlite 依赖
pub struct SqliteSessionStore {
    pool: SqlitePool,
}
```

存储位置：`~/.neeko/agent_sessions.db`（与现有 `sessions.json` / `config.json` 同目录）。

#### 1.3 恢复流程

```
应用启动
  ├─ SessionStore.list_active() → 恢复所有未完成会话
  │   └─ 对每个 cursor：
  │       ├─ 重新创建 Adapter（spawn subprocess / connect）
  │       ├─ 调用 provider-specific resume：
  │       │   ├─ Codex: thread/resume { threadId }
  │       │   ├─ Claude: query({ resume: sessionId })
  │       │   └─ ACP: loadSession(sessionId)
  │       ├─ SessionStore.load_events(session_id) → 重放消息
  │       └─ 重建 bridge，继续监听
  │
  └─ 用户切换到某会话 → 直接显示已恢复的 transcript
```

#### 1.4 关键实现点

| Provider | Resume 机制 | 实现 |
|----------|------------|------|
| Codex | `thread/resume` JSON-RPC | 已有 JSON-RPC 通道，加 resume 方法 |
| Claude-code | CLI 参数 `--resume <sessionId>` | 子进程启动时传入 |
| ACP (DeepSeek/Zed) | `loadSession` | 已有 ACP 适配器 |
| 其他 CLI | 无原生支持 → 降级为重开会话 | 提示用户 |

---

### Phase 2：多 Provider 适配层重构（P1 + P5）

**目标**：从 Enum match 分派转向 Registry + Capability 声明，新增 Provider 不改核心代码。

#### 2.1 ProviderRegistry（替代 adapter_for 的 match）

```rust
// src-tauri/src/agent/chat/provider_registry.rs

/// Provider 能力声明 — UI 据此动态启用/禁用功能
#[derive(Clone, Debug, Default)]
pub struct ProviderCapabilities {
    /// 会话内模型切换: 即时 / 需重启 / 不支持
    pub session_model_switch: ModelSwitchMode,
    /// 是否支持 mid-turn steering
    pub supports_turn_steering: bool,
    /// 是否支持多轮（false = 每次 sendTurn 都是新会话）
    pub supports_multi_turn: bool,
    /// 是否原生支持审批（false = 需前端模拟）
    pub supports_native_approval: bool,
    /// 是否支持会话恢复
    pub supports_resume: bool,
    /// 是否支持实时 diff patch
    pub supports_live_diff: bool,
    /// 最大上下文窗口（token）
    pub context_window: Option<u32>,
}

pub enum ModelSwitchMode {
    InSession,      // 切换立即生效
    RestartSession, // 需重启会话才生效
    Unsupported,    // 不支持切换
}

/// Provider 注册 trait
pub trait ProviderFactory: Send + Sync {
    fn agent_kind(&self) -> AgentKind;
    fn capabilities(&self) -> ProviderCapabilities;
    fn create(&self, config: AdapterConfig) -> Result<Box<dyn AgentAdapter>>;
}

/// 全局注册表
pub struct ProviderRegistry {
    factories: HashMap<AgentKind, Box<dyn ProviderFactory>>,
}

impl ProviderRegistry {
    pub fn register(&mut self, factory: Box<dyn ProviderFactory>) <REDACTED> 
    pub fn create(&self, kind: &AgentKind, config: AdapterConfig) -> Result<Box<dyn AgentAdapter>>;
    pub fn capabilities(&self, kind: &AgentKind) -> Option<ProviderCapabilities>;
    pub fn list_providers(&self) -> Vec<(AgentKind, ProviderCapabilities)>;
}
```

#### 2.2 新增 Provider 示例

```rust
// 新增一个 Provider 只需：
// 1. 实现 AgentAdapter + AgentSession
// 2. 实现 ProviderFactory
// 3. 注册到 Registry

pub struct OpencodeAdapter;
pub struct OpencodeSession;

impl AgentAdapter for OpencodeAdapter {
    fn kind(&self) -> AgentKind { AgentKind::Opencode }
    async fn create(&self, ctx: &AgentContext) -> Result<Box<dyn AgentSession>> {
        // spawn opencode CLI subprocess
    }
}

pub struct OpencodeFactory;
impl ProviderFactory for OpencodeFactory {
    fn agent_kind(&self) -> AgentKind { AgentKind::Opencode }
    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            session_model_switch: ModelSwitchMode::Unsupported,
            supports_multi_turn: true,
            supports_native_approval: false,
            supports_resume: false,
            ..Default::default()
        }
    }
    fn create(&self, config: AdapterConfig) -> Result<Box<dyn AgentAdapter>> {
        Ok(Box::new(OpencodeAdapter::new(config)))
    }
}

// 注册（在 main.rs 或 mod.rs 一次性完成）
registry.register(Box::new(OpencodeFactory));
```

#### 2.3 能力驱动 UI

```tsx
// 前端根据 capabilities 动态渲染
const caps = providerCaps.get(agentKind);

// 模型切换
{caps?.sessionModelSwitch === 'in-session' && <ModelPicker onChange={setModel} />}
{caps?.sessionModelSwitch === 'unsupported' && <ModelBadge model={currentModel} />}

// Queue/Steer
{caps?.supportsTurnSteering ? <SteerButton /> : <QueueButton />}

// 审批
{caps?.supportsNativeApproval ? <NativeApproval /> : <ClientSimulationApproval />}
```

---

### Phase 3：状态一致性与可靠性（P4 + P3）

**目标**：乐观更新 + 发送状态机 + 超时保护 + 事件归约幂等。

#### 3.1 乐观更新 + 发送状态机

```tsx
// src/features/agent-chat/types.ts
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  tools: ToolCard[];
  ts: string;
  // 新增：发送状态
  status?: 'sending' | 'sent' | 'failed';
  // 新增：事件序列号，用于幂等归约
  seq?: number;
};

// src/features/agent-chat/components/AgentChatTabView.tsx
// 关键改动：发送消息时立即乐观插入
const handleSend = useCallback(() => {
  const text = input.trim();
  if (!text) return;

  const optimisticMsg: ChatMessage = {
    id: `local-${nextMsgId()}`,
    role: 'user',
    text,
    tools: [],
    ts: formatChatTime(new Date()),
    status: 'sending', // ← 乐观状态
  };

  // 1. 乐观插入（不等待后端）
  setMessages(prev => [...prev, optimisticMsg]);
  setInput('');

  // 2. 记录 LocalDispatch 快照
  const dispatch = beginLocalDispatch(optimisticMsg.id);

  // 3. 发送到后端
  agentChatApi
    .sendTurn(sessionId, text)
    .then(() => {
      // 服务器回显 → 替换为持久化版本
      dispatch.serverAcknowledged();
      setMessages(prev =>
        prev.map(m => (m.id === optimisticMsg.id ? { ...m, status: 'sent' } : m)),
      );
    })
    .catch(() => {
      setMessages(prev =>
        prev.map(m => (m.id === optimisticMsg.id ? { ...m, status: 'failed' } : m)),
      );
    });
}, [input, sessionId]);
```

#### 3.2 超时保护

```tsx
// src/features/agent-chat/hooks/useLocalDispatch.ts
const LOCAL_DISPATCH_ACK_TIMEOUT_MS = 10_000; // 10s 确认超时
const LOCAL_DISPATCH_TAKEOVER_TIMEOUT_MS = 60_000; // 60s 接管超时

export function useLocalDispatch() {
  const dispatch = useCallback((optimisticMsgId: string) => {
    const startedAt = Date.now();
    let acked = false;

    const ackTimer = setTimeout(() => {
      if (!acked) {
        // 10s 内未收到服务器回显 → 标记为"发送中..."
        markMessageStatus(optimisticMsgId, 'sending');
      }
    }, LOCAL_DISPATCH_ACK_TIMEOUT_MS);

    const takeoverTimer = setTimeout(() => {
      if (!acked) {
        // 60s 内 Provider 未接管 → 标记为 failed
        markMessageStatus(optimisticMsgId, 'failed');
      }
    }, LOCAL_DISPATCH_TAKEOVER_TIMEOUT_MS);

    return {
      serverAcknowledged: () => {
        acked = true;
        clearTimeout(ackTimer);
        clearTimeout(takeoverTimer);
      },
    };
  }, []);

  return dispatch;
}
```

#### 3.3 事件归约幂等性

```rust
// src-tauri/src/agent/chat/events.rs
// 为 StreamEvent 增加 sequence number
#[derive(Clone, Debug, Serialize)]
pub struct SequencedEvent {
    pub seq: u64,
    pub session_id: String,
    pub event: StreamEvent,
}
```

```tsx
// 前端事件归约：基于 seq 的幂等处理
// 关键：resume 后重放事件时，不重复插入已存在的消息
const reduceEvent = useCallback(
  (prev: ChatMessage[], ev: SequencedEvent): ChatMessage[] => {
    switch (ev.event.type) {
      case 'text_delta': {
        const last = prev[prev.length - 1];
        // 幂等：通过 delta 内容去重（同一 delta 不重复追加）
        if (last && last.role === 'assistant') {
          // 检查是否已包含该 delta（resume 重放场景）
          if (last.text.includes(ev.event.delta)) return prev;
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, text: m.text + ev.event.delta } : m,
          );
        }
        return [...prev, { id: nextMsgId(), role: 'assistant', text: ev.event.delta, tools: [], ts: formatChatTime(new Date()) }];
      }
      // ... 其他事件
    }
  },
  [],
);
```

---

### Phase 4：交互控制能力（P6）

**目标**：4 级审批 + Queue/Steer + 用户输入面板。

#### 4.1 多级审批

```tsx
// src/features/agent-chat/components/ApprovalPanel.tsx
// 当前：Approve / Decline / Cancel turn
// 目标：4 级

type ApprovalChoice =
  | 'approve-once' // 仅本次批准
  | 'approve-session' // 本会话始终批准
  | 'decline' // 拒绝，让 Agent 继续
  | 'cancel-turn'; // 停止当前回合

// 会话内自动放行集合
const sessionAllowedTools = useRef<Set<string>>(new Set());

// "Always allow this session" → 记录到 sessionAllowedTools
const handleApproveSession = (tool: string) => {
  sessionAllowedTools.current.add(tool);
  onApprove(true);
};

// 渲染：4 个选项
<div className="approval-choices">
  <button onClick={() => onApprove(true)}>
    <span className="choice-num">1</span>
    <div>
      <div className="choice-label">Approve once</div>
      <div className="choice-hint">Allow just this request</div>
    </div>
  </button>
  <button onClick={() => handleApproveSession(toolName)}>
    <span className="choice-num">2</span>
    <div>
      <div className="choice-label">Always allow this session</div>
      <div className="choice-hint">Don't ask again this session</div>
    </div>
  </button>
  <button onClick={() => onApprove(false)}>
    <span className="choice-num">3</span>
    <div>
      <div className="choice-label">Decline</div>
      <div className="choice-hint">Reject and continue</div>
    </div>
  </button>
  <button onClick={onCancelTurn}>
    <span className="choice-num">4</span>
    <div>
      <div className="choice-label">Cancel turn</div>
      <div className="choice-hint">Stop the current turn</div>
    </div>
  </button>
</div>
```

#### 4.2 Queue 模式

```tsx
// src/features/agent-chat/hooks/useCommandQueue.ts
export function useCommandQueue(sessionId: string) {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [processing, setProcessing] = useState(false);

  const enqueue = useCallback((text: string) => {
    setQueue(prev => [...prev, { id: nextMsgId(), text, status: 'queued' }]);
  }, []);

  // 消费队列
  useEffect(() => {
    if (processing || queue.length === 0) return;
    const next = queue[0];
    setProcessing(true);
    agentChatApi
      .sendTurn(sessionId, next.text)
      .then(() => {
        setQueue(prev => prev.slice(1));
      })
      .finally(() => setProcessing(false));
  }, [queue, processing, sessionId]);

  return { queue, enqueue, processing };
}
```

#### 4.3 Steer 模式

```tsx
// 仅 supportsTurnSteering=true 的 Provider 可用
const handleSteer = useCallback((newPrompt: string) => {
  // 1. 中断当前 turn
  await agentChatApi.interruptTurn(sessionId);
  // 2. 发送新 turn
  await agentChatApi.sendTurn(sessionId, newPrompt);
}, [sessionId]);
```

#### 4.4 用户输入面板（AskUserQuestion）

```tsx
// src/features/agent-chat/components/UserInputPanel.tsx
// Agent 使用 AskUserQuestion 工具时显示
// 支持单选/多选，数字快捷键 1-9
export function UserInputPanel({ prompt, options, multiSelect, onSubmit }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // 单选模式：选择后 200ms 自动提交
  useEffect(() => {
    if (!multiSelect && selected.size === 1) {
      const timer = setTimeout(() => {
        onSubmit([...selected].map(i => options[i]));
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [selected, multiSelect, onSubmit, options]);

  return (
    <div className="user-input-panel">
      <div className="uip-prompt">{prompt}</div>
      <div className="uip-options">
        {options.map((opt, i) => (
          <button
            key={i}
            className={selected.has(i) ? 'selected' : ''}
            onClick={() => toggle(i)}
          >
            <span className="choice-num">{i + 1}</span>
            {opt}
          </button>
        ))}
      </div>
      {multiSelect && (
        <button onClick={() => onSubmit([...selected].map(i => options[i]))}>
          Next →
        </button>
      )}
    </div>
  );
}
```

---

### Phase 5：UI 组件补全（P6 延伸）

#### 5.1 Plan Mode 卡片

```tsx
// src/features/agent-chat/components/ProposedPlanCard.tsx
// Agent 输出 <proposed_plan> 时渲染
// 长计划 (>900字符/20行) 默认折叠，底部渐变 fade
export function ProposedPlanCard({ plan }: { plan: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = plan.length > 900 || plan.split('\n').length > 20;

  return (
    <div className="plan-card">
      <div className="plan-header">
        <span className="plan-icon">📋</span>
        <span>Proposed Plan</span>
      </div>
      <div className={`plan-body${isLong && !expanded ? ' collapsed' : ''}`}>
        <Markdown text={plan} />
        {isLong && !expanded && <div className="plan-fade" />}
      </div>
      <div className="plan-actions">
        {isLong && (
          <button onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
        <button onClick={() => navigator.clipboard.writeText(plan)}>Copy</button>
      </div>
    </div>
  );
}
```

#### 5.2 上下文窗口计量器

```tsx
// src/features/agent-chat/components/ContextWindowMeter.tsx
// SVG 圆环 + hover 弹出详细 token 使用情况
export function ContextWindowMeter({ used, total, model }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const color = pct > 90 ? 'var(--accent-red)' : pct > 70 ? 'var(--accent-yellow)' : 'var(--accent-green)';

  return (
    <div className="ctx-meter" title={`${pct}% used · ${used}k/${total}k tokens`}>
      <svg viewBox="0 0 36 36" width="20" height="20">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle
          cx="18"
          cy="18"
          r="15.9"
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${pct} ${100 - pct}`}
          strokeDashoffset="25"
        />
      </svg>
      <span className="ctx-meter-label">{pct}%</span>
    </div>
  );
}
```

#### 5.3 回合状态披露器（增强 WorkedCard）

```tsx
// 已完成回合 — "Worked for 12s" 折叠卡片（已有 WorkedCard，增强即可）
// 新增：Undo 按钮（有 checkpoint 时显示）

// 实时回合 — "Thinking..." 指示器
export function WorkingIndicator({ durationMs, activeTool }) {
  return (
    <div className="working-indicator">
      <Loader2 size={14} className="spin" />
      <span>Thinking… {formatDuration(durationMs)}</span>
      {activeTool && <span className="working-tool">{activeTool}</span>}
    </div>
  );
}
```

---

## 五、数据流总览

```
用户输入
  │
  ├─ 1. 乐观插入用户消息（status: sending）
  ├─ 2. beginLocalDispatch() → 启动超时计时器
  ├─ 3. Tauri invoke: sendTurn(sessionId, prompt)
  │
  ▼
Rust Orchestrator
  │
  ├─ 4. ProviderRegistry.create(kind, config) → Adapter
  ├─ 5. Adapter.createSession() → spawn subprocess / connect
  ├─ 6. SessionStore.save_cursor(ResumeCursor { status: Running, ... })
  ├─ 7. Bridge.run(session, emit) → 泵事件
  │       │
  │       ├─ 每个 StreamEvent → 包装为 SequencedEvent { seq, event }
  │       ├─ SessionStore.append_event() → 持久化
  │       └─ Tauri emit → 前端
  │
  ▼
前端 Event Reducer
  │
  ├─ 8. 按 event.type 归约到 messages 状态
  ├─ 9. 幂等检查（seq / 内容去重）
  ├─ 10. 服务器回显用户消息 → status: sent
  │
  ▼
UI 渲染
  │
  ├─ Transcript（消息流）
  ├─ WorkedCard / WorkingIndicator（回合状态）
  ├─ ApprovalPanel（审批）
  ├─ ContextWindowMeter（上下文窗口）
  └─ DiffCard（文件变更）
```

---

## 六、实施路线图

| Phase | 内容 | 预估工期 | 优先级 |
|-------|------|---------|--------|
| **1** | SessionStore (SQLite) + ResumeCursor + 恢复流程 | 2-3 天 | 🔴 P0 |
| **2** | ProviderRegistry + Capability 声明 + 能力驱动 UI | 2-3 天 | 🔴 P0 |
| **3** | 乐观更新 + 发送状态机 + 超时保护 + 事件归约幂等 | 1-2 天 | 🔴 P0 |
| **4** | 4 级审批 + Queue + Steer + 用户输入面板 | 2-3 天 | 🟡 P1 |
| **5** | Plan Mode + ContextWindowMeter + 回合状态披露 | 1-2 天 | 🟢 P2 |

**总计：8-13 天**，可并行推进。

### 建议执行顺序

```
Phase 1 (会话恢复) ─┐
Phase 2 (Registry) ──┼─→ Phase 3 (可靠性) ─→ Phase 4 (交互) ─→ Phase 5 (UI)
                     │
                     └─ 1+2 可并行（独立模块）
```

---

## 七、技术规格明细

### 7.1 新增文件清单

| 文件 | 职责 |
|------|------|
| `src-tauri/src/agent/chat/session_store.rs` | SessionStore trait + SQLite 实现 |
| `src-tauri/src/agent/chat/provider_registry.rs` | ProviderRegistry + ProviderCapabilities |
| `src-tauri/src/agent/chat/orchestrator.rs` | AgentChatOrchestrator（编排层） |
| `src-tauri/src/agent/chat/resume.rs` | 会话恢复逻辑 |
| `src/features/agent-chat/hooks/useLocalDispatch.ts` | 乐观更新 + 超时保护 hook |
| `src/features/agent-chat/hooks/useCommandQueue.ts` | Queue 模式 hook |
| `src/features/agent-chat/components/UserInputPanel.tsx` | 用户输入面板 |
| `src/features/agent-chat/components/ProposedPlanCard.tsx` | Plan Mode 卡片 |
| `src/features/agent-chat/components/ContextWindowMeter.tsx` | 上下文窗口计量器 |
| `src/features/agent-chat/components/WorkingIndicator.tsx` | 实时回合指示器 |

### 7.2 修改文件清单

| 文件 | 改动 |
|------|------|
| `src-tauri/src/agent/chat/adapter.rs` | 移除 adapter_for match，改为 Registry 分派 |
| `src-tauri/src/agent/chat/events.rs` | 新增 SequencedEvent，StreamEvent 增加 seq |
| `src-tauri/src/agent/chat/bridge.rs` | 集成 SessionStore 持久化 + 恢复逻辑 |
| `src-tauri/src/agent/chat/manager.rs` | 替换为 Orchestrator 编排 |
| `src/features/agent-chat/components/ApprovalPanel.tsx` | 2 级 → 4 级审批 |
| `src/features/agent-chat/components/AgentChatTabView.tsx` | 乐观更新 + 发送状态机 + Queue/Steer |
| `src/features/agent-chat/types.ts` | ChatMessage 增加 status/seq 字段 |
| `src/features/agent-chat/components/WorkedCard.tsx` | 增加 Undo 按钮 |

### 7.3 数据库 Schema

```sql
-- ~/.neeko/agent_sessions.db

CREATE TABLE IF NOT EXISTS session_cursors (
    session_id      TEXT PRIMARY KEY,
    agent_kind      TEXT NOT NULL,
    agent_id        TEXT NOT NULL,
    provider_thread_id TEXT,
    cwd             TEXT NOT NULL,
    model           TEXT NOT NULL,
    runtime_mode    TEXT NOT NULL,
    turn_count      INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'ready',
    last_activity   TEXT NOT NULL,  -- ISO8601
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL,
    seq             INTEGER NOT NULL,
    event_type      TEXT NOT NULL,
    event_json      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES session_cursors(session_id)
);

CREATE INDEX idx_events_session_seq ON session_events(session_id, seq);
```

---

## 八、风险与缓解

| 风险 | 缓解 |
|------|------|
| SQLite 写入性能 | 事件追加用 WAL 模式 + 批量写入（每 100ms 或每 50 事件 flush） |
| 子进程残留 | 复用 Neeko 现有的 process cleanup 机制 + SessionReaper 定时清理 |
| Provider resume 失败 | 降级为重开会话，提示用户 |
| 乐观更新与服务器回显冲突 | 通过 seq 去重，服务器消息覆盖乐观消息 |
| 向后兼容 | 旧版 sessions.json 迁移脚本；新 DB 独立于旧文件 |

---

## 九、与 Synara 的映射关系

| Synara 概念 | Neeko 对应实现 | 差异 |
|------------|---------------|------|
| ProviderAdapterRegistry | ProviderRegistry (Rust trait) | 无 Effect 函数式框架，更轻量 |
| ProviderAdapterCapabilities | ProviderCapabilities struct | 桌面端简化（无 skill/plugin mentions） |
| OrchestrationEngine | AgentChatOrchestrator | 无服务端，本地编排 |
| ProviderSessionDirectory | SqliteSessionStore | SQLite 替代内存 Map |
| WebSocket Push | Tauri emit | 本地 IPC，无网络层 |
| Zustand Store + Reducer | useState + useReducer | 后续可迁移到 Zustand |
| LocalDispatch | useLocalDispatch hook | 对齐 |
| promptQueue | useCommandQueue hook | 对齐 |
| DiffStatLabel / DiffCard | FilesChangedCard | 已有基础，增强即可 |
| ContextWindowMeter | ContextWindowMeter（新增） | 对齐 |
| ComposerPendingApprovalPanel | ApprovalPanel | 2 级 → 4 级 |
| ComposerPendingUserInputPanel | UserInputPanel（新增） | 对齐 |
| ProposedPlanCard | ProposedPlanCard（新增） | 对齐 |
