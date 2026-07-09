# View page UX optimization — Implementation Plan

## Order of Implementation

```
1. R1 backend: add model field to types -> adapters -> manager
2. R3 frontend: message aggregation + agent icon/name label
3. R2 frontend: scroll-to-top button
4. R1 frontend: model display in title bar
```

R1 backend is independent; R2/R3/R1 frontend all edit `ConversationViewer.tsx` — do together.

---

## Step 1: Add `model` to Rust types

### Files

| File | Change |
|------|--------|
| `src-tauri/src/conversation/adapter.rs` | Add `model: Option<String>` to `ParsedMeta` |
| `src-tauri/src/conversation/types.rs` | Add `model: Option<String>` to `ConversationMeta` (serde camelCase → `model: Option<String>`) |

### Claude Code adapter: extract model

In `src-tauri/src/conversation/adapters/claude_code.rs`, `parse_meta`:
- Add extraction of `model` from the `mode` record:
  ```rust
  let model = entries
      .iter()
      .find(|e| e.get("type").and_then(|v| v.as_str()) == Some("mode"))
      .and_then(|e| e.get("model").and_then(|v| v.as_str()))
      .map(|s| s.to_string());
  ```
- Add `model` to `ParsedMeta` construction at line 329.

### OpenCode adapter: extract model

In `src-tauri/src/conversation/adapters/opencode.rs`:
- After `data_json` parsing, try `v.pointer("/model")` for model name
- Add `model` to `ParsedMeta` construction

### Other adapters

All return `model: None`.

### Manager propagation

In `src-tauri/src/conversation/manager.rs`, `resolve_meta` / `build_meta`:
- Pass `model` from `ParsedMeta` into `ConversationMeta.model`.

### Validation

```bash
cargo check
cargo test
```

---

## Step 2-4: Frontend changes

### Files

| File | Change |
|------|--------|
| `src/features/conversation/types.ts` | Add `model?: string` to `ConversationMeta` |
| `src/features/conversation/components/ConversationViewer.tsx` | Add agents prop, add R2+R3+R1 |
| `src/features/editor/components/EditorGroupPane.tsx` | Pass `agents` to `ConversationViewer` |

### ConversationViewer changes

**Props**: Add `agents: AgentConfig[]` (same type as ConversationPanel).

**R3 — Aggregation**:
- `useMemo` to group `visibleMessages`:
  - Consecutive `assistant` → merge into group
  - `user` → standalone group
- Render a new helper component or inline rendering for groups:
  - `assistant` group header: `<AgentIcon icon={agent?.icon} />` + `{agent?.name ?? agentId}` + timestamp
  - Sub-messages separated by `<div className="border-t border-border/50" />`
  - Each sub-message renders blocks via `MessageBlockRenderer`

**R2 — Scroll to top**:
- State: `showScrollTop` (boolean, set by scroll event listener)
- Floating button: `position: sticky`, `bottom: 4`, `right: 4`, `z-index` above messages
- Icon: `ChevronUp` from lucide-react
- OnClick: `scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' })`

**R1 — Model in title bar**:
- Change `{agentId ?? 'Conversation'}` to:
  ```tsx
  {agent?.name ?? agentId}
  {meta.model && <span className="text-text-secondary/50">· {meta.model}</span>}
  ```

### EditorGroupPane changes

- Pass `agents={enabledAgents}` to `<ConversationViewer>` (line 335)

### Validation

```bash
pnpm lint
pnpm type-check
pnpm test:run
cargo check
```

## Validation commands

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm lint
pnpm type-check
pnpm test:run
```
