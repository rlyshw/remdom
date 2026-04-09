/**
 * Input Dispatcher — applies InputOps as real DOM events.
 *
 * This is the server-side counterpart to InputCapture.
 * On the observed page, it resolves node IDs to elements
 * and dispatches native events (set values, focus, scroll, etc).
 */

import { RDID, type NodeRegistry } from "./node-registry.js";

export interface InputDispatcher {
  resolveTarget(rdid: string): { x: number; y: number; width: number; height: number } | null;
  setInputValue(rdid: string, value: string): void;
  focusElement(rdid: string): void;
  blurElement(rdid: string): void;
  scrollTo(rdid: string, scrollTop: number, scrollLeft: number): void;
  getScrollInfo(): { scrollTop: number; scrollLeft: number; scrollHeight: number; clientHeight: number };
}

export function createInputDispatcher(
  registry: NodeRegistry,
  root?: Document
): InputDispatcher {
  const doc = root ?? document;

  function findNode(rdid: string): Element | null {
    const cached = registry.getNodeById(rdid);
    if (cached && cached.nodeType === 1) return cached as Element;
    return doc.querySelector(`[${RDID}="${rdid}"]`);
  }

  return {
    resolveTarget(rdid: string) {
      const node = findNode(rdid);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    },

    setInputValue(rdid: string, value: string) {
      const node = findNode(rdid);
      if (!node) return;
      // Use native setter to trigger React/framework change detection
      const proto = Object.getPrototypeOf(node);
      const descriptor =
        Object.getOwnPropertyDescriptor(proto, "value") ??
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(node, value);
      } else {
        (node as any).value = value;
      }
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    },

    focusElement(rdid: string) {
      const node = findNode(rdid) as HTMLElement | null;
      node?.focus?.();
    },

    blurElement(rdid: string) {
      const node = findNode(rdid) as HTMLElement | null;
      node?.blur?.();
    },

    scrollTo(rdid: string, scrollTop: number, scrollLeft: number) {
      if (rdid === "root") {
        window.scrollTo(scrollLeft, scrollTop);
        return;
      }
      const node = findNode(rdid) as HTMLElement | null;
      if (node) {
        node.scrollTop = scrollTop;
        node.scrollLeft = scrollLeft;
      }
    },

    getScrollInfo() {
      const de = doc.documentElement;
      return {
        scrollTop: window.scrollY ?? de.scrollTop,
        scrollLeft: window.scrollX ?? de.scrollLeft,
        scrollHeight: de.scrollHeight,
        clientHeight: window.innerHeight,
      };
    },
  };
}
