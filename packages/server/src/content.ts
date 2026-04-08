import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";

/** Fetch a URL using node:http/https directly, bypassing globalThis.fetch */
function httpFetch(url: string): Promise<{ ok: boolean; status: number; statusText: string; text(): Promise<string> }> {
  return new Promise((resolve, reject) => {
    const getter = url.startsWith("https") ? httpsGet : httpGet;
    const req = getter(url, {
      rejectUnauthorized: false,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }, (res) => {
      // Follow redirects
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
          statusText: res.statusMessage ?? "",
          text: async () => body,
        });
      });
    });
    req.on("error", reject);
  });
}

export interface LoadedContent {
  html: string;
  scripts: string | null;
}

/**
 * Load app content from a local directory.
 * Reads index.html, extracts inline <script> tags, and reads app.js if present.
 */
export function loadFromDirectory(dirPath: string): LoadedContent {
  const htmlPath = join(dirPath, "index.html");
  if (!existsSync(htmlPath)) {
    throw new Error(`No index.html found at ${htmlPath}`);
  }

  const rawHtml = readFileSync(htmlPath, "utf-8");
  const { html, scripts: inlineScripts } = extractScripts(rawHtml);

  // Also check for app.js
  const jsPath = join(dirPath, "app.js");
  let appJs: string | null = null;
  if (existsSync(jsPath)) {
    appJs = readFileSync(jsPath, "utf-8");
  }

  // Combine inline scripts and app.js
  const allScripts = [inlineScripts, appJs].filter(Boolean).join("\n");

  return {
    html,
    scripts: allScripts || null,
  };
}

/**
 * Load app content from a URL.
 * Fetches the page, rewrites relative asset URLs to absolute, extracts scripts.
 */
export async function loadFromUrl(url: string): Promise<LoadedContent> {
  const res = await httpFetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }

  const rawHtml = await res.text();
  const base = new URL(url);

  // Rewrite relative URLs in src/href attributes to absolute
  let rewritten = rawHtml.replace(
    /(src|href|action)=(["'])((?!https?:\/\/|\/\/|data:|#|javascript:).*?)\2/gi,
    (_match, attr, quote, relUrl) => {
      try {
        const abs = new URL(relUrl, base).href;
        return `${attr}=${quote}${abs}${quote}`;
      } catch {
        return _match;
      }
    }
  );

  // Also rewrite url() in inline styles
  rewritten = rewritten.replace(
    /url\((["']?)((?!https?:\/\/|\/\/|data:).*?)\1\)/gi,
    (_match, quote, relUrl) => {
      try {
        const abs = new URL(relUrl, base).href;
        return `url(${quote}${abs}${quote})`;
      } catch {
        return _match;
      }
    }
  );

  // Extract and fetch external scripts
  const scriptSources: string[] = [];
  const externalScriptPattern =
    /<script[^>]+src=(["'])(.*?)\1[^>]*><\/script>/gi;
  let match;
  while ((match = externalScriptPattern.exec(rewritten)) !== null) {
    const scriptUrl = match[2];
    try {
      const absUrl = scriptUrl.startsWith("http")
        ? scriptUrl
        : new URL(scriptUrl, base).href;
      const scriptRes = await httpFetch(absUrl);
      if (scriptRes.ok) {
        scriptSources.push(await scriptRes.text());
      } else {
        console.warn(
          `[content] Failed to fetch script ${absUrl}: ${scriptRes.status}`
        );
      }
    } catch (err) {
      console.warn(`[content] Failed to fetch script ${scriptUrl}:`, err);
    }
  }

  // Extract inline scripts and remove all script tags from HTML
  const { html, scripts: inlineScripts } = extractScripts(rewritten);

  const allScripts = [inlineScripts, ...scriptSources]
    .filter(Boolean)
    .join("\n");

  return {
    html,
    scripts: allScripts || null,
  };
}

/**
 * Extract <script> tags from HTML.
 * Returns the HTML with scripts removed and the script contents concatenated.
 */
export function extractScripts(html: string): LoadedContent {
  const scripts: string[] = [];

  // Match inline scripts (no src attribute)
  const cleaned = html.replace(
    /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi,
    (_match, content) => {
      const trimmed = content.trim();
      if (trimmed) scripts.push(trimmed);
      return "";
    }
  );

  // Remove external script tags too (they're fetched separately in loadFromUrl)
  const fullyClean = cleaned.replace(
    /<script[^>]+src=[^>]*><\/script>/gi,
    ""
  );

  return {
    html: fullyClean,
    scripts: scripts.length > 0 ? scripts.join("\n") : null,
  };
}
