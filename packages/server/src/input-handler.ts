import type { InputOp } from "@remote-dom/protocol";
import type { DomBridge } from "./dom-bridge.js";

type AnyElement = any;

/**
 * Dispatches a client InputOp as a synthetic DOM event on the server-side linkedom document.
 */
export function dispatchInputOp(bridge: DomBridge, op: InputOp): void {
  const doc = bridge.document as any;

  if (op.type === "resize") {
    return;
  }

  if (op.type === "navigate") {
    // Navigation is handled at a higher level (session/server)
    // This function only handles DOM events
    return;
  }

  const node = bridge.getNodeById(op.targetId) as AnyElement;
  if (!node) {
    console.warn(`[input-handler] Node not found: ${op.targetId}`);
    return;
  }

  switch (op.type) {
    case "click":
    case "dblclick":
    case "mousedown":
    case "mouseup": {
      const event = doc.createEvent("MouseEvent");
      event.initEvent(op.type, true, true);
      node.dispatchEvent(event);
      break;
    }

    case "keydown":
    case "keyup":
    case "keypress": {
      const event = doc.createEvent("KeyboardEvent");
      event.initEvent(op.type, true, true);
      // linkedom's KeyboardEvent is minimal; attach key info directly
      (event as any).key = op.key;
      (event as any).code = op.code;
      node.dispatchEvent(event);
      break;
    }

    case "input": {
      // Set the value on the element, then dispatch input event
      if ("value" in node) {
        node.value = op.value;
      }
      const event = doc.createEvent("Event");
      event.initEvent("input", true, true);
      node.dispatchEvent(event);
      break;
    }

    case "scroll": {
      // Store scroll position (no layout engine, so just record it)
      node.scrollTop = op.scrollTop;
      node.scrollLeft = op.scrollLeft;
      break;
    }

    case "focus": {
      if (node.focus) node.focus();
      break;
    }

    case "blur": {
      if (node.blur) node.blur();
      break;
    }
  }

  // After dispatching the event, flush to detect any DOM changes
  bridge.flush();
}
