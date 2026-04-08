/**
 * Browser environment polyfills for server-side script execution.
 *
 * Provides fake/functional versions of browser globals that scripts
 * commonly depend on, injected into the execution context alongside
 * the linkedom document.
 */

type AnyDocument = any;

export interface BrowserEnv {
  /** All globals to inject into script execution context */
  globals: Record<string, any>;
  /** Update the base URL (e.g., after navigation) */
  setBaseUrl(url: string): void;
  destroy(): void;
}

export function createBrowserEnv(
  document: AnyDocument,
  window: any,
  baseUrl?: string
): BrowserEnv {
  let currentUrl = baseUrl || "about:blank";

  // ── location ──

  const location = {
    get href() { return currentUrl; },
    set href(url: string) {
      // Could fire navigation — for now just update
      currentUrl = url;
    },
    get origin() {
      try { return new URL(currentUrl).origin; } catch { return ""; }
    },
    get protocol() {
      try { return new URL(currentUrl).protocol; } catch { return "https:"; }
    },
    get host() {
      try { return new URL(currentUrl).host; } catch { return ""; }
    },
    get hostname() {
      try { return new URL(currentUrl).hostname; } catch { return ""; }
    },
    get port() {
      try { return new URL(currentUrl).port; } catch { return ""; }
    },
    get pathname() {
      try { return new URL(currentUrl).pathname; } catch { return "/"; }
    },
    get search() {
      try { return new URL(currentUrl).search; } catch { return ""; }
    },
    get hash() {
      try { return new URL(currentUrl).hash; } catch { return ""; }
    },
    replace(_url: string) { /* no-op */ },
    assign(_url: string) { /* no-op */ },
    reload() { /* no-op */ },
    toString() { return currentUrl; },
  };

  // ── navigator ──

  const navigator = {
    userAgent: "Mozilla/5.0 (remote-dom) AppleWebKit/537.36 Chrome/120.0.0.0",
    language: "en-US",
    languages: ["en-US", "en"],
    platform: "Linux",
    cookieEnabled: false,
    onLine: true,
    hardwareConcurrency: 4,
    maxTouchPoints: 0,
    clipboard: { writeText: async () => {}, readText: async () => "" },
    sendBeacon: () => true,
    serviceWorker: undefined,
  };

  // ── localStorage / sessionStorage ──

  function createStorage(): Storage {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, String(v)); },
      removeItem: (k: string) => { data.delete(k); },
      clear: () => { data.clear(); },
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() { return data.size; },
    } as Storage;
  }

  const localStorage = createStorage();
  const sessionStorage = createStorage();

  // ── history ──

  const history = {
    length: 1,
    state: null,
    pushState: (_state: any, _title: string, _url?: string) => {},
    replaceState: (_state: any, _title: string, _url?: string) => {},
    go: () => {},
    back: () => {},
    forward: () => {},
  };

  // ── matchMedia ──

  function matchMedia(query: string) {
    // Default: assume desktop, prefers-color-scheme: light
    const matches = query.includes("min-width") ? true : false;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };
  }

  // ── requestAnimationFrame ──

  let rafId = 0;
  function requestAnimationFrame(cb: (time: number) => void): number {
    const id = ++rafId;
    setTimeout(() => cb(Date.now()), 16);
    return id;
  }
  function cancelAnimationFrame(_id: number) {}

  // ── IntersectionObserver / ResizeObserver / MutationObserver stubs ──

  class StubObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }

  // ── CustomEvent / Event polyfill ──

  class CustomEventPolyfill {
    type: string;
    detail: any;
    bubbles: boolean;
    cancelable: boolean;
    constructor(type: string, opts?: any) {
      this.type = type;
      this.detail = opts?.detail ?? null;
      this.bubbles = opts?.bubbles ?? false;
      this.cancelable = opts?.cancelable ?? false;
    }
  }

  // ── getComputedStyle stub ──

  function getComputedStyle(_el: any) {
    return new Proxy({}, {
      get: (_target, prop) => {
        if (prop === "getPropertyValue") return () => "";
        return "";
      },
    });
  }

  // ── Build globals ──

  const globals: Record<string, any> = {
    // Timers
    setInterval,
    setTimeout,
    clearInterval,
    clearTimeout,
    requestAnimationFrame,
    cancelAnimationFrame,

    // Console
    console,

    // DOM
    document,
    window,

    // Network
    fetch: globalThis.fetch,
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    Response: globalThis.Response,
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    FormData: globalThis.FormData,
    XMLHttpRequest: createXHRStub(),

    // Location / Navigation
    location,
    navigator,
    history,

    // Storage
    localStorage,
    sessionStorage,

    // Media queries
    matchMedia,
    getComputedStyle,

    // Observers
    IntersectionObserver: StubObserver,
    ResizeObserver: StubObserver,
    MutationObserver: StubObserver,

    // Events
    CustomEvent: CustomEventPolyfill,
    Event: CustomEventPolyfill,

    // Misc browser globals
    self: undefined as any,  // set below
    globalThis: undefined as any, // set below
    btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
    atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
    performance: { now: () => Date.now(), mark: () => {}, measure: () => {}, getEntriesByName: () => [], getEntriesByType: () => [] },
    queueMicrotask: globalThis.queueMicrotask,
    structuredClone: globalThis.structuredClone,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,

    // Prevent errors on missing globals
    Worker: class { constructor() { throw new Error("Workers not supported"); } },
    SharedWorker: class { constructor() { throw new Error("SharedWorker not supported"); } },
    WebSocket: class { constructor() { throw new Error("WebSocket not supported in server context"); } },
    Blob: globalThis.Blob,
    File: class extends Blob { name = ""; },
    FileReader: class {
      readAsText() {}
      readAsDataURL() {}
      readAsArrayBuffer() {}
      addEventListener() {}
    },
    Image: class {
      src = "";
      width = 0;
      height = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
    },
  };

  // Self-references
  globals.self = globals;
  globals.globalThis = globals;

  // Also patch the window object with these globals
  for (const [key, value] of Object.entries(globals)) {
    if (key !== "document" && key !== "window") {
      try {
        window[key] = value;
      } catch {
        // Some properties may be read-only
      }
    }
  }

  // Ensure window.location works
  try {
    Object.defineProperty(window, "location", {
      get: () => location,
      configurable: true,
    });
  } catch {}

  return {
    globals,
    setBaseUrl(url: string) {
      currentUrl = url;
    },
    destroy() {
      localStorage.clear();
      sessionStorage.clear();
    },
  };
}

