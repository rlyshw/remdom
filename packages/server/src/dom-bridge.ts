import { parseHTML } from "linkedom";
import { randomUUID } from "node:crypto";
import type { MutationOp } from "@remote-dom/protocol";

const RDID = "data-rdid";

export type MutationCallback = (op: MutationOp) => void;

export interface DomBridge {
  document: Document;
  window: Window;
  getSnapshot(): string;
  onMutation(cb: MutationCallback): () => void;
  getNodeById(id: string): Node | null;
  flush(): void;
  destroy(): void;
}

export interface DomProvider {
  parse(html: string): { document: any; window: any };
}

export const linkedomProvider: DomProvider = {
  parse(html: string) {
    const { document, window } = parseHTML(html);
    return { document, window };
  },
};

type AnyElement = any;

/** Strip tags that clients shouldn't process (scripts, meta refresh, preloads) */
function stripClientUnsafe(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[^>]*\/>/gi, "")
    .replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "")
    .replace(/<link[^>]*rel\s*=\s*["']?preload["']?[^>]*as\s*=\s*["']?script["']?[^>]*>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
}

export function createDomBridge(
  html: string,
  provider: DomProvider = linkedomProvider
): DomBridge {
  const { document, window } = provider.parse(html);

  const listeners = new Set<MutationCallback>();
  const idMap = new Map<string, AnyElement>();
  let destroyed = false;
  let lastSnapshotHtml = "";

  function assignId(node: AnyElement): string {
    if (node.nodeType === 1) {
      let id = node.getAttribute?.(RDID);
      if (!id) {
        id = randomUUID();
        node.setAttribute(RDID, id);
      }
      idMap.set(id, node);
      return id;
    }
    if (!node.__rdid) {
      node.__rdid = randomUUID();
    }
    idMap.set(node.__rdid, node);
    return node.__rdid;
  }

  function walkAndAssign(node: AnyElement) {
    assignId(node);
    if (node.childNodes) {
      for (const child of Array.from(node.childNodes) as AnyElement[]) {
        walkAndAssign(child);
      }
    }
  }

  walkAndAssign(document.documentElement);
  lastSnapshotHtml = document.documentElement.outerHTML;

  function emit(op: MutationOp) {
    if (destroyed) return;
    for (const cb of listeners) {
      cb(op);
    }
  }

  function flush() {
    walkAndAssign(document.documentElement);
    const currentHtml = document.documentElement.outerHTML;
    if (currentHtml !== lastSnapshotHtml) {
      lastSnapshotHtml = currentHtml;
      emit({
        type: "snapshot",
        html: stripClientUnsafe(currentHtml),
        sessionId: "",
      });
    }
  }

  return {
    document,
    window,

    getSnapshot(): string {
      walkAndAssign(document.documentElement);
      lastSnapshotHtml = document.documentElement.outerHTML;
      return stripClientUnsafe(lastSnapshotHtml);
    },

    onMutation(cb: MutationCallback): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    getNodeById(id: string): Node | null {
      const fromMap = idMap.get(id);
      if (fromMap) return fromMap;
      const el = document.querySelector(`[${RDID}="${id}"]`);
      if (el) idMap.set(id, el);
      return el;
    },

    flush,

    destroy() {
      destroyed = true;
      listeners.clear();
      idMap.clear();
    },
  };
}
