import puppeteer from "puppeteer-core";
import type {
  Browser,
  Page,
  LaunchOptions,
} from "puppeteer-core";

// Try to load stealth plugin if available
let launcher: any = puppeteer;
async function loadStealth() {
  try {
    const pe: any = await (Function('return import("puppeteer-extra")')());
    const sp: any = await (Function('return import("puppeteer-extra-plugin-stealth")')());
    const pExtra = pe.default ?? pe;
    const stealth = sp.default ?? sp;
    pExtra.use(stealth());
    launcher = pExtra;
    console.log("[browser-pool] Stealth plugin loaded");
  } catch {
    console.log("[browser-pool] Stealth plugin not available, using plain puppeteer-core");
  }
}
await loadStealth();

export interface BrowserPoolOptions {
  /** 'launch' starts a local Chrome, 'connect' connects to a remote one */
  mode: "launch" | "connect";
  /** Path to Chrome binary (for @sparticuz/chromium or custom installs) */
  executablePath?: string;
  /** WebSocket endpoint for remote Chrome (mode: 'connect') */
  browserWSEndpoint?: string;
  /** Puppeteer launch options */
  launchOptions?: LaunchOptions;
  /** Max concurrent pages (default: 10) */
  maxPages?: number;
}

export interface BrowserPool {
  /** Get or create the browser instance */
  browser(): Promise<Browser>;
  /** Create a new page */
  acquirePage(viewport?: { width: number; height: number }): Promise<Page>;
  /** Close a page */
  releasePage(page: Page): Promise<void>;
  /** Shut down everything */
  destroy(): Promise<void>;
}

export async function createBrowserPool(
  options: BrowserPoolOptions = { mode: "launch" }
): Promise<BrowserPool> {
  const { mode, executablePath, browserWSEndpoint, launchOptions, maxPages = 10 } = options;

  let browserInstance: Browser | null = null;
  const activePages = new Set<Page>();

  async function getBrowser(): Promise<Browser> {
    if (browserInstance && browserInstance.connected) {
      return browserInstance;
    }

    if (mode === "connect" && browserWSEndpoint) {
      browserInstance = await launcher.connect({ browserWSEndpoint });
    } else {
      const defaultArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--disable-extensions",
      ];

      // Try to find Chrome if no executablePath given
      let chromePath = executablePath;
      if (!chromePath) {
        // Common Chrome locations
        const candidates = [
          process.env.CHROME_PATH,
          process.env.PUPPETEER_EXECUTABLE_PATH,
          // Windows
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          // macOS
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          // Linux
          "/usr/bin/google-chrome",
          "/usr/bin/chromium-browser",
          "/usr/bin/chromium",
        ].filter(Boolean) as string[];

        for (const candidate of candidates) {
          try {
            const { existsSync } = await import("node:fs");
            if (existsSync(candidate)) {
              chromePath = candidate;
              break;
            }
          } catch {}
        }
      }

      if (!chromePath) {
        throw new Error(
          "Could not find Chrome. Set CHROME_PATH env var or provide executablePath."
        );
      }

      browserInstance = await launcher.launch({
        headless: true,
        executablePath: chromePath,
        args: defaultArgs,
        ...launchOptions,
      });
    }

    browserInstance!.on("disconnected", () => {
      browserInstance = null;
    });

    return browserInstance!;
  }

  return {
    browser: getBrowser,

    async acquirePage(viewport?: { width: number; height: number }): Promise<Page> {
      if (activePages.size >= maxPages) {
        throw new Error(`Browser pool at capacity (${maxPages} pages)`);
      }

      const browser = await getBrowser();
      const page = await browser.newPage();

      if (viewport) {
        await page.setViewport(viewport);
      } else {
        await page.setViewport({ width: 1280, height: 720 });
      }

      activePages.add(page);
      return page;
    },

    async releasePage(page: Page): Promise<void> {
      activePages.delete(page);
      try {
        await page.close();
      } catch {}
    },

    async destroy(): Promise<void> {
      for (const page of activePages) {
        try {
          await page.close();
        } catch {}
      }
      activePages.clear();
      if (browserInstance) {
        try {
          await browserInstance.close();
        } catch {}
        browserInstance = null;
      }
    },
  };
}
