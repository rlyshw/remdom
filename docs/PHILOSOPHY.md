# Why encode the DOM?

The DOM is the most important data structure in computing. Billions of people interact with DOMs daily. And it's completely local, ephemeral, and opaque. When you close the tab, it's gone. No one else can see it. No program can observe it in real-time unless it's running inside that same tab.

remote-dom makes the DOM a shared, network-transparent data structure.

## What this changes

**The DOM becomes an API.** Today, to interact with a website programmatically, you either scrape it (lossy, brittle) or use their API (if one exists). With an encoded DOM stream, the website's rendered state IS the API. Any program that can read JSON can read the DOM.

**The DOM becomes persistent.** You can serialize, store, replay, diff. A browsing session becomes a log of structured operations. You can rewind to any point. You can diff two sessions. You can branch.

**The DOM becomes multi-tenant.** Multiple consumers read the same DOM state without interfering. Today, if two scripts try to manipulate the same page, they fight. With a server-authoritative DOM, there's one source of truth and N observers.

## Sheet music, not audio

DOM streaming is like streaming sheet music instead of an audio recording — the client still has to "perform" the rendering locally.

This is both the limitation and the advantage:

**Limitation:** We stream structure and content, not the full rendering experience. CSS layout is computed locally. Canvas pixels aren't captured. The client must be capable of rendering HTML/CSS.

**Advantage:** The stream is semantic. We know "a button was added," not "pixels changed at coordinates 340,220." The client renders natively — crisp text, native scrolling, accessibility works, responsive layout adapts to the device. And the data on the wire is 100x smaller than video.

## DOM ops vs pixel streams

| | DOM streaming | Pixel streaming (VNC, Mighty, etc.) |
|---|---|---|
| Bandwidth | Low (JSON ops, KB/s) | High (video frames, MB/s) |
| Latency | Low (small ops, instant apply) | Higher (encode/decode video) |
| Text rendering | Native, crisp | Compressed, blurry at low bitrate |
| Scrolling | Native, smooth | Re-encoded on every frame |
| Accessibility | Works (real DOM) | Broken (just pixels) |
| Responsive | Client viewport controls layout | Fixed to server viewport |
| Machine-readable | Yes (structured ops) | No (need OCR) |
| Canvas/WebGL | Not captured | Captured |
| Complex CSS effects | Some lost in translation | Fully captured |
| Shadow DOM | Not observed | Captured as pixels |

## The middleware insight

The encoded DOM stream creates something that doesn't exist today: **middleware for web browsing.**

You can't put a proxy between a user and their DOM that understands what's happening semantically. With DOM ops, you can:

- **Parse:** "What links are on this page?"
- **Filter:** "Only show me mutations to the cart div."
- **Modify:** "Inject a price comparison widget into every product page."
- **Record:** "Log every DOM change as a structured audit trail."
- **Branch:** "Fork this session — let two people explore different paths."
- **Replay:** "Show me exactly what the page looked like at 2:43 PM."

This is why DOM streaming matters for AI agents specifically. An agent that receives pixel streams needs computer vision to understand a page. An agent that receives DOM ops can simply read the HTML — it already knows every element, every attribute, every text node.

## Honest limitations

The DOM was designed to be local. By lifting it to the server, we break assumptions the entire web stack is built on:

- CSS layout depends on local viewport dimensions
- JavaScript assumes single-threaded local DOM access
- Events assume a single input source
- Canvas, WebGL, and video are pixel-based by nature
- Shadow DOM creates encapsulated subtrees the observer can't see into
- JavaScript closures hold references to local DOM nodes that can't be serialized

These aren't bugs to fix — they're fundamental to the web's architecture. DOM streaming works best for content-driven pages (text, forms, navigation) and degrades for pixel-driven experiences (games, video, complex visualizations). The right answer for those is pixel streaming, or a hybrid approach.

## Who this is for

- **Agent builders** who need programmatic web interaction with human observability
- **Tool builders** who want to put intelligence between users and websites
- **Automation engineers** who want structured access to live web state
- **Anyone building on the web** who's thought "I wish I could just read/write the DOM from anywhere"
