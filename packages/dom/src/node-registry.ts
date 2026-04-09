/**
 * Node registry — stable ID management for DOM nodes.
 *
 * Assigns a unique `data-rdid` attribute to every element node and
 * tracks text/comment nodes via an in-memory map. Provides bidirectional
 * lookup: node→id and id→node.
 */

const RDID = "data-rdid";

export interface NodeRegistry {
  /** Assign an ID to a node (idempotent) */
  assignId(node: Node): string;
  /** Walk a subtree and assign IDs to all nodes */
  walkAndAssign(node: Node): void;
  /** Get the ID of a node (assigns one if missing) */
  getIdOf(node: Node): string;
  /** Look up a node by its ID */
  getNodeById(id: string): Node | null;
  /** Look up a node by ID, with a fallback querySelector on a root */
  resolve(id: string, root?: ParentNode): Node | null;
  /** Clear all mappings */
  clear(): void;
}

/** Generate a UUID. Uses crypto.randomUUID where available, falls back to Math.random */
function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function createNodeRegistry(): NodeRegistry {
  const nodeToId = new WeakMap<Node, string>();
  const idToNode = new Map<string, Node>();

  function assignId(node: Node): string {
    const el = node as Element;
    if (node.nodeType === 1 /* ELEMENT_NODE */) {
      let id = el.getAttribute?.(RDID);
      if (!id) {
        id = generateId();
        el.setAttribute(RDID, id);
      }
      nodeToId.set(node, id);
      idToNode.set(id, node);
      return id;
    }
    // Text/comment nodes — no attributes, use in-memory tracking
    let id = nodeToId.get(node);
    if (!id) {
      id = generateId();
      nodeToId.set(node, id);
      idToNode.set(id, node);
    }
    return id;
  }

  function walkAndAssign(node: Node): void {
    assignId(node);
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      walkAndAssign(children[i]);
    }
  }

  function getIdOf(node: Node): string {
    return nodeToId.get(node) ?? assignId(node);
  }

  function getNodeById(id: string): Node | null {
    return idToNode.get(id) ?? null;
  }

  function resolve(id: string, root?: ParentNode): Node | null {
    const cached = idToNode.get(id);
    if (cached) return cached;
    if (root) {
      const el = root.querySelector(`[${RDID}="${id}"]`);
      if (el) {
        idToNode.set(id, el);
        nodeToId.set(el, id);
      }
      return el;
    }
    return null;
  }

  function clear(): void {
    idToNode.clear();
  }

  return { assignId, walkAndAssign, getIdOf, getNodeById, resolve, clear };
}

export { RDID };
