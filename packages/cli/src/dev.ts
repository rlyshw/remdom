import { resolve, join } from "node:path";
import { existsSync, watch } from "node:fs";
import { execSync } from "node:child_process";
import {
  createRemoteDomServer,
  createSession,
  getClientPage,
  loadFromDirectory,
  loadFromUrl,
  createBrowserPool,
  createPuppeteerSession,
} from "@remote-dom/server";
import type { Session, PuppeteerSession } from "@remote-dom/server";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const ROOT = resolve(process.cwd());

// Parse args
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
const useLinkedom = flags.includes("--linkedom");

const target = args[0] || "https://news.ycombinator.com";
const isUrl = target.startsWith("http://") || target.startsWith("https://");

console.log(`[remote-dom] Mode: ${useLinkedom ? "linkedom" : "puppeteer"}`);
console.log(`[remote-dom] Target: ${target}`);

let currentUrl = isUrl ? target : "";
type AnySession = Session | PuppeteerSession;
let session: AnySession;

if (!useLinkedom) {
  // ── Puppeteer mode (default) ──
  const pool = await createBrowserPool({ mode: "launch" });
  const page = await pool.acquirePage({ width: 1280, height: 720 });

  session = await createPuppeteerSession({
    page,
    url: isUrl ? target : "about:blank",
    onNavigate: async (href, sess) => {
      try {
        const resolvedUrl = currentUrl
          ? new URL(href, currentUrl).href
          : href;
        console.log(`[remote-dom] Navigating to: ${resolvedUrl}`);
        currentUrl = resolvedUrl;
        await sess.reload(resolvedUrl);
      } catch (err) {
        console.error(`[remote-dom] Navigation failed:`, (err as Error).message);
      }
    },
  });

  // Handle Chrome crashes
  page.on("error", async (err) => {
    console.error("[remote-dom] Chrome page crashed:", err.message);
    console.log("[remote-dom] Restarting page...");
    try {
      const newPage = await pool.acquirePage({ width: 1280, height: 720 });
      const newSession = await createPuppeteerSession({
        page: newPage,
        url: currentUrl || target,
        onNavigate: async (href, sess) => {
          try {
            console.log(`[remote-dom] Navigating to: ${href}`);
            currentUrl = href;
            await sess.reload(href);
          } catch (err) {
            console.error(`[remote-dom] Navigation failed:`, (err as Error).message);
          }
        },
      });
      server.removeSession("default");
      session = newSession;
      server.addSession("default", session as any);
      console.log("[remote-dom] Page restarted");
    } catch (restartErr) {
      console.error("[remote-dom] Failed to restart:", (restartErr as Error).message);
    }
  });

  process.on("SIGINT", async () => {
    await session.destroy();
    await pool.destroy();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await session.destroy();
    await pool.destroy();
    process.exit(0);
  });
} else {
  // ── Linkedom mode (lightweight fallback) ──
  async function loadLinkedomSession(): Promise<Session> {
    const content = isUrl
      ? await loadFromUrl(target)
      : loadFromDirectory(resolve(target));
    return createSession({
      html: content.html,
      appCode: content.scripts ?? undefined,
      baseUrl: isUrl ? target : undefined,
      onNavigate: async (href, sess) => {
        try {
          const resolvedUrl = currentUrl ? new URL(href, currentUrl).href : href;
          console.log(`[remote-dom] Navigating to: ${resolvedUrl}`);
          currentUrl = resolvedUrl;
          const newContent = await loadFromUrl(resolvedUrl);
          sess.reload(newContent.html, newContent.scripts ?? undefined, resolvedUrl);
          const msg = JSON.stringify({ type: "navigated", url: resolvedUrl });
          for (const ws of sess.subscribers) {
            if (ws.readyState === ws.OPEN) ws.send(msg);
          }
        } catch (err) {
          console.error(`[remote-dom] Navigation failed:`, (err as Error).message);
        }
      },
    });
  }

  session = await loadLinkedomSession();

  if (!isUrl) {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function onFileChange(filepath: string) {
      if (filepath.includes("dist") || filepath.includes("node_modules")) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        console.log(`[remote-dom] Change detected: ${filepath}`);
        if (filepath.includes("packages")) {
          try {
            execSync("pnpm -r build", { cwd: ROOT, stdio: "pipe" });
          } catch (err: any) {
            console.error("[remote-dom] Build failed:", err.stderr?.toString() ?? err.message);
            return;
          }
        }
        server.removeSession("default");
        session = await loadLinkedomSession();
        server.addSession("default", session);
        const reloadMsg = JSON.stringify({ type: "reload" });
        for (const ws of server.fanout.wss.clients) {
          if (ws.readyState === ws.OPEN) ws.send(reloadMsg);
        }
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
}

// ── Server ──

const clientHtml = getClientPage({
  title: "remote-dom",
  urlBar: true,
  bookmarks: [
    { label: "HN", url: "https://news.ycombinator.com" },
    { label: "Wikipedia", url: "https://en.wikipedia.org" },
    { label: "GitHub", url: "https://github.com" },
    { label: "Reddit", url: "https://old.reddit.com" },
    { label: "Lobsters", url: "https://lobste.rs" },
    { label: "Example", url: "https://example.com" },
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

server.addSession("default", session as any);

server.listen(PORT, () => {
  console.log(`[remote-dom] http://localhost:${PORT}`);
});
