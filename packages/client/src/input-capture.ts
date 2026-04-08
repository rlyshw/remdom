import type { InputOp } from "@remote-dom/protocol";
import { Modifiers } from "@remote-dom/protocol";

const RDID = "data-rdid";

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

/**
 * Attach input listeners to a container, emitting InputOps via callback.
 * Uses event delegation on the container.
 */
export function createInputCapture(
  container: HTMLElement,
  onInput: InputCallback
): InputCapture {
  const ac = new AbortController();
  const opts = { signal: ac.signal };

  // Mouse events
  for (const type of ["click", "dblclick", "mousedown", "mouseup"] as const) {
    container.addEventListener(
      type,
      (e: MouseEvent) => {
        const targetId = getTargetId(e);
        if (!targetId) return;
        onInput({
          type,
          targetId,
          x: e.clientX,
          y: e.clientY,
          button: e.button,
        });
      },
      opts
    );
  }

  // Keyboard events
  for (const type of ["keydown", "keyup", "keypress"] as const) {
    container.addEventListener(
      type,
      (e: KeyboardEvent) => {
        const targetId = getTargetId(e);
        if (!targetId) return;
        onInput({
          type,
          targetId,
          key: e.key,
          code: e.code,
          modifiers: getModifiers(e),
        });
      },
      opts
    );
  }

  // Input event (for text fields)
  container.addEventListener(
    "input",
    (e: Event) => {
      const targetId = getTargetId(e);
      if (!targetId) return;
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      onInput({
        type: "input",
        targetId,
        value: target.value ?? "",
      });
    },
    opts
  );

  // Focus/blur (use focusin/focusout for delegation since focus/blur don't bubble)
  container.addEventListener(
    "focusin",
    (e: FocusEvent) => {
      const targetId = getTargetId(e);
      if (!targetId) return;
      onInput({ type: "focus", targetId });
    },
    opts
  );

  container.addEventListener(
    "focusout",
    (e: FocusEvent) => {
      const targetId = getTargetId(e);
      if (!targetId) return;
      onInput({ type: "blur", targetId });
    },
    opts
  );

  // Scroll
  container.addEventListener(
    "scroll",
    (e: Event) => {
      const targetId = getTargetId(e);
      if (!targetId) return;
      const target = e.target as HTMLElement;
      onInput({
        type: "scroll",
        targetId,
        scrollTop: target.scrollTop,
        scrollLeft: target.scrollLeft,
      });
    },
    { ...opts, capture: true } // scroll doesn't bubble, use capture
  );

  // Resize (window-level)
  const resizeHandler = () => {
    onInput({
      type: "resize",
      width: window.innerWidth,
      height: window.innerHeight,
    });
  };
  window.addEventListener("resize", resizeHandler, opts);

  return {
    destroy() {
      ac.abort();
    },
  };
}
