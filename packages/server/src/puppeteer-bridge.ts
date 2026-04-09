import type { Page, Frame } from "puppeteer-core";
import type { MutationOp, InputOp } from "@remote-dom/protocol";
import { INJECTED_SCRIPT } from "./puppeteer-injected.js";
import { dispatchPuppeteerInput } from "./puppeteer-input.js";

export type MutationCallback = (op: MutationOp) => void;

export interface PuppeteerBridge {
  page: Page;
  pageUrl: string;
  connected: boolean;
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
  let navigating = false;

  function emit(op: MutationOp) {
    if (destroyed) return;
    for (const cb of listeners) {
      try { cb(op); } catch {}
    }
  }

  // Expose the function that the injected script calls to send ops back
  try {
    await page.exposeFunction("__rdm_sendOps", (opsJson: string) => {
      if (destroyed) return;
      try {
        const ops: MutationOp[] = JSON.parse(opsJson);
        for (const op of ops) {
          emit(op);
        }
      } catch (err) {
        console.error("[bridge] Failed to parse ops:", err);
      }
    });
  } catch {
    // May already be exposed from a previous bridge on the same page
  }

  // Inject the observer script on every new document (survives navigations)
  await page.evaluateOnNewDocument(INJECTED_SCRIPT);

  // Navigate to the initial URL
  try {
    await page.goto(initialUrl, { waitUntil: "networkidle2", timeout: 30000 });
  } catch {
    // Timeout is OK — page might have long-polling connections
  }
  currentUrl = initialUrl;

  // Track navigations (including SPA pushState via Chrome's frame events)
  page.on("framenavigated", (frame: Frame) => {
    if (frame === page.mainFrame()) {
      const newUrl = frame.url();
      if (newUrl !== currentUrl && newUrl !== "about:blank" && !newUrl.startsWith("chrome-error://")) {
        currentUrl = newUrl;
        if (!navigating) {
          emit({ type: "navigated", url: newUrl });
        }
      }
    }
  });

  // Chrome console forwarding (filtered)
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warn") {
      const text = msg.text();
      if (text.includes("Content Security Policy") ||
          text.includes("cookie") ||
          text.includes("Manifest:") ||
          text.includes("deprecated") ||
          text.includes("Feature-Policy") ||
          text.includes("GSI_LOGGER") ||
          text.includes("FedCM")) return;
      console.log(`[chrome:${type}] ${text.slice(0, 200)}`);
    }
  });

  page.on("pageerror", (err) => {
    const msg = String(err);
    // Skip noisy errors
    if (msg.includes("ResizeObserver") || msg.includes("Script error")) return;
    console.log(`[chrome:error] ${msg.slice(0, 200)}`);
  });

  // Auto-dismiss dialogs
  page.on("dialog", async (dialog) => {
    try { await dialog.dismiss(); } catch {}
  });

  // Detect page crashes
  page.on("error", (err) => {
    console.error("[bridge] Page crashed:", err.message);
  });

  /** Safely evaluate in page context — returns null if context is destroyed */
  async function safeEvaluate<T>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T | null> {
    try {
      return await page.evaluate(fn as any, ...args);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("context") || msg.includes("destroyed") || msg.includes("detached")) {
        return null;
      }
      throw err;
    }
  }

  const bridge: PuppeteerBridge = {
    page,
    get pageUrl() { return currentUrl; },
    get connected() { return !destroyed && !page.isClosed(); },

    async getSnapshot(): Promise<string> {
      try {
        return await page.content();
      } catch {
        return `<html><body><p>Page not available</p></body></html>`;
      }
    },

    onMutation(cb: MutationCallback): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async dispatchInput(op: InputOp): Promise<void> {
      if (!bridge.connected) return;
      await dispatchPuppeteerInput(page, op, safeEvaluate);
    },

    async navigate(url: string): Promise<void> {
      if (!bridge.connected) return;
      navigating = true;
      currentUrl = url;
      try {
        const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }).catch(() => null);
        const contentType = response?.headers()?.["content-type"] ?? "";

        // Handle non-HTML responses
        if (contentType.startsWith("image/")) {
          await page.setContent(
            `<html><head><title>${url}</title></head><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#111"><img src="${url}" style="max-width:100%;max-height:100vh;object-fit:contain"></body></html>`,
            { waitUntil: "domcontentloaded" }
          );
        } else if (contentType.startsWith("application/pdf")) {
          await page.setContent(
            `<html><head><title>${url}</title></head><body style="margin:0"><embed src="${url}" type="application/pdf" width="100%" height="100%" style="position:fixed;top:0;left:0;right:0;bottom:0"></body></html>`,
            { waitUntil: "domcontentloaded" }
          );
        }

        // Re-inject observer in case evaluateOnNewDocument didn't fire
        await safeEvaluate(INJECTED_SCRIPT);
      } catch (err) {
        console.warn("[bridge] Navigation error:", (err as Error).message);
      } finally {
        navigating = false;
      }
    },

    async resize(width: number, height: number): Promise<void> {
      if (!bridge.connected) return;
      await page.setViewport({ width, height });
    },

    async destroy(): Promise<void> {
      destroyed = true;
      listeners.clear();
      try { await page.close(); } catch {}
    },
  };

  return bridge;
}
