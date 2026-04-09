/**
 * DOM Observer — watches a DOM tree for mutations and emits structured ops.
 *
 * Transport-agnostic: the `onOps` callback receives ops, the caller
 * decides what to do with them (send over WebSocket, postMessage, log, etc).
 */

import type { MutationOp, ChildListOp, AttributesOp, CharacterDataOp, PropertyOp } from "@remdom/protocol";
import { createNodeRegistry, RDID, type NodeRegistry } from "./node-registry.js";
import { serializeNode } from "./serialize.js";

export type { NodeRegistry } from "./node-registry.js";

export interface ObserverOptions {
  /** Root node to observe (default: document.documentElement) */
  root?: Node;
  /** Shared node registry (creates own if not provided) */
  registry?: NodeRegistry;
  /** Callback receiving batched ops */
  onOps: (ops: MutationOp[]) => void;
  /** Batching strategy: 'raf' (requestAnimationFrame), 'microtask', or 'sync' */
  batchMode?: "raf" | "microtask" | "sync";
  /** Auto-resync: emit a full snapshot every N ops to correct drift (0 = disabled) */
  resyncInterval?: number;
}

export interface DomObserver {
  /** Send a full snapshot of the current DOM */
  snapshot(): void;
  /** Access the node registry used by this observer */
  registry: NodeRegistry;
  /** Stop observing and clean up */
  destroy(): void;
}

