# Wire Format

remote-dom uses JSON messages over WebSocket. Each message is a single JSON object with a `type` field that discriminates the op.

## Transport

- Protocol: WebSocket (RFC 6455)
- Encoding: UTF-8 JSON text frames
- Direction: bidirectional — server sends MutationOps, clients send InputOps

## Server → Client: MutationOps

### `snapshot`
Full DOM serialization. Sent on initial connection and after navigation.
```json
{
  "type": "snapshot",
  "html": "<html data-rdid=\"abc\">...</html>",
  "sessionId": "uuid"
}
```

### `childList`
Nodes added or removed from a parent.
```json
{
  "type": "childList",
  "targetId": "parent-rdid",
  "added": [
    { "id": "new-rdid", "type": 1, "tag": "div", "attrs": {"class": "foo"}, "children": [] }
  ],
  "removed": ["old-rdid-1", "old-rdid-2"],
  "beforeId": "sibling-rdid"
}
```

### `attributes`
An element's attribute changed.
```json
{
  "type": "attributes",
  "targetId": "element-rdid",
  "name": "class",
  "value": "active"
}
```
`value: null` means the attribute was removed.

### `characterData`
A text or comment node's content changed.
```json
{
  "type": "characterData",
  "targetId": "text-node-rdid",
  "data": "Updated text content"
}
```

### `property`
An element's DOM property changed (e.g., input value).
```json
{
  "type": "property",
  "targetId": "input-rdid",
  "prop": "value",
  "value": "user input"
}
```

### `navigated`
The server-side page navigated to a new URL.
```json
{
  "type": "navigated",
  "url": "https://example.com/new-page"
}
```

## Client → Server: InputOps

### Mouse events
```json
{ "type": "click",    "targetId": "rdid", "x": 340, "y": 220, "button": 0 }
{ "type": "dblclick", "targetId": "rdid", "x": 340, "y": 220, "button": 0 }
```
`button`: 0=left, 1=middle, 2=right. `x`/`y` are client viewport coordinates (informational — server resolves position by rdid).

### Keyboard events
```json
{ "type": "keydown",  "targetId": "rdid", "key": "Enter", "code": "Enter", "modifiers": 0 }
{ "type": "keyup",    "targetId": "rdid", "key": "Enter", "code": "Enter", "modifiers": 0 }
{ "type": "keypress", "targetId": "rdid", "key": "a",     "code": "KeyA",  "modifiers": 0 }
```
`modifiers` is a bitmask: SHIFT=1, CTRL=2, ALT=4, META=8.

### Input value
```json
{ "type": "input", "targetId": "rdid", "value": "typed text" }
```

### Scroll
```json
{ "type": "scroll", "targetId": "root", "scrollTop": 0.5, "scrollLeft": 0.0 }
```
Values are 0.0–1.0 (percentage of scrollable range) when syncing between clients of different sizes.

### Resize
```json
{ "type": "resize", "width": 1280, "height": 720 }
```

### Focus
```json
{ "type": "focus", "targetId": "rdid" }
{ "type": "blur",  "targetId": "rdid" }
```

### Navigate
```json
{ "type": "navigate", "url": "https://example.com" }
```

## Node identification

Every DOM element gets a `data-rdid` attribute (UUID v4) assigned server-side. Text and comment nodes are tracked by in-memory ID (included in `SerializedNode.id`).

The rdid is the stable handle for targeting nodes across the wire. Clients use `querySelector('[data-rdid="..."]')` to find elements. Text nodes are matched by walking the tree.

## SerializedNode

Used in `childList.added` to describe new DOM nodes:

```typescript
{
  id: string,       // rdid
  type: number,     // 1=element, 3=text, 8=comment
  tag?: string,     // "div", "a", etc (elements only)
  attrs?: Record<string, string>,
  children?: SerializedNode[],
  data?: string     // text content (text/comment only)
}
```
