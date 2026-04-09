# remote-dom Architecture

## What this is

A headless-first web session layer. Headless Chrome runs on a server. Humans and AI agents connect to the same session via protocol. Both can observe the DOM, dispatch input, and navigate. Think of it as **MCP for the web** — a shared, programmable browsing context.

```
                    ┌─────────────────────┐
                    │   Headless Chrome    │
                    │   (Puppeteer)        │
                    │                     │
                    │  Real DOM, JS, CSS  │
                    │  Cookies, Storage   │
                    └────────┬────────────┘
                             │ CDP (Chrome DevTools Protocol)
                    ┌────────┴────────────┐
                    │   Session Server    │
                    │   (Node.js)         │
                    │                     │
                    │  ┌───────────────┐  │
                    │  │ Injected      │  │
                    │  │ Observer      │◄─┼── MutationObserver in Chrome
                    │  │ (DOM → Ops)   │  │   streams structured ops out
                    │  └───────┬───────┘  │
                    │          │          │
                    │  ┌───────┴───────┐  │
                    │  │ Session       │  │
                    │  │ Manager       │  │
                    │  │               │  │
                    │  │ • Subscribers │  │
                    │  │ • Input relay │  │
                    │  │ • Navigation  │  │
                    │  └───────┬───────┘  │
                    │          │          │
                    │     WebSocket       │
                    │     Fanout          │
                    └──────┬──────┬───────┘
                           │      │
              ┌────────────┘      └────────────┐
              │                                │
     ┌────────┴─────────┐           ┌──────────┴────────┐
     │  Human Client    │           │  Agent Client     │
     │  (Browser tab)   │           │  (SDK / MCP)      │
     │                  │           │                   │
     │  • DOM viewer    │           │  • Read DOM state │
     │  • Input capture │           │  • Send actions   │
     │  • URL bar       │           │  • Observe changes│
     │  • Scroll sync   │           │  • Navigate       │
     └──────────────────┘           └───────────────────┘
```

## Core concepts

### Session
A single headless Chrome page. Has state (cookies, localStorage, scroll position, DOM). Multiple clients (human or agent) can connect to one session. The session is the unit of persistence.

### Ops (protocol)
Structured messages between server and clients:

**Server → Client (MutationOps):**
- `snapshot` — full DOM HTML
- `childList` — nodes added/removed
- `attributes` — attribute changed
- `characterData` — text content changed  
- `property` — input value, checked state
- `navigated` — URL changed

**Client → Server (InputOps):**
- `click`, `dblclick` — mouse events (resolved by element ID)
- `keydown`, `keyup`, `keypress` — keyboard
- `input` — text field value change
- `scroll` — viewport scroll position
- `resize` — viewport dimensions
- `focus`, `blur` — element focus
- `navigate` — go to URL

### Injected Observer
A script running inside Chrome that:
- Assigns stable IDs (`data-rdid`) to all DOM nodes
- Watches mutations via `MutationObserver`
- Serializes changes into op format
- Exposes helper functions for input dispatch (resolve element coordinates, set input values, manage focus)

### Client
A thin terminal that:
- Receives ops and applies them to a local DOM
- Captures user input and sends it as ops
- Does NOT run any of the target site's JavaScript
- Receives only sanitized HTML (scripts stripped, `<base>` tag for asset resolution)

## Package structure

```
packages/
├── protocol/          # Op types + codec (pure, no dependencies)
│   ├── ops.ts         # MutationOp, InputOp type definitions
│   └── codec.ts       # JSON/msgpack encode/decode, Codec interface
│
├── server/            # Session management + Chrome integration
│   ├── puppeteer-bridge.ts      # Chrome ↔ Node bridge (CDP)
│   ├── puppeteer-injected.ts    # Script injected into Chrome pages
│   ├── puppeteer-input.ts       # InputOp → Puppeteer API mapping
│   ├── puppeteer-session.ts     # Session backed by Chrome page
│   ├── browser-pool.ts          # Chrome lifecycle (launch/connect)
│   ├── session.ts               # Session backed by linkedom (lightweight)
│   ├── dom-bridge.ts            # linkedom DOM instrumentation
│   ├── fanout.ts                # WebSocket server, routes to sessions
│   ├── client-page.ts           # Human client HTML (URL bar, etc.)
│   ├── content.ts               # URL/file content loading
│   ├── index.ts                 # Public API + createRemoteDomServer
│   ├── input-handler.ts         # InputOp dispatch for linkedom
│   ├── browser-env.ts           # Browser polyfills for linkedom
│   ├── script-interceptor.ts    # Dynamic script loading for linkedom
│   └── isolate-pool.ts          # V8 isolate placeholder
│
├── client/            # Browser-side thin client library
│   ├── dom-applier.ts           # Apply MutationOps to local DOM
│   ├── input-capture.ts         # Capture user input → InputOps
│   ├── optimistic.ts            # Optimistic input prediction
│   └── index.ts                 # connect() entry point
│
└── cli/               # Dev server + tooling
    └── dev.ts                   # CLI: --puppeteer flag, URL bar, bookmarks
```

## Two backends

### Puppeteer (primary, full fidelity)
Real Chrome. Every website works. ~100MB per page. Mutations stream via injected MutationObserver + `page.exposeFunction()`. Input dispatched via `page.mouse`/`page.keyboard`. Stealth plugin for bot detection bypass.

### Linkedom (lightweight, API-oriented)
Fake DOM in Node. Fast, ~5MB per session. Good for: HTML scraping, simple interactions, API-driven browsing, testing. Bad for: SPAs, complex JS, anything needing real rendering.

## What's NOT in scope

- Pixel streaming (video, canvas, WebGL)
- Shadow DOM traversal (Web Components internals)
- Service Workers / Push notifications
- File uploads/downloads
- Browser extension compatibility
- Multi-tab within one session (one page per session)

## Data flow example: user clicks a link

```
1. Human clicks <a href="/about"> in their browser
2. Client-page JS intercepts click (capture phase)
3. preventDefault() stops browser navigation
4. Sends InputOp { type: "navigate", url: "/about" }
5. Server receives via WebSocket
6. Session calls bridge.navigate("https://example.com/about")
7. Puppeteer calls page.goto(url)
8. Chrome navigates, loads page, runs JS
9. Injected observer detects DOM changes
10. MutationObserver fires, serializes to MutationOps
11. Ops sent to Node via __rdm_sendOps (exposed function)
12. Session sanitizes HTML (strip scripts, add <base>)
13. Broadcasts to all connected clients
14. Human client applies ops → sees new page
15. Agent client receives same ops → can read/act on new DOM
```

## Future: Agent integration

The session server already speaks a structured protocol (ops over WebSocket). An agent client would:

1. Connect via WebSocket (same as human client)
2. Receive MutationOps to understand page state
3. Send InputOps to interact (click, type, navigate)
4. Use higher-level commands (find element by text, wait for selector, extract data)

This is essentially what MCP tools like `browser_use` do, but with a shared session that a human can observe and intervene in. The agent browses, the human watches. Or vice versa.
