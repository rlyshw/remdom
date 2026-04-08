import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { MutationOp, InputOp } from "@remote-dom/protocol";
import { jsonCodec, type Codec } from "@remote-dom/protocol";
import {
  createDomBridge,
  type DomBridge,
  type DomProvider,
} from "./dom-bridge.js";
import { dispatchInputOp } from "./input-handler.js";
import { installScriptInterceptor } from "./script-interceptor.js";
import { createBrowserEnv, type BrowserEnv } from "./browser-env.js";

export interface SessionOptions {
  html: string;
  appCode?: string | ((document: any, window: any) => void);
  domProvider?: DomProvider;
  codec?: Codec;
  onNavigate?: (url: string, session: Session) => void;
  /** Base URL for resolving relative script/asset URLs (used by script interceptor) */
  baseUrl?: string;
}

export interface Session {
  id: string;
  bridge: DomBridge;
  subscribers: Set<WebSocket>;
  loadApp(appFn: (document: any, window: any) => void): void;
  addClient(ws: WebSocket): void;
  removeClient(ws: WebSocket): void;
  handleInput(op: InputOp, fromWs?: any): void;
  reload(html: string, appCode?: string | ((document: any, window: any) => void), baseUrl?: string): void;
  destroy(): void;
}

export function createSession(options: SessionOptions | string): Session {
  const opts: SessionOptions =
    typeof options === "string" ? { html: options } : options;
  const codec = opts.codec ?? jsonCodec;

  const id = randomUUID();
  let bridge = createDomBridge(opts.html, opts.domProvider);
  const subscribers = new Set<WebSocket>();
  let unsubMutation: (() => void) | null = null;
  let uninstallInterceptor: (() => void) | null = null;
  let browserEnv: BrowserEnv | null = null;

  function wireUpMutations() {
    unsubMutation?.();
    unsubMutation = bridge.onMutation((op: MutationOp) => {
      const encoded = codec.encode(op);
      for (const ws of subscribers) {
        if (ws.readyState === ws.OPEN) {
          ws.send(encoded);
        }
      }
    });
  }

  wireUpMutations();

  const flushInterval = setInterval(() => {
    if (subscribers.size > 0) {
      bridge.flush();
    }
  }, 50);

  function ensureBrowserEnv(baseUrl?: string): BrowserEnv {
    if (!browserEnv) {
      browserEnv = createBrowserEnv(bridge.document, bridge.window, baseUrl ?? opts.baseUrl);
    }
    return browserEnv;
  }

  /** Strip ES module syntax so code can run in new Function() */
  function demodulize(code: string): string {
    return code
      // Remove import statements (static imports)
      .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]*['"];?\s*$/gm, "")
      .replace(/^\s*import\s+['"][^'"]*['"];?\s*$/gm, "")
      // Remove export default
      .replace(/^\s*export\s+default\s+/gm, "")
      // Remove export { ... }
      .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
      // Replace export before declarations
      .replace(/^\s*export\s+(const|let|var|function|class|async\s+function)\s/gm, "$1 ");
  }

  /** Execute a string of JS in the session's document context */
  function execInContext(code: string, _sourceUrl?: string) {
    const env = ensureBrowserEnv();
    const names = Object.keys(env.globals);
    const values = Object.values(env.globals);

    // Try original code first, fall back to demodulized
    let execCode = code;
    try {
      new Function(...names, execCode);
    } catch {
      execCode = demodulize(code);
    }

    try {
      const fn = new Function(...names, execCode);
      fn(...values);
    } catch (err) {
      // Non-fatal
    }
  }

  function installInterceptor(baseUrl?: string) {
    uninstallInterceptor?.();
    uninstallInterceptor = installScriptInterceptor({
      document: bridge.document,
      execScript: execInContext,
      baseUrl,
      onScriptLoad: (src) => {
        // Flush after each script loads — it may have mutated the DOM
        bridge.flush();
      },
      onScriptError: (src, err) => {
        console.warn(`[session] Script load failed: ${src} — ${err.message}`);
      },
    });
  }

  function execAppCode(appCode: string | ((document: any, window: any) => void)) {
    if (typeof appCode === "string") {
      execInContext(appCode, "appCode");
    } else {
      session.loadApp(appCode);
    }
  }

  function broadcastSnapshot() {
    const snapshot: MutationOp = {
      type: "snapshot",
      html: bridge.getSnapshot(),
      sessionId: id,
    };
    const encoded = codec.encode(snapshot);
    for (const ws of subscribers) {
      if (ws.readyState === ws.OPEN) {
        ws.send(encoded);
      }
    }
  }

  const session: Session = {
    id,
    bridge,
    subscribers,

    loadApp(appFn: (document: any, window: any) => void) {
      appFn(bridge.document, bridge.window);
      bridge.flush();
    },

    addClient(ws: WebSocket) {
      subscribers.add(ws);
      const snapshot: MutationOp = {
        type: "snapshot",
        html: bridge.getSnapshot(),
        sessionId: id,
      };
      ws.send(codec.encode(snapshot));
    },

    removeClient(ws: WebSocket) {
      subscribers.delete(ws);
    },

    handleInput(op: InputOp, fromWs?: any) {
      if (op.type === "navigate") {
        opts.onNavigate?.(op.url, session);
        return;
      }
      // Scroll is a side-channel — relay to other clients, skip DOM dispatch
      if (op.type === "scroll") {
        const msg = codec.encode(op as any);
        for (const ws of subscribers) {
          if (ws !== fromWs && ws.readyState === ws.OPEN) {
            ws.send(msg);
          }
        }
        return;
      }
      dispatchInputOp(bridge, op);
    },

    reload(html: string, appCode?: string | ((document: any, window: any) => void), baseUrl?: string) {
      uninstallInterceptor?.();
      browserEnv?.destroy();
      browserEnv = null;
      bridge.destroy();
      bridge = createDomBridge(html, opts.domProvider);
      session.bridge = bridge;
      wireUpMutations();
      const newBaseUrl = baseUrl ?? opts.baseUrl;
      ensureBrowserEnv(newBaseUrl);
      if (newBaseUrl) browserEnv!.setBaseUrl(newBaseUrl);
      installInterceptor(newBaseUrl);
      if (appCode) {
        try {
          execAppCode(appCode);
        } catch (err) {
          console.warn("[session] App code error on reload (non-fatal):", (err as Error).message);
        }
      }
      broadcastSnapshot();
    },

    destroy() {
      clearInterval(flushInterval);
      unsubMutation?.();
      uninstallInterceptor?.();
      browserEnv?.destroy();
      browserEnv = null;
      for (const ws of subscribers) {
        ws.close();
      }
      subscribers.clear();
      bridge.destroy();
    },
  };

  // Install script interceptor
  installInterceptor(opts.baseUrl);

  // Execute initial app code
  if (opts.appCode) {
    execAppCode(opts.appCode);
  }

  return session;
}