export function createObserver(options: ObserverOptions): DomObserver {
  const {
    root = document.documentElement,
    registry = createNodeRegistry(),
    onOps,
    batchMode = "raf",
    resyncInterval = 0,
  } = options;

  let pendingOps: MutationOp[] = [];
  let flushScheduled = false;
  let destroyed = false;
  let opsSinceResync = 0;

  function scheduleFlush(): void {
    if (flushScheduled || destroyed) return;
    flushScheduled = true;

    if (batchMode === "sync") {
      flush();
    } else if (batchMode === "microtask") {
      queueMicrotask(flush);
    } else {
      requestAnimationFrame(flush);
    }
  }

  function flush(): void {
    flushScheduled = false;
    if (pendingOps.length === 0 || destroyed) return;
    const batch = pendingOps;
    pendingOps = [];
    opsSinceResync += batch.length;

    // Periodic resync: replace accumulated ops with a fresh snapshot
    if (resyncInterval > 0 && opsSinceResync >= resyncInterval) {
      opsSinceResync = 0;
      registry.walkAndAssign(root);
      const html = (root as Element).outerHTML;
      onOps([{ type: "snapshot", html, sessionId: "" }]);
      return;
    }

    onOps(batch);
  }

  function queueOp(op: MutationOp): void {
    pendingOps.push(op);
    scheduleFlush();
  }

  // Walk and assign IDs to existing nodes
  registry.walkAndAssign(root);

  // Set up MutationObserver
  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      // Skip our own data-rdid attribute changes
      if (mut.type === "attributes" && mut.attributeName === RDID) continue;

      switch (mut.type) {
        case "childList": {
          const targetId = registry.getIdOf(mut.target);
          const added = [];
          const removed = [];

          for (let i = 0; i < mut.addedNodes.length; i++) {
            const node = mut.addedNodes[i];
            registry.walkAndAssign(node);
            const s = serializeNode(node, registry);
            if (s) added.push(s);
          }

          for (let i = 0; i < mut.removedNodes.length; i++) {
            const id = registry.getIdOf(mut.removedNodes[i]);
            if (id) removed.push(id);
          }

          const beforeId = mut.nextSibling
            ? registry.getIdOf(mut.nextSibling)
            : null;

          if (added.length > 0 || removed.length > 0) {
            queueOp({
              type: "childList",
              targetId,
              added,
              removed,
              beforeId,
            } as ChildListOp);
          }
          break;
        }

        case "attributes": {
          queueOp({
            type: "attributes",
            targetId: registry.getIdOf(mut.target),
            name: mut.attributeName!,
            value: (mut.target as Element).getAttribute(mut.attributeName!),
          } as AttributesOp);
          break;
        }

        case "characterData": {
          queueOp({
            type: "characterData",
            targetId: registry.getIdOf(mut.target),
            data: mut.target.textContent ?? "",
          } as CharacterDataOp);
          break;
        }
      }
    }
  });

  observer.observe(root, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
  });

  // ── Shadow DOM interception ──
  // Hook attachShadow to observe mutations inside shadow roots

  const shadowObservers: MutationObserver[] = [];
  const rawAttachShadow = typeof Element !== "undefined"
    ? Element.prototype.attachShadow
    : null;

  function observeShadowRoot(shadowRoot: ShadowRoot, hostId: string): void {
    // Walk and assign IDs to existing shadow content
    for (let i = 0; i < shadowRoot.childNodes.length; i++) {
      registry.walkAndAssign(shadowRoot.childNodes[i]);
    }

    const shadowObs = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        if (mut.type === "attributes" && mut.attributeName === RDID) continue;

        switch (mut.type) {
          case "childList": {
            const targetId = registry.getIdOf(mut.target);
            const added = [];
            const removed = [];
            for (let i = 0; i < mut.addedNodes.length; i++) {
              registry.walkAndAssign(mut.addedNodes[i]);
              const s = serializeNode(mut.addedNodes[i], registry);
              if (s) added.push(s);
            }
            for (let i = 0; i < mut.removedNodes.length; i++) {
              const id = registry.getIdOf(mut.removedNodes[i]);
              if (id) removed.push(id);
            }
            if (added.length > 0 || removed.length > 0) {
              queueOp({
                type: "childList",
                targetId,
                added,
                removed,
                beforeId: mut.nextSibling ? registry.getIdOf(mut.nextSibling) : null,
              } as ChildListOp);
            }
            break;
          }
          case "attributes": {
            queueOp({
              type: "attributes",
              targetId: registry.getIdOf(mut.target),
              name: mut.attributeName!,
              value: (mut.target as Element).getAttribute(mut.attributeName!),
            } as AttributesOp);
            break;
          }
          case "characterData": {
            queueOp({
              type: "characterData",
              targetId: registry.getIdOf(mut.target),
              data: mut.target.textContent ?? "",
            } as CharacterDataOp);
            break;
          }
        }
      }
    });

    shadowObs.observe(shadowRoot, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
    });
    shadowObservers.push(shadowObs);
  }

  if (rawAttachShadow) {
    Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
      const shadowRoot = rawAttachShadow.call(this, init);
      const hostId = registry.getIdOf(this);
      // Defer observation to next microtask so initial content is populated
      queueMicrotask(() => observeShadowRoot(shadowRoot, hostId));
      return shadowRoot;
    };
  }

  // Also observe any existing shadow roots in the tree
  if (root instanceof Element || (root as any).querySelectorAll) {
    const allElements = (root as Element).querySelectorAll("*");
    for (let i = 0; i < allElements.length; i++) {
      const el = allElements[i];
      if (el.shadowRoot) {
        observeShadowRoot(el.shadowRoot, registry.getIdOf(el));
      }
    }
  }

  // ── document.title interception ──

  const titleDesc = Object.getOwnPropertyDescriptor(Document.prototype, "title");
  if (titleDesc?.set) {
    const rawTitleSet = titleDesc.set;
    Object.defineProperty(Document.prototype, "title", {
      ...titleDesc,
      set(val: string) {
        rawTitleSet.call(this, val);
        if (!destroyed) {
          queueOp({
            type: "property",
            targetId: "__document",
            prop: "title",
            value: val,
          } as PropertyOp);
        }
      },
    });
  }

  // ── Property setter interception ──
  // Patch prototype setters on form elements to emit property ops
  // for changes that MutationObserver can't see (.value, .checked, etc.)

  interface PatchedProto { __rdm_patched?: boolean }
  const patchedProtos = new Set<object>();
  const originalSetters = new Map<string, PropertyDescriptor>();

  function patchPropertySetter(proto: any, prop: string): void {
    const key = `${proto.constructor?.name ?? "?"}.${prop}`;
    if (originalSetters.has(key)) return;

    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc?.set) return;

    originalSetters.set(key, desc);

    Object.defineProperty(proto, prop, {
      ...desc,
      set(this: Element, newVal: any) {
        const oldVal = desc.get?.call(this);
        desc.set!.call(this, newVal);
        if (!destroyed && oldVal !== newVal && registry.getNodeById(registry.getIdOf(this))) {
          queueOp({
            type: "property",
            targetId: registry.getIdOf(this),
            prop,
            value: newVal,
          } as PropertyOp);
        }
      },
    });
  }

  function restoreSetters(): void {
    for (const [key, desc] of originalSetters) {
      const [protoName, prop] = key.split(".");
      // Find the proto to restore — we stored the descriptor so just re-apply
      // This is best-effort; if the proto is gone, skip
      try {
        for (const proto of patchedProtos) {
          if ((proto.constructor?.name ?? "?") === protoName) {
            Object.defineProperty(proto, prop, desc);
          }
        }
      } catch {}
    }
    originalSetters.clear();
    patchedProtos.clear();
  }

  // Patch the key form element prototypes
  if (typeof HTMLInputElement !== "undefined") {
    const inputProto = HTMLInputElement.prototype;
    patchPropertySetter(inputProto, "value");
    patchPropertySetter(inputProto, "checked");
    patchedProtos.add(inputProto);
  }
  if (typeof HTMLTextAreaElement !== "undefined") {
    patchPropertySetter(HTMLTextAreaElement.prototype, "value");
    patchedProtos.add(HTMLTextAreaElement.prototype);
  }
  if (typeof HTMLSelectElement !== "undefined") {
    patchPropertySetter(HTMLSelectElement.prototype, "value");
    patchPropertySetter(HTMLSelectElement.prototype, "selectedIndex");
    patchedProtos.add(HTMLSelectElement.prototype);
  }

  return {
    registry,

    snapshot(): void {
      registry.walkAndAssign(root);
      const html = (root as Element).outerHTML;
      onOps([{ type: "snapshot", html, sessionId: "" }]);
    },

    destroy(): void {
      destroyed = true;
      observer.disconnect();
      for (const obs of shadowObservers) obs.disconnect();
      shadowObservers.length = 0;
      if (rawAttachShadow) Element.prototype.attachShadow = rawAttachShadow;
      if (titleDesc?.set) Object.defineProperty(Document.prototype, "title", titleDesc);
      restoreSetters();
      pendingOps = [];
    },
  };
}
