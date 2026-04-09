import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import { jsonCodec, type Codec } from "@remdom/protocol";
import type { InputOp } from "@remdom/protocol";
import type { Session } from "./session.js";

export interface Fanout {
  wss: WebSocketServer;
  destroy(): void;
}

/**
 * Attach a WebSocket server to an HTTP server.
 * Routes connections to sessions via the getSession callback.
 */
export function createFanout(
  server: HttpServer,
  getSession: (req: IncomingMessage) => Session | null,
  codec: Codec = jsonCodec
): Fanout {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const session = getSession(req);
    if (!session) {
      ws.close(4000, "No active session");
      return;
    }

    session.addClient(ws);

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const str = data.toString();
        const op = codec.decode(str) as InputOp;
        session.handleInput(op, ws);
      } catch (err) {
        console.error("[fanout] Failed to decode input op:", err);
      }
    });

    ws.on("close", () => {
      session.removeClient(ws);
    });

    ws.on("error", (err) => {
      console.error("[fanout] WebSocket error:", err);
      session.removeClient(ws);
    });
  });

  return {
    wss,
    destroy() {
      wss.close();
    },
  };
}
