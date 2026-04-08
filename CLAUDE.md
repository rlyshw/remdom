# remote-dom

Server-authoritative DOM streaming system. The server runs V8 isolates as the single source of truth for application state. Clients are thin input/render terminals.

## Architecture

```
Client (thin)              Server (authoritative)
─────────────              ──────────────────────
Input capture ──events──►  V8 Isolate (workerd or isolated-vm)
                           ├── App JS execution
                           ├── DOM (linkedom, jsdom fallback)
                           └── MutationObserver-equivalent diff engine
DOM applier  ◄──ops─────   Fanout (WebSocket/WebTransport)
```

Multiple clients can connect to one isolate (collaboration) or each get their own (mirroring/headless).

## Tech Stack

- **Runtime:** Node 22+ (host process managing isolates)
- **Isolate engine:** `isolated-vm` for prototype, `workerd` for production path
- **Server DOM:** `linkedom` (fast, sufficient for most apps). Flag to swap to `jsdom` for broader API coverage.
- **Transport:** `ws` (WebSocket) for prototype. WebTransport upgrade later.
- **Binary protocol:** MessagePack via `@msgpack/msgpack` for op encoding
- **Monorepo:** pnpm workspaces, TypeScript throughout

## Package Structure

```
remote-dom/
├── packages/
│   ├── protocol/         # Shared types and codec (BUILD FIRST)
│   │   ├── ops.ts        # Op type definitions (see below)
│   │   └── codec.ts      # MessagePack encode/decode helpers
│   ├── server/           # Isolate manager + DOM + fanout
│   │   ├── isolate-pool.ts    # Create/destroy/hibernate isolates
│   │   ├── session.ts         # Maps a session ID to an isolate + subscriber list
│   │   ├── dom-bridge.ts      # Instruments linkedom with mutation tracking
│   │   ├── input-handler.ts   # Receives client input ops, dispatches into isolate DOM
│   │   ├── fanout.ts          # WebSocket server, sends mutation ops to subscribers
│   │   └── index.ts           # HTTP + WS server entry point
│   ├── client/           # Thin browser client library
│   │   ├── input-capture.ts   # Captures mouse, keyboard, touch, scroll, resize
│   │   ├── dom-applier.ts     # Applies mutation ops to local document
│   │   ├── optimistic.ts      # Local prediction for text input + scroll
│   │   └── index.ts           # Connect/disconnect, exports public API
│   └── cli/              # Dev server + tooling
│       └── dev.ts             # Serves client, boots server, loads target app
├── examples/
│   ├── counter/          # Minimal: button + counter, two clients mirrored
│   ├── form/             # Form inputs, validation, demonstrates state sync
│   └── collab/           # Two users, cursor presence, shared DOM
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Op Types (protocol/ops.ts)

```typescript
// Server -> Client (mutations)
type MutationOp =
  | { type: 'snapshot'; html: string; sessionId: string }           // initial full DOM
  | { type: 'childList'; targetId: string; added: SerializedNode[]; removed: string[]; beforeId: string | null }
  | { type: 'attributes'; targetId: string; name: string; value: string | null }
  | { type: 'characterData'; targetId: string; data: string }
  | { type: 'property'; targetId: string; prop: string; value: any } // input .value, .checked, etc

// Client -> Server (input)
type InputOp =
  | { type: 'mousedown' | 'mouseup' | 'click' | 'dblclick'; targetId: string; x: number; y: number; button: number }
  | { type: 'keydown' | 'keyup' | 'keypress'; targetId: string; key: string; code: string; modifiers: number }
  | { type: 'input'; targetId: string; value: string }
  | { type: 'scroll'; targetId: string; scrollTop: number; scrollLeft: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'focus' | 'blur'; targetId: string }

