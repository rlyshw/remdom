# remote-dom

Headless-first DOM streaming framework. Runs headless Chrome on a server, streams structured DOM ops (not pixels) to any client over WebSocket. Humans and AI agents connect to the same session.

## Architecture

```
Headless Chrome (Puppeteer)
├── Real DOM, JS, CSS, cookies
├── Injected MutationObserver → structured ops
└── Input dispatch via CDP (mouse, keyboard, focus)
        │
        │ Chrome DevTools Protocol
        ▼
Session Server (Node.js)
├── PuppeteerBridge (Chrome ↔ Node)
├── Session (subscribers, input routing)
├── Fanout (WebSocket → all clients)
└── Sanitizer (strip scripts, add <base>)
        │
        │ WebSocket (JSON ops)
        ▼
Clients (human browser, agent SDK, etc.)
```

## Tech Stack

- **Runtime:** Node 22+
- **Browser engine:** Puppeteer + puppeteer-core (headless Chrome)
- **Stealth:** puppeteer-extra-plugin-stealth (bot detection bypass)
- **Transport:** ws (WebSocket), JSON ops
- **Lightweight fallback:** linkedom (fake DOM, no Chrome needed)
- **Monorepo:** pnpm workspaces, TypeScript

## Package Structure

```
packages/
├── protocol/          # Op types + codec (pure, no deps)
│   ├── ops.ts         # MutationOp, InputOp definitions
│   └── codec.ts       # JSON/msgpack codec interface
├── server/            # Session management + Chrome integration
│   ├── puppeteer-bridge.ts      # Chrome ↔ Node bridge
│   ├── puppeteer-injected.ts    # In-Chrome MutationObserver script
│   ├── puppeteer-input.ts       # InputOp → Puppeteer API mapping
│   ├── puppeteer-session.ts     # Session backed by Chrome page
│   ├── browser-pool.ts          # Chrome lifecycle management
│   ├── fanout.ts                # WebSocket server
│   ├── client-page.ts           # Reference client HTML
│   ├── index.ts                 # Public API
│   └── (linkedom files)         # Lightweight fallback mode
├── client/            # Browser-side client library
│   ├── dom-applier.ts           # Apply ops to local DOM
│   ├── input-capture.ts         # Capture input → ops
│   └── index.ts                 # connect() entry point
└── cli/               # Dev server
    └── dev.ts                   # CLI entry point
```

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

# Default (Puppeteer mode — full Chrome):
node packages/cli/dist/dev.js [url]
node packages/cli/dist/dev.js https://github.com

# Lightweight mode (linkedom, no Chrome needed):
node packages/cli/dist/dev.js --linkedom [url-or-path]
node packages/cli/dist/dev.js --linkedom examples/counter
```

## Programmatic Usage

```typescript
import { createRemoteDomServer, createBrowserPool, createPuppeteerSession, getClientPage } from '@remote-dom/server';

const pool = await createBrowserPool({ mode: 'launch' });
const page = await pool.acquirePage();

const session = await createPuppeteerSession({
  page,
  url: 'https://example.com',
  onNavigate: async (url, sess) => await sess.reload(url),
});

const server = createRemoteDomServer({
  onRequest: (req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getClientPage({ title: 'My App', urlBar: true }));
      return true;
    }
    return false;
  },
});

server.addSession('default', session);
server.listen(3000);
```

## Known Limitations

- **Shadow DOM** — Web Components internals not streamed (GitHub UI elements)
- **Canvas/WebGL** — pixel content not captured (video players, code editors, games)
- **Cloudflare** — some sites still detect headless Chrome despite stealth plugin
- **Memory** — ~100MB per Chrome page, ~200MB for the browser process
