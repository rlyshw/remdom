# remote-dom

**Headless-first DOM streaming framework.**

Run headless Chrome on a server. Stream structured DOM ops — not pixels — to any client over WebSocket. Humans and AI agents connect to the same session.

> The DOM is a complex, stationary data structure — designed to live in one place and be operated on in-place. remote-dom breaks that restriction. It encodes the DOM as a transportable, streamable data type that can be operated on remotely over WebSocket.
>
> [Read more: Encoding the DOM →](docs/PHILOSOPHY.md)

---

## Quick start

```bash
git clone https://github.com/rlyshw/remdom.git
cd remdom
npm install -g pnpm
pnpm install
pnpm -r build

# Start a session (headless Chrome, streams to localhost:3000)
node packages/cli/dist/dev.js https://news.ycombinator.com
```

Open `http://localhost:3000` in multiple browsers — they share the same session.

## Programmatic usage

```typescript
import {
  createRemoteDomServer,
  createBrowserPool,
  createPuppeteerSession,
} from '@remote-dom/server';

const pool = await createBrowserPool({ mode: 'launch' });
const page = await pool.acquirePage();

const session = await createPuppeteerSession({
  page,
  url: 'https://example.com',
  onNavigate: async (url, sess) => await sess.reload(url),
});

const server = createRemoteDomServer();
server.addSession('default', session);
server.listen(3000);
```

## Architecture

```
Human A (browser)                Server                     AI Agent (SDK/script)
────────────────                 ──────                     ────────────────────

 keyboard ──InputOp──►      ┌─────────────────┐      ◄──InputOp── navigate()
 mouse    ──InputOp──►      │Headless Chrome  │      ◄──InputOp── click()
 scroll   ──InputOp──►      │Puppeteer+Stealth│      ◄──InputOp── type()
                            │MutationObserver │
 DOM ops  ◄─MutationOp──    │WebSocket fanout │    ──MutationOp─► readDOM()
                            └─────────────────┘

Human B (phone/tablet)               │                  Any WebSocket client
─────────────────────                │                  can connect:
                                     │                  browsers, scripts,
 Same session, synced ◄─MutationOp──┘                   agents, test runners
```

## Protocol

Server → Client: `snapshot` · `childList` · `attributes` · `characterData` · `property` · `navigated`

Client → Server: `click` · `keydown` · `input` · `scroll` · `resize` · `focus` · `blur` · `navigate`

See [`packages/protocol/src/ops.ts`](packages/protocol/src/ops.ts) for full type definitions.

## Docs

- **[Architecture](docs/ARCHITECTURE.md)** — system design, data flow, package structure
- **[Encoding the DOM](docs/PHILOSOPHY.md)** — how DOM encoding works, MutationObserver pipeline, limitations
- **[Wire Format](docs/WIRE_FORMAT.md)** — complete protocol reference with JSON examples

## License

MIT
