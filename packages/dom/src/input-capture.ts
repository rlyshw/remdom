/**
 * Input Capture — watches a DOM for user interactions, emits InputOps.
 * Transport-agnostic: the callback decides where ops go.
 */

import type { InputOp } from "@remdom/protocol";
import { Modifiers } from "@remdom/protocol";
import { RDID } from "./node-registry.js";

export type InputCallback = (op: InputOp) => void;

export interface InputCapture {
  destroy(): void;
}

function getTargetId(event: Event): string | null {
  let el = event.target as HTMLElement | null;
  while (el) {
    const id = el.getAttribute?.(RDID);
    if (id) return id;
    el = el.parentElement;
  }
  return null;
}

function getModifiers(e: MouseEvent | KeyboardEvent): number {
  let m = 0;
  if (e.shiftKey) m |= Modifiers.SHIFT;
  if (e.ctrlKey) m |= Modifiers.CTRL;
  if (e.altKey) m |= Modifiers.ALT;
  if (e.metaKey) m |= Modifiers.META;
  return m;
}

export function createInputCapture(
  container: HTMLElement,
  onInput: InputCallback
): InputCapture {
  const ac = new AbortController();
  const opts = { signal: ac.signal };

  for (const type of ["click", "dblclick", "mousedown", "mouseup"] as const) {
    container.addEventListener(type, (e: MouseEvent) => {
      const targetId = getTargetId(e);
      if (!targetId) return;
      onInput({ type, targetId, x: e.clientX, y: e.clientY, button: e.button });
    }, opts);
  }

  for (const type of ["keydown", "keyup", "keypress"] as const) {
    container.addEventListener(type, (e: KeyboardEvent) => {
      const targetId = getTargetId(e);
      if (!targetId) return;
      onInput({ type, targetId, key: e.key, code: e.code, modifiers: getModifiers(e) });
    }, opts);
  }

  container.addEventListener("input", (e: Event) => {
    const targetId = getTargetId(e);
    if (!targetId) return;
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    onInput({ type: "input", targetId, value: target.value ?? "" });
  }, opts);

  container.addEventListener("focusin", (e: FocusEvent) => {
    const targetId = getTargetId(e);
    if (targetId) onInput({ type: "focus", targetId });
  }, opts);

  container.addEventListener("focusout", (e: FocusEvent) => {
    const targetId = getTargetId(e);
    if (targetId) onInput({ type: "blur", targetId });
  }, opts);

  container.addEventListener("scroll", (e: Event) => {
    const targetId = getTargetId(e);
    if (!targetId) return;
    const target = e.target as HTMLElement;
    onInput({ type: "scroll", targetId, scrollTop: target.scrollTop, scrollLeft: target.scrollLeft });
  }, { ...opts, capture: true });

  window.addEventListener("resize", () => {
    onInput({ type: "resize", width: window.innerWidth, height: window.innerHeight });
  }, opts);

  return { destroy: () => ac.abort() };
}
