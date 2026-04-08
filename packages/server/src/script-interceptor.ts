import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";

/** Fetch using node:http/https directly */
function httpFetch(url: string): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith("https") ? httpsGet : httpGet;
    const req = getter(url, {
      rejectUnauthorized: false,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
      },
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpFetch(new URL(res.headers.location, url).href).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve({
          ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
          status: res.statusCode ?? 0,
          text: async () => body,
        });
      });
    });
    req.on("error", reject);
  });
}

/**
 * Script interceptor for linkedom documents.
 *
 * Patches DOM APIs so that when app code dynamically creates and appends
 * <script> elements, we intercept them, fetch the src (if any), and
 * execute the code server-side instead of letting it reach the client.
 *
 * Handles:
 * - appendChild/insertBefore of <script> elements
 * - Inline scripts (textContent/innerHTML)
 * - External scripts (src attribute)
 * - onload/onerror callbacks
 * - document.write containing <script> tags
 */

type AnyElement = any;
type AnyDocument = any;

export interface ScriptInterceptorOptions {
  /** The linkedom document to patch */
  document: AnyDocument;
  /** Function to execute script code in the session context */
  execScript: (code: string, sourceUrl?: string) => void;
  /** Base URL for resolving relative script srcs */
  baseUrl?: string;
  /** Called after a script loads and executes */
  onScriptLoad?: (src: string) => void;
  /** Called when a script fails to load */
  onScriptError?: (src: string, err: Error) => void;
}

export function installScriptInterceptor(options: ScriptInterceptorOptions): () => void {
  const { document: doc, execScript, baseUrl, onScriptLoad, onScriptError } = options;

  // Track which nodes we've already processed
  const processedScripts = new WeakSet<AnyElement>();

  // ── Resolve script URL ──

  function resolveUrl(src: string): string {
    if (!src) return src;
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("//")) {
      return src.startsWith("//") ? "https:" + src : src;
    }
    if (baseUrl) {
      try {
        return new URL(src, baseUrl).href;
      } catch {
        return src;
      }
    }
    return src;
  }

  // ── Fetch and execute a script ──

  async function handleScript(scriptEl: AnyElement): Promise<void> {
    if (processedScripts.has(scriptEl)) return;
    processedScripts.add(scriptEl);

    // Skip non-javascript types
    const type = scriptEl.getAttribute?.("type") || "";
    if (type && type !== "text/javascript" && type !== "application/javascript" && type !== "") {
      // module scripts, json, templates — skip
      if (type === "module" || type === "importmap" || type === "application/json" || type === "application/ld+json") {
        return;
      }
    }

    const src = scriptEl.getAttribute?.("src");

    if (src) {
      // External script — fetch and execute
      const url = resolveUrl(src);
      try {
        const res = await httpFetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for ${url}`);
        }
        const code = await res.text();
        execScript(code, url);
        onScriptLoad?.(url);

        // Fire onload
        if (scriptEl.onload) {
          try { scriptEl.onload(); } catch {}
        }
        const loadEvent = doc.createEvent("Event");
        loadEvent.initEvent("load", false, false);
        scriptEl.dispatchEvent(loadEvent);
      } catch (err) {
        onScriptError?.(url, err as Error);
        if (scriptEl.onerror) {
          try { scriptEl.onerror(err); } catch {}
        }
      }
    } else {
      // Inline script — execute textContent
      const code = scriptEl.textContent || scriptEl.innerHTML || "";
      if (code.trim()) {
        try {
          execScript(code, "inline");
        } catch (err) {
          // Non-fatal — inline scripts often reference browser-only globals
        }
      }
    }
  }

  // ── Patch appendChild and insertBefore ──

  // Find the prototype where these methods live
  const elProto = doc.documentElement.constructor.prototype;
  const rawAppendChild = elProto.appendChild;
  const rawInsertBefore = elProto.insertBefore;

  elProto.appendChild = function (child: AnyElement) {
    const result = rawAppendChild.call(this, child);
    if (child.nodeType === 1 && child.tagName === "SCRIPT") {
      handleScript(child);
    }
    return result;
  };

  elProto.insertBefore = function (newNode: AnyElement, refNode: AnyElement | null) {
    const result = rawInsertBefore.call(this, newNode, refNode);
    if (newNode.nodeType === 1 && newNode.tagName === "SCRIPT") {
      handleScript(newNode);
    }
    return result;
  };

  // ── Patch document.write ──

  const rawWrite = doc.write?.bind(doc);
  if (rawWrite) {
    doc.write = function (html: string) {
      // Extract scripts from the written HTML
      const scripts: string[] = [];
      const cleaned = html.replace(
        /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi,
        (_match: string, content: string) => {
          if (content.trim()) scripts.push(content);
          return "";
        }
      );

      // Write the non-script HTML
      if (cleaned.trim()) {
        rawWrite(cleaned);
      }

      // Execute extracted scripts
      for (const code of scripts) {
        try {
          execScript(code, "document.write");
        } catch {}
      }
    };

    doc.writeln = function (html: string) {
      doc.write(html + "\n");
    };
  }

  // ── Patch innerHTML setter on elements to catch script injection ──

  const innerHTMLDesc = Object.getOwnPropertyDescriptor(elProto, "innerHTML");
  if (innerHTMLDesc?.set) {
    const rawSet = innerHTMLDesc.set;
    Object.defineProperty(elProto, "innerHTML", {
      ...innerHTMLDesc,
      set(val: string) {
        rawSet.call(this, val);
        // Find and process any script elements that were just injected
        if (val.toLowerCase().includes("<script")) {
          const scripts = this.querySelectorAll?.("script");
          if (scripts) {
            for (const s of Array.from(scripts) as AnyElement[]) {
              handleScript(s);
            }
          }
        }
      },
    });
  }

  // ── Cleanup function ──

  return function uninstall() {
    elProto.appendChild = rawAppendChild;
    elProto.insertBefore = rawInsertBefore;
    if (rawWrite) {
      doc.write = rawWrite;
    }
    if (innerHTMLDesc?.set) {
      Object.defineProperty(elProto, "innerHTML", innerHTMLDesc);
    }
  };
}
