import type { Page, KeyInput } from "puppeteer-core";
import type { InputOp } from "@remdom/protocol";

type SafeEvaluate = <T>(fn: string | ((...args: any[]) => T), ...args: any[]) => Promise<T | null>;

const BUTTON_MAP: Record<number, "left" | "middle" | "right"> = {
  0: "left",
  1: "middle",
  2: "right",
};

/**
 * Resolve a data-rdid to element coordinates in the page.
 * Scrolls element into view, returns center point of bounding rect.
 */
async function resolveTarget(
  page: Page,
  rdid: string,
  safeEval: SafeEvaluate
): Promise<{ x: number; y: number } | null> {
  const rect = await safeEval(
    (id: string) => {
      const node = document.querySelector(`[data-rdid="${id}"]`);
      if (!node) return null;
      (node as HTMLElement).scrollIntoView?.({ block: "nearest", inline: "nearest" });
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    rdid
  );
  if (!rect || rect.width === 0 || rect.height === 0) return null;
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/**
 * Dispatch an InputOp into a Puppeteer page.
 */
export async function dispatchPuppeteerInput(
  page: Page,
  op: InputOp,
  safeEval?: SafeEvaluate
): Promise<void> {
  const evaluate = safeEval ?? (async <T>(fn: any, ...args: any[]) => {
    try { return await page.evaluate(fn, ...args) as T; }
    catch { return null as T; }
  });

  switch (op.type) {
    case "click":
    case "dblclick": {
      const pos = await resolveTarget(page, op.targetId, evaluate);
      if (!pos) return;
      await page.mouse.move(pos.x, pos.y);
      await page.mouse.click(pos.x, pos.y, {
        button: BUTTON_MAP[op.button] ?? "left",
        clickCount: op.type === "dblclick" ? 2 : 1,
      });
      break;
    }

    case "mousedown":
    case "mouseup":
      break;

    case "keydown": {
      await page.keyboard.down(op.key as KeyInput);
      break;
    }

    case "keyup": {
      await page.keyboard.up(op.key as KeyInput);
      break;
    }

    case "keypress": {
      await page.keyboard.press(op.key as KeyInput);
      break;
    }

    case "input": {
      await evaluate(
        (rdid: string, value: string) =>
          (window as any).__rdm_setInputValue?.(rdid, value),
        op.targetId,
        op.value
      );
      break;
    }

    case "scroll": {
      await evaluate(
        (rdid: string, top: number, left: number) =>
          (window as any).__rdm_scrollTo?.(rdid, top, left),
        op.targetId,
        op.scrollTop,
        op.scrollLeft
      );
      break;
    }

    case "focus": {
      await evaluate(
        (rdid: string) => (window as any).__rdm_focusElement?.(rdid),
        op.targetId
      );
      break;
    }

    case "blur": {
      await evaluate(
        (rdid: string) => (window as any).__rdm_blurElement?.(rdid),
        op.targetId
      );
      break;
    }

    case "resize": {
      await page.setViewport({ width: op.width, height: op.height });
      break;
    }

    case "navigate":
      break;
  }
}