// Every DOM node gets a stable `data-rdid` attribute assigned server-side for targeting.
```

## Build Order

### Phase 1: Prove the loop (get mutations flowing)

1. **protocol/** — Define op types and codec. Pure types + msgpack helpers. No logic.
2. **server/dom-bridge.ts** — Load an HTML string into linkedom. Assign every node a unique `data-rdid`. Instrument the document so any mutation emits a `MutationOp`. linkedom doesn't have MutationObserver; instead, wrap `appendChild`, `removeChild`, `setAttribute`, `textContent` setters via Proxy or direct monkey-patch on the linkedom prototypes.
3. **server/index.ts** — Minimal HTTP server. On WS connect: send `snapshot` op (full serialized DOM). On subsequent mutations: send diff ops.
4. **client/dom-applier.ts** — On `snapshot`: `innerHTML` the received DOM into a container. On diff ops: find target by `data-rdid`, apply mutation. This is a one-way mirror at this point.
5. **Validate:** Open two browser tabs. One triggers server-side DOM changes via a timer in the loaded app. Both tabs update in sync.

### Phase 2: Input upstream

6. **client/input-capture.ts** — Attach listeners to the container for mouse, keyboard, focus, scroll. Serialize to `InputOp`, send over WS. Attach to `document` level with event delegation; use `data-rdid` from `event.target` for targeting.
7. **server/input-handler.ts** — Receive `InputOp`. Construct and dispatch a synthetic DOM event on the corresponding linkedom node. The app's JS event handlers run in the isolate, mutate the DOM, and dom-bridge picks up the changes.
8. **Validate:** Click a button in client A. The server-side counter increments. Client A and B both see the new count.

### Phase 3: Isolate sandboxing

9. **server/isolate-pool.ts** — Wrap app execution in `isolated-vm` or `vm` module (prototype-grade). Load the app's JS into the isolate context alongside the linkedom document. Enforce memory limit (128MB default) and CPU timeout (50ms per event dispatch).
10. **server/session.ts** — Map session IDs to isolate + WebSocket subscriber sets. Support create/join/leave.

### Phase 4: Optimistic input + polish

11. **client/optimistic.ts** — For `input` events on text fields: immediately update local DOM, tag the op as optimistic. When server confirms (sends back the same `property` op), no-op. On conflict (server sends different value), server wins, revert local.
12. **Scroll and resize:** Treat as fire-and-forget, don't wait for server round-trip. Server records viewport state but doesn't echo it back.

### Phase 5: Collaboration primitives

13. Add `userId` to all `InputOp`s. Server attributes mutations to users.
14. Cursor presence: server broadcasts cursor positions as a side-channel op (not a DOM mutation). Clients render peer cursors as overlays.
15. Input conflict: for the same text field, last-write-wins on the server. Future: per-field OT or CRDT.

## Key Decisions

- **linkedom over jsdom** for prototype. 10x faster, lower memory footprint. Trade-off: no layout APIs (`getBoundingClientRect` returns zeros). Apps that depend on layout will break. Log warnings when layout APIs are called; surface to developer.
- **Node IDs via `data-rdid`** attribute. UUIDs, assigned server-side on node creation. Client never generates IDs. Deterministic and inspectable in devtools.
- **No framework dependency.** The app loaded into the isolate can use React, Vue, vanilla, whatever. The system operates at the DOM level below frameworks.
- **No canvas/WebGL in scope.** Log a warning if `<canvas>` is inserted. These require pixel streaming which is a different system entirely.
- **No CSS layout computation.** The server has no layout engine. CSS is applied client-side by the browser. The server streams the DOM structure and attributes; the client browser handles rendering. This means `getComputedStyle`, `offsetWidth`, etc. are unavailable server-side.

## Prototype Scope

The prototype proves: one HTML app loaded server-side, two browser clients connected, user input in either client dispatches events server-side, resulting DOM mutations stream to both clients. That's it. No auth, no persistence, no production isolate management.

## Commands

```bash
pnpm install
pnpm -r build          # build all packages
pnpm --filter server dev   # start dev server on :3000
# open http://localhost:3000 in two tabs
```

## Risks to Flag During Prototype

1. **linkedom mutation instrumentation** — linkedom may not expose clean hooks for all mutation types. May need to fork or deeply monkey-patch. Evaluate in phase 1 before committing.
2. **Synthetic event dispatch fidelity** — `dispatchEvent` on linkedom nodes may not match browser behavior for bubbling, default actions, `preventDefault`. Test with real app handlers early.
3. **Isolate <-> linkedom bridge** — Getting a linkedom document into an `isolated-vm` context requires transferring the linkedom API across the isolate boundary. `isolated-vm` has strict serialization rules. May need to run linkedom inside the isolate rather than bridging. Test in phase 3.
