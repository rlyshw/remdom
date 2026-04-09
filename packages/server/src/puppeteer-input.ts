import type { Page, KeyInput } from "puppeteer-core";
import type { InputOp } from "@remote-dom/protocol";

const BUTTON_MAP: Record<number, "left" | "middle" | "right"> = {
  0: "left",
  1: "middle",
  2: "right",
};

/**
 * Resolve a data-rdid to element coordinates in the page.
 * Returns center point of the element's bounding rect.
 */
async function resolveTarget(
  page: Page,
  rdid: string
): Promise<{ x: number; y: number } | null> {
  const rect = await page.evaluate(
    (id: string) => {
      const r = (window as any).__rdm_resolveTarget(id);
      if (r) {
        // Scroll element into view if off-screen
        const node = document.querySelector(`[data-rdid="${id}"]`);
        if (node) (node as HTMLElement).scrollIntoView?.({ block: "nearest" });
        // Re-get rect after scroll
        return (window as any).__rdm_resolveTarget(id);
      }
      return r;
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
  op: InputOp
): Promise<void> {
  switch (op.type) {
    case "click":
    case "dblclick": {
      const pos = await resolveTarget(page, op.targetId);
      if (!pos) return;
      // Move first so hover states update, then click
      await page.mouse.move(pos.x, pos.y);
      await page.mouse.click(pos.x, pos.y, {
        button: BUTTON_MAP[op.button] ?? "left",
        clickCount: op.type === "dblclick" ? 2 : 1,
      });
      break;
    }

    case "mousedown":
    case "mouseup": {
      // Skip — click handles the full cycle
      break;
    }

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
      await page.evaluate(
        (rdid: string, value: string) =>
          (window as any).__rdm_setInputValue(rdid, value),
        op.targetId,
        op.value
      );
      break;
    }

    case "scroll": {
      await page.evaluate(
        (rdid: string, top: number, left: number) =>
          (window as any).__rdm_scrollTo(rdid, top, left),
        op.targetId,
        op.scrollTop,
        op.scrollLeft
      );
      break;
    }

    case "focus": {
      await page.evaluate(
        (rdid: string) => (window as any).__rdm_focusElement(rdid),
        op.targetId
      );
      break;
    }

    case "blur": {
      await page.evaluate(
        (rdid: string) => (window as any).__rdm_blurElement(rdid),
        op.targetId
      );
      break;
    }

    case "resize": {
      await page.setViewport({ width: op.width, height: op.height });
      break;
    }

    case "navigate": {
      // Handled at the session level, not here
      break;
    }
  }
}
