# remdom

DOM streaming framework. Encodes the DOM as a structured op stream over WebSocket. Transport-agnostic core, with optional integrations for headless browsers, p2p, and other transports.

## Architecture

```
@remdom/protocol    Op types + codec (pure types, no deps)
@remdom/dom         Observer + Applier + Input primitives (browser/Node)
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
@remdom/server        @remdom/puppeteer
WebSocket fanout      Headless Chrome backend
                      (consumes @remdom/dom + @remdom/server)
```

The protocol and DOM primitives are the core. Everything else (Puppeteer, server fanout) is one possible integration. P2P, in-page mirroring, custom backends — all use the same primitives.

## Tech Stack

- **Runtime:** Node 22+ for server bits, any browser for client bits
- **Transport:** WebSocket (ws), JSON ops
- **DOM observation:** Native MutationObserver + property setter interception + Shadow DOM hooks
- **Puppeteer integration:** puppeteer-core + optional puppeteer-extra-plugin-stealth
- **Monorepo:** pnpm workspaces, TypeScript

## Package Structure

```
packages/
├── protocol/       # @remdom/protocol — op types + codec (pure)
│   ├── ops.ts          # MutationOp, InputOp definitions
│   └── codec.ts        # JSON/msgpack codec interface
├── dom/            # @remdom/dom — DOM primitives (browser/Node)
│   ├── observer.ts         # MutationObserver wrapper, emits ops
│   ├── applier.ts          # Applies ops to a local DOM
│   ├── input-capture.ts    # Captures user input as InputOps
│   ├── input-dispatcher.ts # Applies InputOps as real DOM events
│   ├── node-registry.ts    # Stable ID management
│   ├── serialize.ts        # SerializedNode helpers
│   └── injectable.ts       # IIFE string for headless browser injection
├── server/         # @remdom/server — WebSocket fanout (Node)
│   ├── fanout.ts           # WebSocketServer wrapper
│   ├── client-page.ts      # Minimal test client HTML
│   ├── session.ts          # Session interface
│   └── index.ts            # createRemoteDomServer
├── puppeteer/      # @remdom/puppeteer — Headless Chrome backend (Node)
│   ├── bridge.ts           # Chrome ↔ Node CDP bridge
│   ├── input.ts            # InputOp → Puppeteer API mapping
│   ├── session.ts          # Session backed by a Puppeteer page
│   └── browser-pool.ts     # Chrome lifecycle
└── client/         # @remdom/client — convenience client wrapper
    └── index.ts            # connect() helper, OptimisticManager
```

The framework is `@remdom/dom`. Everything else is an optional adapter. There is no CLI — the framework doesn't ship a runner. To wire adapters together, write a small Node script (see `examples/server-puppeteer/` for a 30-line example).

## Op Protocol

```typescript
// Server → Client
type MutationOp =
  | { type: 'snapshot'; html: string; sessionId: string }
  | { type: 'childList'; targetId: string; added: SerializedNode[]; removed: string[]; beforeId: string | null }
  | { type: 'attributes'; targetId: string; name: string; value: string | null }
  | { type: 'characterData'; targetId: string; data: string }
  | { type: 'property'; targetId: string; prop: string; value: any }
  | { type: 'navigated'; url: string }

// Client → Server
type InputOp =
  | { type: 'click' | 'dblclick' | 'mousedown' | 'mouseup'; targetId: string; x: number; y: number; button: number }
  | { type: 'keydown' | 'keyup' | 'keypress'; targetId: string; key: string; code: string; modifiers: number }
  | { type: 'input'; targetId: string; value: string }
  | { type: 'scroll'; targetId: string; scrollTop: number; scrollLeft: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'focus' | 'blur'; targetId: string }
  | { type: 'navigate'; url: string }
```

## Commands

```bash
pnpm install
pnpm -r build

# Run the server-puppeteer example
node examples/server-puppeteer/index.js [url]
node examples/server-puppeteer/index.js https://example.com
```

## Programmatic Usage

### Standalone observer (no server, no Puppeteer)

```typescript
import { createObserver } from '@remdom/dom';

const observer = createObserver({
  root: document.documentElement,
  onOps: (ops) => ws.send(JSON.stringify(ops)),
  resyncInterval: 100,
});
observer.snapshot();
```

### Headless browser session over WebSocket

```typescript
import { createRemoteDomServer, getClientPage } from '@remdom/server';
import { createBrowserPool, createPuppeteerSession } from '@remdom/puppeteer';

const pool = await createBrowserPool({ mode: 'launch' });
const page = await pool.acquirePage();

const session = await createPuppeteerSession({
  page,
  url: 'https://example.com',
  onNavigate: async (url, sess) => sess.reload(url),
});

const server = createRemoteDomServer({
  onRequest: (req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getClientPage({ title: 'My App' }));
      return true;
    }
    return false;
  },
});

server.addSession('default', session);
server.listen(3000);
```

## Known Limitations

- **Canvas/WebGL** — pixel content not captured
- **Layout-dependent JS** — `getComputedStyle`, `offsetWidth` etc. work in the source environment but layout differs in client viewport
- **Memory** — ~100MB per Puppeteer page

## See also

- `docs/PHILOSOPHY.md` — why encode the DOM, what this enables
- `docs/ARCHITECTURE.md` — system design and data flow
- `docs/WIRE_FORMAT.md` — complete protocol reference
- `examples/mirror/` — in-page observer→applier demo
