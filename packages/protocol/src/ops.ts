/**
 * remote-dom protocol op types.
 *
 * Wire format: JSON over WebSocket.
 * Server sends MutationOps to describe DOM changes.
 * Clients send InputOps to dispatch user actions.
 */

// ── Serialized DOM node (used in childList ops) ──

export interface SerializedNode {
  id: string;
  type: number; // Node.nodeType: 1=element, 3=text, 8=comment
  tag?: string;
  attrs?: Record<string, string>;
  children?: SerializedNode[];
  data?: string; // text/comment content
}

// ── Server → Client (mutation ops) ──

export interface SnapshotOp {
  type: "snapshot";
  html: string;
  sessionId: string;
}

export interface ChildListOp {
  type: "childList";
  targetId: string;
  added: SerializedNode[];
  removed: string[];
  beforeId: string | null;
}

export interface AttributesOp {
  type: "attributes";
  targetId: string;
  name: string;
  value: string | null;
}

export interface CharacterDataOp {
  type: "characterData";
  targetId: string;
  data: string;
}

export interface PropertyOp {
  type: "property";
  targetId: string;
  prop: string;
  value: unknown;
}

export interface NavigatedOp {
  type: "navigated";
  url: string;
}

export type MutationOp =
  | SnapshotOp
  | ChildListOp
  | AttributesOp
  | CharacterDataOp
  | PropertyOp
  | NavigatedOp;

// ── Client → Server (input ops) ──

export interface MouseOp {
  type: "mousedown" | "mouseup" | "click" | "dblclick";
  targetId: string;
  x: number;
  y: number;
  button: number;
}

export interface KeyOp {
  type: "keydown" | "keyup" | "keypress";
  targetId: string;
  key: string;
  code: string;
  modifiers: number;
}

export interface InputValueOp {
  type: "input";
  targetId: string;
  value: string;
}

export interface ScrollOp {
  type: "scroll";
  targetId: string;
  scrollTop: number;
  scrollLeft: number;
}

export interface ResizeOp {
  type: "resize";
  width: number;
  height: number;
}

export interface FocusOp {
  type: "focus" | "blur";
  targetId: string;
}

export interface NavigateOp {
  type: "navigate";
  url: string;
}

export type InputOp =
  | MouseOp
  | KeyOp
  | InputValueOp
  | ScrollOp
  | ResizeOp
  | FocusOp
  | NavigateOp;

// ── Union ──

export type Op = MutationOp | InputOp;

// ── Modifier key bitmask ──

export const Modifiers = {
  SHIFT: 1,
  CTRL: 2,
  ALT: 4,
  META: 8,
} as const;

// ── Op type guards ──

export function isMutationOp(op: Op): op is MutationOp {
  return ["snapshot", "childList", "attributes", "characterData", "property", "navigated"].includes(op.type);
}

export function isInputOp(op: Op): op is InputOp {
  return ["mousedown", "mouseup", "click", "dblclick", "keydown", "keyup", "keypress", "input", "scroll", "resize", "focus", "blur", "navigate"].includes(op.type);
}
