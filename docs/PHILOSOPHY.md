# Encoding the DOM

The DOM is a complex, stationary data structure. It was designed to exist in one place — a browser tab — and be operated on in-place by JavaScript running in that same context. It is not transportable, not streamable, not observable from the outside.

remote-dom changes that. It encodes the DOM as a transportable, streamable data type — a sequence of structured operations that can be transmitted, applied, recorded, and acted on remotely.

## The encoding

A headless Chrome instance holds the authoritative DOM. An injected `MutationObserver` watches the entire document tree and serializes every change into typed JSON ops:

```
{ type: "childList",     targetId: "a1b2c3", added: [...], removed: [...], beforeId: "d4e5f6" }
{ type: "attributes",    targetId: "a1b2c3", name: "class", value: "active" }
{ type: "characterData", targetId: "x7y8z9", data: "Updated text" }
{ type: "snapshot",      html: "<html data-rdid=\"...\">...</html>", sessionId: "..." }
```

Every DOM node gets a stable identifier (`data-rdid`) assigned server-side. These IDs persist across mutations so clients can target specific nodes for updates without re-traversing the tree.

The initial connection sends a full `snapshot` — the complete serialized HTML with all `data-rdid` attributes in place. Subsequent changes stream as granular ops: a node added here, an attribute changed there, text content updated. The client applies these ops to its local DOM copy incrementally.

## How nodes are tracked

On the server, the injected script maintains two maps:

- `WeakMap<Node, string>` — node reference to rdid (for serializing mutations)
- `Map<string, Node>` — rdid to node reference (for input dispatch)

Element nodes carry their ID as a `data-rdid` attribute. Text and comment nodes (which can't have attributes) are tracked in-memory only, with their IDs included in the serialized `SerializedNode` payload:

```typescript
interface SerializedNode {
  id: string;        // stable rdid
  type: number;      // 1=element, 3=text, 8=comment
  tag?: string;      // "div", "span", etc (elements only)
  attrs?: Record<string, string>;
  children?: SerializedNode[];
  data?: string;     // text content (text/comment nodes only)
}
```

## The MutationObserver pipeline

Chrome's `MutationObserver` fires with batches of `MutationRecord` objects. The injected script maps these 1:1 to remote-dom ops:

| MutationRecord type | remote-dom op | Data captured |
|---|---|---|
| `childList` | `ChildListOp` | Added nodes (fully serialized), removed node IDs, insertion point |
| `attributes` | `AttributesOp` | Target ID, attribute name, new value (or null if removed) |
| `characterData` | `CharacterDataOp` | Target ID, new text content |

Ops are batched per `requestAnimationFrame` to avoid flooding the CDP channel during heavy DOM reconciliation (e.g., React re-renders). A single frame of React updates might produce dozens of `MutationRecord`s — these get serialized into a batch of ops and sent as one WebSocket message.

## Input dispatch

Input flows the opposite direction. Clients send `InputOp` messages identifying a target node by its `data-rdid`:

```
{ type: "click", targetId: "a1b2c3", x: 340, y: 220, button: 0 }
```

The server resolves the rdid to a live DOM node in Chrome, calls `getBoundingClientRect()` to find its viewport coordinates, scrolls it into view if needed, then dispatches the event via Puppeteer's CDP bindings (`page.mouse.click()`, `page.keyboard.press()`, etc.).

The client doesn't need to know Chrome's viewport dimensions or scroll state. It says "click node a1b2c3" and the server handles coordinate resolution.

## What gets stripped

Before a snapshot reaches the client, the server sanitizes it:

- `<script>` tags removed — Chrome already executed them; the client must not re-execute
- `<link rel="preload" as="script">` and `<link rel="modulepreload">` removed
- `<meta http-equiv="refresh">` removed — prevents client-side redirects
- `target="_blank"` removed from links — prevents new tab navigation in the client
- `<base href="...">` injected — rewrites relative CSS/image URLs to resolve against the original domain

The client receives a clean, static DOM that it renders natively with its own CSS engine. JavaScript execution happens only on the server.

## What this enables

The encoded DOM stream is a semantic wire. Unlike pixel streams, it can be consumed programmatically:

- **Parse:** extract all links, prices, form fields from the live page
- **Filter:** subscribe only to mutations within a specific subtree
- **Record:** log every DOM change as a structured audit trail
- **Replay:** reconstruct exact page state at any point in time
- **Branch:** fork a session and explore different interaction paths
- **Middleware:** insert processing between server and client — inject elements, modify content, translate

An agent reading DOM ops knows every element, attribute, and text node on the page. An agent reading pixel streams needs computer vision.

## DOM ops vs pixel streams

|  | DOM ops | Pixel streams |
|---|---|---|
| Wire format | JSON (~KB/s) | Video frames (~MB/s) |
| Client rendering | Native CSS engine | Decoded video |
| Text quality | Native, resolution-independent | Compressed, resolution-dependent |
| Scrolling | Native, smooth | Re-encoded per frame |
| Machine-readable | Yes — structured, typed | No — need OCR |
| Accessibility | Real DOM, screen readers work | Opaque pixels |
| Responsive layout | Client viewport controls CSS | Fixed to server viewport |
| Canvas/WebGL | Not captured | Captured |
| Shadow DOM | Not observed | Captured as pixels |
| Complex CSS effects | Some artifacts | Fully captured |

## Boundaries

The DOM was designed to be local. Encoding it for the network has real boundaries:

- **CSS layout is local.** `getComputedStyle`, `offsetWidth`, `getBoundingClientRect` are computed by the client's rendering engine relative to its viewport. The server can query these in Chrome's viewport, but they won't match the client's layout if viewports differ.
- **Shadow DOM is encapsulated.** `MutationObserver` on the document root cannot see into shadow trees. Web Components (GitHub's UI, YouTube's player) render internally in shadow DOM that never appears in the op stream.
- **Canvas is pixels.** `<canvas>`, WebGL, and video elements produce pixel content that has no DOM representation. The canvas element exists in the DOM but its rendered content does not.
- **JavaScript closures are local.** Event handlers, React state, framework internals — these exist in Chrome's JS heap and cannot be serialized. The client gets the DOM output, not the application state.

DOM streaming captures structure. Pixel streaming captures everything. The right tool depends on the use case.
