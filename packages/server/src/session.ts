/**
 * Session interface — the contract that any session implementation must satisfy.
 *
 * A Session represents an observable+controllable source of DOM ops. It manages
 * WebSocket subscribers and routes input ops to whatever backend is driving the DOM.
 *
 * Implementations:
 *   - @remdom/puppeteer exports createPuppeteerSession() — headless Chrome backend
 *   - Custom implementations can wrap any DOM source (linkedom, jsdom, in-page, etc.)
 */

import type { WebSocket } from "ws";
import type { InputOp } from "@remdom/protocol";

export interface Session {
  id: string;
  subscribers: Set<WebSocket>;
  addClient(ws: WebSocket): void;
  removeClient(ws: WebSocket): void;
  handleInput(op: InputOp, fromWs?: any): void | Promise<void>;
  destroy(): void | Promise<void>;
}
