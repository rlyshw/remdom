import { resolve, join } from "node:path";
import { existsSync, watch } from "node:fs";
import { execSync } from "node:child_process";
import {
  createRemoteDomServer,
  createSession,
  getClientPage,
  loadFromDirectory,
  loadFromUrl,
} from "@remote-dom/server";
import type { Session } from "@remote-dom/server";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const ROOT = resolve(process.cwd());
const target = process.argv[2] || resolve(ROOT, "examples", "counter");
const isUrl = target.startsWith("http://") || target.startsWith("https://");

console.log(`[remote-dom] Loading from: ${target}`);

// Track current base URL for resolving relative navigation
let currentUrl = isUrl ? target : "";

// ── Load content and create session ──

async function loadSession(url?: string): Promise<Session> {
  const loadTarget = url ?? target;
  const loadIsUrl = loadTarget.startsWith("http://") || loadTarget.startsWith("https://");

  const content = loadIsUrl
    ? await loadFromUrl(loadTarget)
    : loadFromDirectory(resolve(loadTarget));

  return createSession({
    html: content.html,
    appCode: content.scripts ?? undefined,
    baseUrl: loadIsUrl ? loadTarget : undefined,
    onNavigate: async (href, sess) => {
      try {
        const resolvedUrl = currentUrl
          ? new URL(href, currentUrl).href
          : href;

        console.log(`[remote-dom] Navigating to: ${resolvedUrl}`);
        currentUrl = resolvedUrl;

        const newContent = await loadFromUrl(resolvedUrl);
        sess.reload(newContent.html, newContent.scripts ?? undefined, resolvedUrl);

        // Tell clients which URL we ended up at
        const msg = JSON.stringify({ type: "navigated", url: resolvedUrl });
        for (const ws of sess.subscribers) {
          if (ws.readyState === ws.OPEN) ws.send(msg);
        }
      } catch (err) {
        console.error(`[remote-dom] Navigation failed:`, err);
        // Tell clients navigation failed
        const msg = JSON.stringify({ type: "navigated", url: currentUrl || href });
        for (const ws of sess.subscribers) {
          if (ws.readyState === ws.OPEN) ws.send(msg);
        }
      }
    },
  });
}

let session = await loadSession();

// ── Create server ──

const clientHtml = getClientPage({
  title: "remote-dom",
  urlBar: true,
  bookmarks: [
    { label: "HN", url: "https://news.ycombinator.com" },
    { label: "Wikipedia", url: "https://en.wikipedia.org" },
    { label: "Reddit", url: "https://old.reddit.com" },
    { label: "Example", url: "https://example.com" },
    { label: "Lobsters", url: "https://lobste.rs" },
    { label: "Lite CNN", url: "https://lite.cnn.com" },
    { label: "NPR", url: "https://text.npr.org" },
  ],
});

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

// ── File watcher (local mode only) ──

if (!isUrl) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function onFileChange(filepath: string) {
    if (filepath.includes("dist") || filepath.includes("node_modules")) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      console.log(`[remote-dom] Change detected: ${filepath}`);

      const isSource = filepath.includes("packages");
      if (isSource) {
        try {
          console.log("[remote-dom] Rebuilding...");
          execSync("pnpm -r build", { cwd: ROOT, stdio: "pipe" });
          console.log("[remote-dom] Build complete");
        } catch (err: any) {
          console.error("[remote-dom] Build failed:", err.stderr?.toString() ?? err.message);
          return;
        }
      }

      server.removeSession("default");
      session = await loadSession();
      server.addSession("default", session);

      const reloadMsg = JSON.stringify({ type: "reload" });
      for (const ws of server.fanout.wss.clients) {
        if (ws.readyState === ws.OPEN) ws.send(reloadMsg);
      }
      console.log("[remote-dom] Reloaded");
    }, 200);
  }

  for (const dir of ["packages", "examples", target]) {
    const watchPath = dir.startsWith("/") || dir.includes(":") ? dir : join(ROOT, dir);
    if (existsSync(watchPath)) {
      watch(watchPath, { recursive: true }, (_event, filename) => {
        if (filename) onFileChange(join(dir, filename));
      });
    }
  }
}

server.listen(PORT, () => {
  console.log(`[remote-dom] Server running at http://localhost:${PORT}`);
  if (!isUrl) console.log("[remote-dom] Watching for changes...");
});
