import type { MutationOp, InputOp } from "@remote-dom/protocol";
import { DomApplier } from "./dom-applier.js";
import { createInputCapture, type InputCapture } from "./input-capture.js";
import { OptimisticManager } from "./optimistic.js";

export { DomApplier } from "./dom-applier.js";
export { createInputCapture } from "./input-capture.js";
export { OptimisticManager } from "./optimistic.js";

export interface RemoteDomClient {
  disconnect(): void;
}

export interface ClientOptions {
  container: HTMLElement;
  url: string;
  /** Auto-reconnect on disconnect (default: true) */
  reconnect?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (err: Event) => void;
}

export function connect(options: ClientOptions): RemoteDomClient {
  const {
    container,
    url,
    reconnect = true,
    onConnect,
    onDisconnect,
    onError,
  } = options;

  const applier = new DomApplier(container);
  const optimistic = new OptimisticManager();
  let inputCapture: InputCapture | null = null;
  let ws: WebSocket | null = null;
  let destroyed = false;

  function connectWs() {
    if (destroyed) return;

    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      inputCapture = createInputCapture(container, (op: InputOp) => {
        if (op.type === "input") {
          optimistic.recordOptimistic(op.targetId, "value", op.value);
        }
        ws?.send(JSON.stringify(op));
      });
      onConnect?.();
    });

    ws.addEventListener("message", (event) => {
      try {
        const op = JSON.parse(event.data as string) as MutationOp;
        if (optimistic.shouldApply(op)) {
          applier.apply(op);
        }
      } catch (err) {
        console.error("[remote-dom/client] Failed to decode op:", err);
      }
    });

    ws.addEventListener("close", () => {
      inputCapture?.destroy();
      inputCapture = null;
      onDisconnect?.();
      if (reconnect && !destroyed) {
        setTimeout(connectWs, 1000);
      }
    });

    ws.addEventListener("error", (err) => {
      onError?.(err);
    });
  }

  connectWs();

  return {
    disconnect() {
      destroyed = true;
      inputCapture?.destroy();
      ws?.close();
    },
  };
}
