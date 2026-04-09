import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { MutationOp, InputOp } from "@remote-dom/protocol";
import { jsonCodec, type Codec } from "@remote-dom/protocol";
import {
  createPuppeteerBridge,
  type PuppeteerBridge,
} from "./puppeteer-bridge.js";
import type { Page } from "puppeteer-core";

/** Strip content that shouldn't run on the client */
function sanitizeForClient(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[^>]*\/>/gi, "")
    .replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "")
    .replace(/<link[^>]*rel\s*=\s*["']?preload["']?[^>]*as\s*=\s*["']?script["']?[^>]*>/gi, "")
    .replace(/<link[^>]*rel\s*=\s*["']?modulepreload["']?[^>]*>/gi, "")
    .replace(/\starget\s*=\s*["']_blank["']/gi, "");
}

export interface PuppeteerSessionOptions {
  /** Puppeteer Page to use */
  page: Page;
  /** Initial URL to navigate to */
  url: string;
  /** Wire codec (default: jsonCodec) */
  codec?: Codec;
  /** Called when a client clicks a link */
  onNavigate?: (url: string, session: PuppeteerSession) => void;
}

export interface PuppeteerSession {
  id: string;
  type: "puppeteer";
  bridge: PuppeteerBridge;
  subscribers: Set<WebSocket>;
  addClient(ws: WebSocket): void;
  removeClient(ws: WebSocket): void;
  handleInput(op: InputOp, fromWs?: any): Promise<void>;
  reload(url: string): Promise<void>;
  destroy(): Promise<void>;
}

export async function createPuppeteerSession(
  options: PuppeteerSessionOptions
): Promise<PuppeteerSession> {
  const { page, url, codec = jsonCodec, onNavigate } = options;

  const id = randomUUID();
  const subscribers = new Set<WebSocket>();

  const bridge = await createPuppeteerBridge(page, url);

  // Forward mutations to all subscribers, injecting <base> into snapshots
  bridge.onMutation((op: MutationOp) => {
    let finalOp = op;
    if (op.type === "snapshot") {
      const baseTag = `<base href="${bridge.pageUrl}">`;
      let html = sanitizeForClient(op.html);
      html = html.includes("<head")
        ? html.replace(/<head[^>]*>/, `$&${baseTag}`)
        : html;
      finalOp = { ...op, html };
    }
    const encoded = codec.encode(finalOp);
    for (const ws of subscribers) {
      if (ws.readyState === ws.OPEN) {
        ws.send(encoded);
      }
    }
  });

  const session: PuppeteerSession = {
    id,
    type: "puppeteer",
    bridge,
    subscribers,

    addClient(ws: WebSocket) {
      subscribers.add(ws);
      // Send current page as snapshot with <base> tag for asset resolution
      bridge.getSnapshot().then((rawHtml) => {
        const baseTag = `<base href="${bridge.pageUrl}">`;
        let html = sanitizeForClient(rawHtml);
        const withBase = html.includes("<head")
          ? html.replace(/<head[^>]*>/, `$&${baseTag}`)
          : `<head>${baseTag}</head>${html}`;
        const snapshot: MutationOp = {
          type: "snapshot",
          html: withBase,
          sessionId: id,
        };
        if (ws.readyState === ws.OPEN) {
          ws.send(codec.encode(snapshot));
        }
      });
    },

    removeClient(ws: WebSocket) {
      subscribers.delete(ws);
    },

    async handleInput(op: InputOp, fromWs?: any) {
      if (op.type === "navigate") {
        onNavigate?.(op.url, session);
        return;
      }

      // Scroll sync — relay to other clients
      if (op.type === "scroll") {
        const msg = codec.encode(op as any);
        for (const ws of subscribers) {
          if (ws !== fromWs && ws.readyState === ws.OPEN) {
            ws.send(msg);
          }
        }
        // Also apply to Chrome page
        try { await bridge.dispatchInput(op); } catch {}
        return;
      }

      try {
        await bridge.dispatchInput(op);
      } catch (err) {
        console.warn("[puppeteer-session] Input dispatch error:", (err as Error).message);
      }
    },

    async reload(newUrl: string) {
      await bridge.navigate(newUrl);
      // Notify clients of the new URL
      const msg = codec.encode({
        type: "navigated",
        url: newUrl,
      } as any);
      for (const ws of subscribers) {
        if (ws.readyState === ws.OPEN) {
          ws.send(msg);
        }
      }
    },

    async destroy() {
      for (const ws of subscribers) {
        ws.close();
      }
      subscribers.clear();
      await bridge.destroy();
    },
  };

  return session;
}
