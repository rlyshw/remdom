/**
 * server-puppeteer example.
 *
 * Wires @remdom/server (WebSocket fanout) + @remdom/puppeteer (headless Chrome)
 * into a dev server. Run with:
 *
 *   node examples/server-puppeteer/index.js https://example.com
 */

import { createRemoteDomServer, getClientPage } from "@remdom/server";
import { createBrowserPool, createPuppeteerSession } from "@remdom/puppeteer";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const target = process.argv[2] ?? "https://example.com";

console.log(`[example] Target: ${target}`);

// Spin up Chrome and create a session
const pool = await createBrowserPool({ mode: "launch" });
const page = await pool.acquirePage({ width: 1280, height: 720 });

let currentUrl = target;
const session = await createPuppeteerSession({
  page,
  url: target,
  onNavigate: async (href, sess) => {
    try {
      const resolvedUrl = currentUrl ? new URL(href, currentUrl).href : href;
      console.log(`[example] Navigating: ${resolvedUrl}`);
      currentUrl = resolvedUrl;
      await sess.reload(resolvedUrl);
    } catch (err) {
      console.error(`[example] Navigation failed:`, err.message);
    }
  },
});

// Create the WebSocket server and add the session
const clientHtml = getClientPage({ title: "remdom" });
const server = createRemoteDomServer({
  onRequest: (req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(clientHtml);
      return true;
    }
    return false;
  },
});
server.addSession("default", session);

// Cleanup on exit
const shutdown = async () => {
  await session.destroy();
  await pool.destroy();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, () => {
  console.log(`[example] http://localhost:${PORT}`);
});
