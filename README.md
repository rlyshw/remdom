# remdom

**DOM streaming framework.**

Encode the DOM as a structured op stream. Virtualize and stream DOM state between any source and any number of clients. A semantic interface to the DOM so any consumer can parse, filter, record, or act on it.

> The DOM is a complex, stationary data structure — designed to live in one place and be operated on in-place. remdom breaks that restriction. It encodes the DOM as a transportable, streamable data type that can be operated on remotely.
>
> [Read more: Encoding the DOM →](docs/PHILOSOPHY.md)

---

## The framework

The framework is one package: **`@remdom/dom`**. It contains the DOM observation and application primitives. Pure DOM stuff. No Node, no server, no transport. Works in any browser.

```typescript
import { createObserver, DomApplier } from '@remdom/dom';

// On one side: observe a DOM and emit ops
const observer = createObserver({
  root: document.documentElement,
  onOps: (ops) => myTransport.send(ops),
});
observer.snapshot();

// On the other side: receive ops and apply to a DOM
const applier = new DomApplier(myContainer);
myTransport.onMessage = (ops) => ops.forEach(op => applier.apply(op));
```

That's the framework. Two primitives: `createObserver` and `DomApplier`. Plus `createInputCapture` for the reverse direction (user input → ops). Everything else is optional.

## Optional adapters

The framework doesn't care how ops get from observer to applier — that's a transport concern. This repo includes several official adapters as separate packages:

| Package | What it does |
|---------|--------------|
| `@remdom/protocol` | Op type definitions and JSON codec (used by everything) |
| `@remdom/dom` | **The framework.** Observer + Applier + Input primitives |
| `@remdom/server` | WebSocket fanout server (Node) — relays ops between sessions and connected clients |
| `@remdom/puppeteer` | Headless Chrome backend (Node) — wraps a Puppeteer page as a DOM source |
| `@remdom/client` | Convenience client wrapper for the WebSocket transport |

You can use any subset. Pure in-page demo? Just `@remdom/dom`. Multiplayer over WebSocket? `@remdom/dom` + `@remdom/server`. Headless browser as a remote DOM? Add `@remdom/puppeteer`. P2P via WebRTC? Bring your own transport.

## Examples

- **`examples/mirror/`** — In-page demo. Edit a source DOM, watch ops stream to a mirror pane in real-time. No server, no transport. Open the HTML file from disk to see how the observer/applier primitives work.

- **`examples/server-puppeteer/`** — Wires `@remdom/server` + `@remdom/puppeteer` into a working dev server. About 30 lines of code. Demonstrates how adapters compose.

```bash
# Install + build everything
git clone https://github.com/rlyshw/remdom.git
cd remdom
npm install -g pnpm
pnpm install
pnpm -r build

# Run the server-puppeteer example
node examples/server-puppeteer/index.js https://example.com
```

Open `http://localhost:3000` — multiple clients share the same session.

## What gets observed

| Op type | Captured by |
|---------|-------------|
| `childList` | MutationObserver (DOM tree changes) |
| `attributes` | MutationObserver (attribute changes) |
| `characterData` | MutationObserver (text content changes) |
| `property` | Prototype setter interception (input.value, .checked, etc.) |
| `snapshot` | Full DOM serialization (initial + periodic resync) |
| Shadow DOM | `Element.attachShadow` interception + nested observer |
| `document.title` | `Document.prototype.title` setter interception |

See [`packages/protocol/src/ops.ts`](packages/protocol/src/ops.ts) for full type definitions and [`docs/WIRE_FORMAT.md`](docs/WIRE_FORMAT.md) for the complete protocol.

## Docs

- **[Encoding the DOM](docs/PHILOSOPHY.md)** — how DOM encoding works, MutationObserver pipeline, what this enables
- **[Wire Format](docs/WIRE_FORMAT.md)** — complete protocol reference with JSON examples
- **[Architecture](docs/ARCHITECTURE.md)** — system design

## License

MIT
