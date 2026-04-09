import type { Page } from "puppeteer-core";
import type { MutationOp, InputOp } from "@remote-dom/protocol";
import { INJECTED_SCRIPT } from "./puppeteer-injected.js";
import { dispatchPuppeteerInput } from "./puppeteer-input.js";

export type MutationCallback = (op: MutationOp) => void;

export interface PuppeteerBridge {
  page: Page;
  pageUrl: string;
  getSnapshot(): Promise<string>;
  onMutation(cb: MutationCallback): () => void;
  dispatchInput(op: InputOp): Promise<void>;
  navigate(url: string): Promise<void>;
  resize(width: number, height: number): Promise<void>;
  destroy(): Promise<void>;
}

export async function createPuppeteerBridge(
  page: Page,
  initialUrl: string
): Promise<PuppeteerBridge> {
  const listeners = new Set<MutationCallback>();
  let currentUrl = initialUrl;
  let destroyed = false;

  function emit(op: MutationOp) {
    if (destroyed) return;
    for (const cb of listeners) {
      cb(op);
    }
  }

  // Expose the function that the injected script calls to send ops back
  await page.exposeFunction("__rdm_sendOps", (opsJson: string) => {
    if (destroyed) return;
    try {
      const ops: MutationOp[] = JSON.parse(opsJson);
      for (const op of ops) {
        emit(op);
      }
    } catch (err) {
      console.error("[puppeteer-bridge] Failed to parse ops:", err);
    }
  });

  // Inject the observer script on every new document (survives navigations)
  await page.evaluateOnNewDocument(INJECTED_SCRIPT);

  // Navigate to the initial URL
  try {
    await page.goto(initialUrl, { waitUntil: "networkidle2", timeout: 30000 });
  } catch {
    // Timeout is OK — page might have long-polling connections
  }
  currentUrl = initialUrl;

  // Listen for navigations to update currentUrl
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      currentUrl = frame.url();
    }
  });

  // Forward Chrome console to server stdout (filter noise)
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warn") {
      const text = msg.text();
      // Skip noisy CSP/cookie/manifest warnings
      if (text.includes("Content Security Policy") ||
          text.includes("cookie") ||
          text.includes("Manifest:") ||
          text.includes("deprecated")) return;
      console.log(`[chrome:${type}] ${text.slice(0, 200)}`);
    }
  });

  // Forward page errors
  page.on("pageerror", (err) => {
    console.log(`[chrome:error] ${String(err)}`);
  });

  // Handle dialogs (alert/confirm/prompt) — auto-dismiss
  page.on("dialog", async (dialog) => {
    try {
      await dialog.dismiss();
    } catch {}
  });

  const bridge: PuppeteerBridge = {
    page,
    get pageUrl() {
      return currentUrl;
    },

    async getSnapshot(): Promise<string> {
      const html = await page.content();
      return html;
    },

    onMutation(cb: MutationCallback): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async dispatchInput(op: InputOp): Promise<void> {
      await dispatchPuppeteerInput(page, op);
    },

    async navigate(url: string): Promise<void> {
      currentUrl = url;
      try {
        const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => null);
        const contentType = response?.headers()?.["content-type"] ?? "";
        if (contentType.startsWith("image/")) {
          await page.setContent(
            `<html><head><title>${url}</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111"><img src="${url}" style="max-width:100%;max-height:100vh;object-fit:contain"></body></html>`,
            { waitUntil: "domcontentloaded" }
          );
        }
        // Re-inject observer and send snapshot in case evaluateOnNewDocument didn't fire
        try {
          await page.evaluate(INJECTED_SCRIPT);
        } catch {}
      } catch (err) {
        console.warn("[puppeteer-bridge] Navigation error:", (err as Error).message);
      }
    },

    async resize(width: number, height: number): Promise<void> {
      await page.setViewport({ width, height });
    },

    async destroy(): Promise<void> {
      destroyed = true;
      listeners.clear();
      try {
        await page.close();
      } catch {}
    },
  };

  return bridge;
}
