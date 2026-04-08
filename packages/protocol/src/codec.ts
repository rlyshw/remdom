import { encode, decode } from "@msgpack/msgpack";
import type { Op } from "./ops.js";

// ── Codec abstraction ──

export interface Codec {
  encode(op: Op): string | Uint8Array;
  decode(data: string | Uint8Array | ArrayBuffer): Op;
}

export const jsonCodec: Codec = {
  encode(op) {
    return JSON.stringify(op);
  },
  decode(data) {
    if (typeof data === "string") return JSON.parse(data) as Op;
    const str = new TextDecoder().decode(data);
    return JSON.parse(str) as Op;
  },
};

export const msgpackCodec: Codec = {
  encode(op) {
    return encode(op);
  },
  decode(data) {
    if (typeof data === "string") return JSON.parse(data) as Op;
    const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    return decode(buf) as Op;
  },
};

// ── Legacy helpers (backward compat) ──

export function encodeOp(op: Op): Uint8Array {
  return encode(op);
}

export function decodeOp(data: Uint8Array | ArrayBuffer): Op {
  const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return decode(buf) as Op;
}

export function encodeOps(ops: Op[]): Uint8Array {
  return encode(ops);
}

export function decodeOps(data: Uint8Array | ArrayBuffer): Op[] {
  const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return decode(buf) as Op[];
}
