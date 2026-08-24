# dsh-neeko

Bidirectional bridge between [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) and the **Neeko** desktop shell.

`dsh-neeko` is the communication layer described in [`docs/dsh-neeko-integration.md`](docs/dsh-neeko-integration.md). It is a **neutral protocol bridge**:

- **DSH** is the AI backend (agents, sessions, commands, tools, sandbox) and never knows Neeko exists.
- **Neeko** is the desktop interaction shell (file editing, Git, terminal, Agent Chat UI) and treats DSH as one optional backend.
- **dsh-neeko** translates both directions, owns the WebSocket + health server, and holds session state.

## What it provides

| Feature | Status |
|---|---|
| WebSocket server on `127.0.0.1:3081` (non-3080, dynamic fallback to `+1..+9`) | ✅ |
| Health probe `GET /neeko-health` | ✅ |
| Handshake protocol with mode detection (`dsh-agent` / `on-demand`) | ✅ |
| DSH event → protocol translation (`text.delta`, `thinking.delta`, `tool.start`, `tool.end`) | ✅ |
| Neeko message → DSH API (`session.prompt`, `session.steer`, `session.cancel`) | ✅ |
| Approval requests (`approval.request` / `approval.respond`) | ✅ |
| User questions (`question.request` / `question.respond`) | ✅ |
| `session.init` with reconstructed history | ✅ |
| CLI mode auto-launch of Neeko | ✅ |
| Daemon mode (pure wait, no spawn) | ✅ |

## Architecture

```
+-----------------------------------------------------------------+
|                      dsh-neeko (bridge)                          |
|                                                                  |
|  WS server: 127.0.0.1:3081  (health at /neeko-health)           |
|                                                                  |
|  +------------------------------------------------------------+  |
|  |  Neeko connection modes                                     |  |
|  |   mode=dsh-agent  -> activate session immediately           |  |
|  |   mode=on-demand, active=true -> activate on click          |  |
|  |   mode=on-demand, active=false -> idle, no event subscription |  |
|  +------------------------------------------------------------+  |
+-----------------------------------------------------------------+
      |                                      |
      |  DSH API (agents/sessions)           |  WS protocol
      v                                      v
   DSH process                           Neeko process
```

### Launch paths

- **Path A — DSH starts Neeko:** `dsh --profile neeko` → the bridge starts, spawns
  `open -a Neeko --args --dsh-ws=ws://127.0.0.1:3081/ws --mode=dsh-agent`, and Neeko
  opens straight into the Agent Chat.
- **Path B — Neeko starts DSH:** the user clicks *DeepSeek* in Neeko; Neeko probes
  `GET http://127.0.0.1:3081/neeko-health`, and if DSH is down spawns
  `dsh --profile neeko daemon`, waits for the health probe, then connects with
  `mode=on-demand, active=true`.

## Install

```shell
npm i -g @deepseek-ai/dsh
dsh plugin --profile neeko add dsh-neeko

# CLI mode: bridge + auto-launch Neeko
dsh --profile neeko

# Daemon mode: pure wait, never spawns Neeko
dsh --profile neeko daemon
```

For local development, link this checkout instead:

```shell
just install     # = dsh plugin --profile neeko add "."
```

## Usage

```
dsh --profile neeko [options] [mode]

Options:
  --daemon         pure-wait mode: never spawn Neeko
  --host <host>    bind host (default 127.0.0.1)
  --port <n>       preferred bridge port (default 3081; falls back to +1..+9)
  --session <id>   resume an existing persisted session
  --spawn <cmd>    override the Neeko launch command (e.g. "open -a Neeko")
  --no-spawn       do not spawn Neeko even in CLI mode

Environment:
  DSH_NEEKO_PORT=3081            port override when --port is absent
  DSH_NEEKO_AUTOSPAWN=0         disable auto-spawn in CLI mode
```

## Wire protocol

The protocol is exported from `dsh-neeko/protocol` (also usable by the Neeko side).
Every frame is a JSON envelope:

```ts
interface Envelope {
  rpcId: string
  direction: 'dsh->neeko' | 'neeko->dsh'
  timestamp: number
  message: ProtocolMessage
}
```

The first frame of a connection must be a handshake:

```ts
{ type: 'handshake', payload: { version: '1.0.0', role: 'neeko',
  mode: 'dsh-agent' | 'on-demand', active: boolean, sessionId?: string } }
```

Messages (see `src/protocol.ts` for the full types):

- **DSH → Neeko:** `session.init`, `status.change`, `text.delta`, `thinking.delta`,
  `tool.start`, `tool.stream`, `tool.end`, `approval.request`, `question.request`, `error`
- **Neeko → DSH:** `session.prompt`, `session.steer`, `session.cancel`,
  `approval.respond`, `question.respond`

### DSH event → protocol mapping

| DSH event | Protocol message |
|---|---|
| `assistant/chunk` (text-delta) | `text.delta` |
| `assistant/chunk` (reasoning-delta) | `thinking.delta` |
| `tool/call` | `tool.start` |
| `tool/result` | `tool.end` (with diff when the fs tool attaches one) |
| `agent/status` / tool activity | `status.change` |
| `approval/request` | `approval.request` |
| `ask_user_question` | `question.request` |

## Project layout

```
dsh-neeko/
+-- package.json
+-- cordis.patch.yml         # bundle patch: startup + bridge rows
+-- src/
|   +-- index.ts             # main plugin: bridge, session lifecycle, approval/questions
|   +-- ws-server.ts         # HTTP health endpoint + WebSocket server + handshake
|   +-- protocol.ts          # neutral wire protocol types + envelope helpers
|   +-- dsh-adapter.ts       # DSH events -> protocol translation + history
|   +-- neeko-adapter.ts     # protocol -> DSH API calls
|   +-- startup.ts           # `dsh --profile neeko` CLI parsing
+-- tests/                   # vitest suite
+-- docs/dsh-neeko-integration.md
```

## Development

```shell
pnpm install      # install + build (prepare script)
pnpm run check    # type-check (src + tests)
pnpm test         # vitest
pnpm run build    # tsdown -> lib/
```

The suite covers protocol envelope round-trips, event translation and history
reconstruction, the Neeko→DSH adapter mapping, the WebSocket server (health,
handshake, invalid-frame rejection, dynamic port fallback), and spawn error
handling.

## Known limitations (Phase 2 candidates)

- `tool.stream` is part of the protocol but DSH core currently logs no tool
  stdout/stderr stream event; it will be wired when such an event exists.
- Reconnect support: the bridge currently disposes the live agent when the
  Neeko connection closes (persisted sessions can be resumed afterwards).
- WS authentication token and multi-session switching are not implemented yet.
- The bridge accepts one active Neeko connection at a time.

## License

MIT
