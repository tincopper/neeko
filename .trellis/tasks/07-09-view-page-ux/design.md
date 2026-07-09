# View page UX optimization — Design

## Architecture & Boundaries

Three independent changes with no inter-blocking dependencies:

| Req | Layer | Scope | Depends On |
|-----|-------|-------|------------|
| R1 (model) | Rust backend + TS types + component | adapter -> types -> manager -> component | None |
| R2 (scroll) | Frontend only | ConversationViewer | None |
| R3 (aggregate) | Frontend only | ConversationViewer + ConversationMessage | None |

## R1 — Model in Title Bar

### Data Flow

```
adapter/parse_meta()
  └─ extract model field from native format
     └─ ParsedMeta.model: Option<String>
        └─ manager/resolve_meta() → ConversationMeta.model: Option<String>
           └─ Tauri IPC serialization
              └─ frontend ConversationMeta.model: string | undefined
                 └─ ConversationViewer title bar: "{agentId} · {model}"
```

### Adapter extraction

- **Claude Code**: `mode` record has a `model` field. Extract at `claude_code.rs:222`.
  ```rust
  let model = entries
      .iter()
      .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("mode"))
      .and_then(|e| e.get("model").and_then(|v| v.as_str()))
      .map(|s| s.to_string());
  ```

- **OpenCode**: The `data` JSON (already parsed for `summary.title`) likely has a `model` field.
  ```rust
  v.pointer("/model").and_then(|m| m.as_str().map(|s| s.to_string()))
  ```
  If not available, fallback to `None`.

- **Other adapters** (codex, codebuddy, qoder, pi, gemini): Return `None` for model.

### Frontend display

Title bar already renders `agentId` — change to `{agentName} {model ? `· ${model}` : ''}`.

## R2 — Scroll to Top

### Implementation

Floating button in the message scroll area:

- Position: fixed bottom-right of the scroll container
- Visibility: shown only when `scrollRef.current.scrollTop > container.clientHeight` (scroll past one viewport)
- Behavior: `scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' })`
- Icon: `ChevronUp` from lucide-react
- Style: matching existing ghost button pattern (`w-7 h-7 rounded-full shadow-md`)

### Edge cases

- No messages → never show
- `loadMore` triggered → recalculation happens naturally on scroll
- Not needed in the tool call sidebar

## R3 — Aggregation

### Grouping logic

In `ConversationViewer`, transform `visibleMessages` before rendering:

```
groups = []
for msg in visibleMessages:
  if msg.role != 'assistant' OR groups is empty OR last group role != 'assistant':
    groups.push({ role: msg.role, messages: [msg], actualIdx: [msg.index] })
  else:
    groups.last.messages.push(msg)
    groups.last.actualIdx.push(msg.index)
```

### Rendering

- `user` groups → render existing `ConversationMessage` (unchanged)
- `assistant` groups → render new `AggregatedMessageCard`:
  - Header: `AgentIcon` + agent name (via `agents.find`) + timestamp of first message
  - Body: iterate `group.messages`, render each as a sub-section
  - Between sub-sections: thin divider (`<div className="border-t border-border/50 my-2" />`)
  - Each sub-section renders its `blocks` array via existing `MessageBlockRenderer`
  - Backward compatible: if blocks empty, use `TextBlock` with `message.content`

### Tool call sidebar impact

Currently `scrollToMessage(msgIdx)` scrolls to a single message element. After aggregation:
- The `ref` for grouped messages should point to the group container
- `scrollToMessage` needs adjusted mapping: group's first `actualIdx` is the scroll target, but we need to handle scrolling within the group to the specific sub-message

Decision: Keep `msgIdx` → group container scroll (same behavior, scrolls to the group that contains the target message). The `messageRefs` map stores `actualIdx` → group DOM element for the *first* index in the group.

### Virtualization / pagination

- `hasMore` / `loadMore` works on `messages` array — unchanged
- `visibleMessages` slicing happens before grouping — grouping re-runs on every render when `visibleMessages` changes
- `useMemo` wrapping the grouping computation

### Agent identity display

Use same pattern as `ConversationItem.tsx`:
```tsx
const agent = useMemo(
  () => agents.find((a) => a.id === agentId) ?? null,
  [agents, agentId],
);
```

### Props changes

- `ConversationViewer` needs new prop `agents: AgentConfig[]`
- `EditorGroupPane` needs to pass agents from its store/context
