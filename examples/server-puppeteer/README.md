# server-puppeteer example

Wire `@remdom/server` (WebSocket fanout) + `@remdom/puppeteer` (headless Chrome backend) into a working dev server. About 30 lines of code.

This is a **demonstration of how adapters compose**. The framework itself is just `@remdom/dom`. This example shows what it looks like to combine adapters into a useful workflow.

## Run it

```bash
# From the repo root
pnpm -r build
node examples/server-puppeteer/index.js https://example.com
```

Open `http://localhost:3000` in multiple browsers. They share the same Chrome session.

## What it does

1. Spins up a headless Chrome via `@remdom/puppeteer`
2. Navigates to the URL you provide
3. Wraps the page in a `PuppeteerSession` (which observes DOM mutations and dispatches input)
4. Wraps the session in a `RemoteDomServer` (HTTP + WebSocket fanout)
5. Serves a minimal client page that connects via WebSocket and renders the streamed DOM

Multiple clients connect to the same session. Click links, type in forms, scroll — every client sees the same view because the DOM lives in Chrome on the server.

## Build your own backend

This example uses Puppeteer. You could swap it for anything that implements the `Session` interface from `@remdom/server`:

- jsdom (in-process fake DOM, no Chrome)
- Cloudflare Browser Rendering (Puppeteer-compatible API on edge)
- WebDriver / CDP connection to a remote browser
- A custom DOM source — anything that can produce ops

The framework doesn't care where ops come from. It just streams them.
