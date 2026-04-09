import type { MutationOp, InputOp } from "@remdom/protocol";
import { DomApplier } from "@remdom/dom";
import { createInputCapture, type InputCapture } from "@remdom/dom";
import { OptimisticManager } from "./optimistic.js";

// Re-export DOM primitives for convenience
export { DomApplier, createInputCapture } from "@remdom/dom";
export { OptimisticManager } from "./optimistic.js";

export interface RemoteDomClient {
  disconnect(): void;
}

export interface ClientOptions {
  container: HTMLElement;
  url: string;
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
