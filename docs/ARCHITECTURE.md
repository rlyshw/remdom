# remdom Architecture

## What this is

A DOM streaming framework. Encodes the DOM as a structured op stream that can be transported between any two endpoints — browser tabs, Node processes, headless browsers, p2p peers.

The framework itself is one package: **`@remdom/dom`**. Everything else (transport, backends, runners) is an optional adapter built on top.

## Core primitives

```
                    ┌──────────────────────┐
                    │   @remdom/dom         │
                    │   (the framework)     │
                    │                       │
                    │  createObserver()     │   DOM → ops
                    │  DomApplier           │   ops → DOM
                    │  createInputCapture() │   user input → ops
                    │  createInputDispatcher│   ops → user input
                    │  NodeRegistry         │   stable ID management
                    └──────────────────────┘
```

These primitives know nothing about transport. They take callbacks. The caller decides what to do with the ops — send over WebSocket, postMessage, WebRTC, pipe to a local applier, log, whatever.

## Optional adapters

```
@remdom/dom (the framework)
    │
    ├─ @remdom/server     ─ WebSocket fanout, session interface
    │   └─ @remdom/puppeteer  ─ Headless Chrome backend
    │
    ├─ @remdom/client     ─ Browser-side connect() helper
    │
    └─ (your adapters)    ─ WebRTC, postMessage, jsdom, etc.
```

Each adapter is a separate package that consumes the framework. None of them are required. You can:

- Use only `@remdom/dom` — pure in-page or in-process DOM streaming
- Add `@remdom/server` for WebSocket transport
- Add `@remdom/puppeteer` for a headless Chrome DOM source
- Build your own adapter for any other transport or DOM source

## How a typical adapter stack works

```
Headless Chrome (via @remdom/puppeteer)
├── Real DOM, JS, CSS, cookies
├── Injected observer (from @remdom/dom/injectable)
└── Input dispatcher
        │
        │ Chrome DevTools Protocol
        ▼
Node.js process
├── PuppeteerBridge (Chrome ↔ Node)
├── PuppeteerSession (implements @remdom/server's Session interface)
└── @remdom/server fanout
        │
        │ WebSocket (JSON ops)
        ▼
Clients (any WebSocket consumer)
├── Browser tab using @remdom/dom DomApplier
├── iOS app, Python script, AI agent, test runner...
└── Each client receives the same op stream
```

This is one stack. Other stacks are equally valid:

- **In-page mirror:** observer in left iframe → applier in right iframe. No server.
- **P2P:** observer in browser A → WebRTC data channel → applier in browser B. No server.
- **Test runner:** observer in jsdom → in-process applier. No browser at all.
- **Recording:** observer in any environment → file. Replay later via applier.

## Op protocol (summary)

```typescript
// Server → Client (mutations)
type MutationOp =
  | { type: 'snapshot'; html: string; sessionId: string }
  | { type: 'childList'; targetId: string; added: SerializedNode[]; removed: string[]; beforeId: string | null }
  | { type: 'attributes'; targetId: string; name: string; value: string | null }
  | { type: 'characterData'; targetId: string; data: string }
  | { type: 'property'; targetId: string; prop: string; value: any }
  | { type: 'navigated'; url: string }

// Client → Server (input)
type InputOp =
  | { type: 'click'/'dblclick'/'mousedown'/'mouseup'; targetId: string; x: number; y: number; button: number }
  | { type: 'keydown'/'keyup'/'keypress'; targetId: string; key: string; code: string; modifiers: number }
  | { type: 'input'; targetId: string; value: string }
  | { type: 'scroll'; targetId: string; scrollTop: number; scrollLeft: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'focus'/'blur'; targetId: string }
  | { type: 'navigate'; url: string }
```

See [`packages/protocol/src/ops.ts`](../packages/protocol/src/ops.ts) for full type definitions and [`docs/WIRE_FORMAT.md`](./WIRE_FORMAT.md) for JSON examples.

## Package layout

```
packages/
├── protocol/       # Op types + JSON codec (pure types)
├── dom/            # The framework — observer/applier/input primitives
├── server/         # WebSocket fanout adapter (optional)
├── puppeteer/      # Headless Chrome adapter (optional)
└── client/         # Browser client convenience wrapper (optional)

examples/
├── mirror/             # In-page demo of observer + applier (no transport)
└── server-puppeteer/   # Full stack: server fanout + puppeteer backend
```

## What's NOT in the framework

- A runner / CLI — write a Node script (see `examples/server-puppeteer/`)
- A "default" backend — bring your own DOM source
- A "default" transport — bring your own (WebSocket, WebRTC, postMessage, etc.)
- Auth, sessions, multi-user management — that's a service layer concern, not framework

The framework is intentionally small. It encodes the DOM. That's it.