/** Minimal XMLHttpRequest stub that uses fetch under the hood */
function createXHRStub() {
  return class XMLHttpRequest {
    static UNSENT = 0;
    static OPENED = 1;
    static HEADERS_RECEIVED = 2;
    static LOADING = 3;
    static DONE = 4;

    readyState = 0;
    status = 0;
    statusText = "";
    responseText = "";
    responseType = "";
    response: any = null;
    onreadystatechange: (() => void) | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    private _method = "GET";
    private _url = "";
    private _headers = new Map<string, string>();
    private _async = true;

    open(method: string, url: string, async = true) {
      this._method = method;
      this._url = url;
      this._async = async;
      this.readyState = 1;
    }

    setRequestHeader(name: string, value: string) {
      this._headers.set(name, value);
    }

    send(body?: any) {
      const headers: Record<string, string> = {};
      this._headers.forEach((v, k) => { headers[k] = v; });

      fetch(this._url, {
        method: this._method,
        headers,
        body: this._method !== "GET" ? body : undefined,
      })
        .then(async (res) => {
          this.status = res.status;
          this.statusText = res.statusText;
          this.readyState = 4;
          this.responseText = await res.text();
          this.response = this.responseText;
          this.onreadystatechange?.();
          this.onload?.();
        })
        .catch(() => {
          this.readyState = 4;
          this.status = 0;
          this.onreadystatechange?.();
          this.onerror?.();
        });
    }

    abort() {}
    addEventListener(_type: string, _cb: any) {}
    removeEventListener() {}
    getResponseHeader() { return null; }
    getAllResponseHeaders() { return ""; }
  };
}
