import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createFanout, type Fanout } from "./fanout.js";
import type { Session } from "./session.js";

// Re-exports
export { createSession } from "./session.js";
export { createDomBridge, linkedomProvider } from "./dom-bridge.js";
export { dispatchInputOp } from "./input-handler.js";
export { createFanout } from "./fanout.js";
export { createIsolate } from "./isolate-pool.js";
export { installScriptInterceptor } from "./script-interceptor.js";
export { createBrowserEnv } from "./browser-env.js";
export { createPuppeteerBridge } from "./puppeteer-bridge.js";
export { createPuppeteerSession } from "./puppeteer-session.js";
export { createBrowserPool } from "./browser-pool.js";
export type { PuppeteerBridge } from "./puppeteer-bridge.js";
export type { PuppeteerSession, PuppeteerSessionOptions } from "./puppeteer-session.js";
export type { BrowserPool, BrowserPoolOptions } from "./browser-pool.js";
export { getClientPage } from "./client-page.js";
export { loadFromDirectory, loadFromUrl, extractScripts } from "./content.js";

export type { Session, SessionOptions } from "./session.js";
export type { DomBridge, DomProvider, MutationCallback } from "./dom-bridge.js";
export type { Fanout } from "./fanout.js";
export type { Isolate } from "./isolate-pool.js";
export type { ClientPageOptions } from "./client-page.js";
export type { LoadedContent } from "./content.js";

export interface ServerOptions {
  /**
   * Route WebSocket connections to session IDs.
   * Default: always returns "default".
   */
  getSessionId?: (req: IncomingMessage) => string;

  /** HTTP request handler for serving pages, assets, etc. */
  onRequest?: (req: IncomingMessage, res: ServerResponse) => boolean;
}

export interface RemoteDomServer {
  sessions: Map<string, Session>;
  addSession(id: string, session: Session): void;
  removeSession(id: string): void;
  httpServer: ReturnType<typeof createServer>;
  fanout: Fanout;
  listen(port: number, cb?: () => void): void;
  close(): void;
}

export function createRemoteDomServer(
  options: ServerOptions = {}
): RemoteDomServer {
  const {
    getSessionId = () => "default",
    onRequest,
  } = options;

  const sessions = new Map<string, Session>();

  const httpServer = createServer((req, res) => {
    if (onRequest && onRequest(req, res)) return;
    res.writeHead(404);
    res.end("Not Found");
  });

  const fanout = createFanout(httpServer, (req) => {
    const sessionId = getSessionId(req);
    return sessions.get(sessionId) ?? null;
  });

  return {
    sessions,

    addSession(id: string, session: Session) {
      sessions.set(id, session);
    },

    removeSession(id: string) {
      const session = sessions.get(id);
      if (session) {
        session.destroy();
        sessions.delete(id);
      }
    },

    httpServer,
    fanout,

    listen(port: number, cb?: () => void) {
      httpServer.listen(port, cb);
    },

    close() {
      for (const session of sessions.values()) {
        session.destroy();
      }
      sessions.clear();
      fanout.destroy();
      httpServer.close();
    },
  };
}
