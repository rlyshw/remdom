/**
 * Serialize a DOM node into a SerializedNode structure.
 * Uses a NodeRegistry to assign/resolve stable IDs.
 */

import type { SerializedNode } from "@remdom/protocol";
import type { NodeRegistry } from "./node-registry.js";

export function serializeNode(node: Node, registry: NodeRegistry): SerializedNode | null {
  const id = registry.getIdOf(node);

  if (node.nodeType === 3 /* TEXT_NODE */) {
    return { id, type: 3, data: node.textContent ?? "" };
  }

  if (node.nodeType === 8 /* COMMENT_NODE */) {
    return { id, type: 8, data: node.textContent ?? "" };
  }

  if (node.nodeType !== 1 /* ELEMENT_NODE */) {
    return null;
  }

  const el = node as Element;
  const attrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    attrs[attr.name] = attr.value;
  }

  const children: SerializedNode[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = serializeNode(el.childNodes[i], registry);
    if (child) children.push(child);
  }

  return {
    id,
    type: 1,
    tag: el.tagName.toLowerCase(),
    attrs,
    children,
  };
}
