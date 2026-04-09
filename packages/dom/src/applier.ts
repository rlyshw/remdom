/**
 * DOM Applier — takes MutationOps and applies them to a local DOM.
 * Transport-agnostic: receives ops from any source.
 */

import type {
  MutationOp,
  SerializedNode,
  SnapshotOp,
  ChildListOp,
  AttributesOp,
  CharacterDataOp,
  PropertyOp,
} from "@remdom/protocol";
import { RDID } from "./node-registry.js";

export class DomApplier {
  private container: HTMLElement;
  private sessionId: string | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  apply(op: MutationOp): void {
    switch (op.type) {
      case "snapshot":
        this.applySnapshot(op);
        break;
      case "childList":
        this.applyChildList(op);
        break;
      case "attributes":
        this.applyAttributes(op);
        break;
      case "characterData":
        this.applyCharacterData(op);
        break;
      case "property":
        this.applyProperty(op);
        break;
    }
  }

  private applySnapshot(op: SnapshotOp): void {
    this.sessionId = op.sessionId;
    this.container.innerHTML = op.html;
  }

  private findNode(id: string): Element | null {
    return this.container.querySelector(`[${RDID}="${id}"]`);
  }

  private applyChildList(op: ChildListOp): void {
    const target = this.findNode(op.targetId);
    if (!target) return;

    for (const removedId of op.removed) {
      const node = this.findNode(removedId);
      if (node) {
        node.remove();
      } else {
        // Text/comment nodes don't have data-rdid attributes
        for (const child of Array.from(target.childNodes)) {
          if ((child as any).__rdid === removedId) {
            child.remove();
            break;
          }
        }
      }
    }

    const refNode = op.beforeId ? this.findNode(op.beforeId) : null;
    for (const serialized of op.added) {
      const node = this.createNode(serialized);
      if (refNode) {
        target.insertBefore(node, refNode);
      } else {
        target.appendChild(node);
      }
    }
  }

  private createNode(serialized: SerializedNode): Node {
    if (serialized.type === 3) {
      const text = document.createTextNode(serialized.data ?? "");
      (text as any).__rdid = serialized.id;
      return text;
    }
    if (serialized.type === 8) {
      const comment = document.createComment(serialized.data ?? "");
      (comment as any).__rdid = serialized.id;
      return comment;
    }
    const el = document.createElement(serialized.tag ?? "div");
    if (serialized.attrs) {
      for (const [name, value] of Object.entries(serialized.attrs)) {
        el.setAttribute(name, value);
      }
    }
    if (serialized.children) {
      for (const child of serialized.children) {
        el.appendChild(this.createNode(child));
      }
    }
    return el;
  }

  private applyAttributes(op: AttributesOp): void {
    const target = this.findNode(op.targetId);
    if (!target) return;
    if (op.value === null) {
      target.removeAttribute(op.name);
    } else {
      target.setAttribute(op.name, op.value);
    }
  }

  private applyCharacterData(op: CharacterDataOp): void {
    const walker = document.createTreeWalker(
      this.container,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT
    );
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if ((node as any).__rdid === op.targetId) {
        node.textContent = op.data;
        return;
      }
    }
  }

  private applyProperty(op: PropertyOp): void {
    const target = this.findNode(op.targetId) as any;
    if (!target) return;
    target[op.prop] = op.value;
  }
}
