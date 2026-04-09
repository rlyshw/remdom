# remdom

**Stream the entire DOM as structured mutation ops.**

Observe every mutation to a live document — anywhere in the tree — and encode it as a structured op stream. Not a subtree, not a virtual DOM: the real browser DOM, from `<html>` down. Virtualize and stream it between any source and any number of clients.

> The DOM is a complex, stationary data structure — designed to live in one place and be operated on in-place. remdom breaks that restriction. It encodes the DOM as a transportable, streamable data type that can be operated on remotely.
>
> [Read more: Encoding the DOM →](docs/PHILOSOPHY.md)

---

## How it works

`@remdom/dom` provides two primitives. **Observer** attaches a `MutationObserver` to the document root, assigns stable IDs to every node, and emits a structured op for every mutation anywhere in the tree — added elements, removed elements, attribute changes, text content changes, input state, shadow DOM, document title. **Applier** takes those ops and applies them to another DOM, reconstructing the full source document.

This is whole-document streaming. The observer watches the entire DOM, not a subtree or a virtual DOM. Every change to every node becomes an op on the wire.

```typescript
import { createObserver, DomApplier } from '@remdom/dom';

// Source side — observe a DOM, emit ops via callback
const observer = createObserver({
  root: document.documentElement,
  onOps: (ops) => transport.send(ops),
});
observer.snapshot();

// Receiver side — apply incoming ops to a target DOM
const applier = new DomApplier(targetContainer);
transport.onMessage = (ops) => ops.forEach(op => applier.apply(op));
```

`createInputCapture` does the reverse — capture user input events from a DOM and emit `InputOp`s for the source side to dispatch. Together they give you bidirectional DOM sync.

The framework is transport-agnostic. The `transport` in the example above is whatever you want: WebSocket, WebRTC, postMessage, an in-process function call, a file. Bring your own.

**[Try the live mirror demo →](https://rlyshw.github.io/remdom/mirror.html)** — observer and applier running side-by-side in one page.

## Packages

| Package | Purpose |
|---------|---------|
| `@remdom/protocol` | Op type definitions and JSON codec |
| `@remdom/dom` | Observer, Applier, Input primitives — the framework |
| `@remdom/server` | WebSocket fanout server (Node) |
| `@remdom/puppeteer` | Headless Chrome DOM source (Node) |
| `@remdom/client` | Browser-side WebSocket client wrapper |

`protocol` and `dom` are the framework. The others are adapters for specific transports and DOM sources. Use any subset that fits your stack.

## Examples

- **[`examples/mirror/`](examples/mirror/)** — Observer and applier in a single page. Edit the source DOM, watch ops stream to the mirror in real-time. Open the HTML file from disk, no install required. Also live at [rlyshw.github.io/remdom/mirror.html](https://rlyshw.github.io/remdom/mirror.html).

- **[`examples/server-puppeteer/`](examples/server-puppeteer/)** — Node script wiring `@remdom/server` + `@remdom/puppeteer` into a dev server. Run it, open multiple browser tabs, all clients share the same session.

```bash
git clone https://github.com/rlyshw/remdom.git
cd remdom
npm install -g pnpm
pnpm install
pnpm -r build

node examples/server-puppeteer/index.js https://example.com
```

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
