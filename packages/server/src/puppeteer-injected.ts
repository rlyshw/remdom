/**
 * This module exports the script that gets injected into Chrome pages
 * via page.evaluateOnNewDocument(). It runs in the browser context (not Node).
 *
 * Responsibilities:
 * - Assign data-rdid to all DOM nodes
 * - Send initial snapshot
 * - Watch for mutations via MutationObserver
 * - Serialize mutations into MutationOp format
 * - Expose helper functions for input dispatch
 */

export const INJECTED_SCRIPT = `
(function() {
  // Prevent double-injection
  if (window.__rdm_initialized) return;
  window.__rdm_initialized = true;

  const RDID = 'data-rdid';
  const nodeToId = new WeakMap();
  const idToNode = new Map();

  // ── ID management ──

  function assignId(node) {
    if (node.nodeType === 1) {
      let id = node.getAttribute(RDID);
      if (!id) {
        id = crypto.randomUUID();
        node.setAttribute(RDID, id);
      }
      nodeToId.set(node, id);
      idToNode.set(id, node);
      return id;
    }
    // Text/comment nodes
    let id = nodeToId.get(node);
    if (!id) {
      id = crypto.randomUUID();
      nodeToId.set(node, id);
      idToNode.set(id, node);
    }
    return id;
  }

  function walkAndAssign(node) {
    assignId(node);
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      walkAndAssign(children[i]);
    }
  }

  function getIdOf(node) {
    return nodeToId.get(node) || assignId(node);
  }

  // ── Serialization ──

  function serializeNode(node) {
    const id = getIdOf(node);
    if (node.nodeType === 3) {
      return { id: id, type: 3, data: node.textContent || '' };
    }
    if (node.nodeType === 8) {
      return { id: id, type: 8, data: node.textContent || '' };
    }
    if (node.nodeType !== 1) return null;

    const attrs = {};
    const nodeAttrs = node.attributes;
    for (let i = 0; i < nodeAttrs.length; i++) {
      attrs[nodeAttrs[i].name] = nodeAttrs[i].value;
    }
    const children = [];
    const childNodes = node.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
      const s = serializeNode(childNodes[i]);
      if (s) children.push(s);
    }
    return {
      id: id,
      type: 1,
      tag: node.tagName.toLowerCase(),
      attrs: attrs,
      children: children
    };
  }

  // ── Op batching ──

  let pendingOps = [];
  let rafScheduled = false;

  function queueOps(ops) {
    for (let i = 0; i < ops.length; i++) {
      pendingOps.push(ops[i]);
    }
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(flushOps);
    }
  }

  function flushOps() {
    rafScheduled = false;
    if (pendingOps.length === 0) return;
    const batch = pendingOps;
    pendingOps = [];
    try {
      window.__rdm_sendOps(JSON.stringify(batch));
    } catch (e) {
      // exposeFunction not ready yet
    }
  }

  // ── MutationObserver ──

  function setupObserver() {
    const observer = new MutationObserver(function(mutations) {
      const ops = [];

      for (let i = 0; i < mutations.length; i++) {
        const mut = mutations[i];

        // Skip our own data-rdid attribute changes
        if (mut.type === 'attributes' && mut.attributeName === RDID) continue;

        switch (mut.type) {
          case 'childList': {
            const targetId = getIdOf(mut.target);
            const added = [];
            const removed = [];

            for (let j = 0; j < mut.addedNodes.length; j++) {
              const node = mut.addedNodes[j];
              walkAndAssign(node);
              const s = serializeNode(node);
              if (s) added.push(s);
            }

            for (let j = 0; j < mut.removedNodes.length; j++) {
              const node = mut.removedNodes[j];
              const rid = nodeToId.get(node);
              if (rid) removed.push(rid);
            }

            const nextSib = mut.nextSibling;
            const beforeId = nextSib ? (nodeToId.get(nextSib) || null) : null;

            if (added.length > 0 || removed.length > 0) {
              ops.push({
                type: 'childList',
                targetId: targetId,
                added: added,
                removed: removed,
                beforeId: beforeId
              });
            }
            break;
          }

          case 'attributes': {
            ops.push({
              type: 'attributes',
              targetId: getIdOf(mut.target),
              name: mut.attributeName,
              value: mut.target.getAttribute(mut.attributeName)
            });
            break;
          }

          case 'characterData': {
            ops.push({
              type: 'characterData',
              targetId: getIdOf(mut.target),
              data: mut.target.textContent
            });
            break;
          }
        }
      }

      if (ops.length > 0) {
        queueOps(ops);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true
    });

    return observer;
  }

  // ── Initial snapshot ──

  function sendSnapshot() {
    walkAndAssign(document.documentElement);
    const html = document.documentElement.outerHTML;
    try {
      window.__rdm_sendOps(JSON.stringify([{
        type: 'snapshot',
        html: html,
        sessionId: ''
      }]));
    } catch (e) {
      // exposeFunction not ready yet — will retry
    }
  }

  // ── Helper functions for input dispatch ──

  window.__rdm_resolveTarget = function(rdid) {
    const node = idToNode.get(rdid) || document.querySelector('[' + RDID + '="' + rdid + '"]');
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    };
  };

  window.__rdm_setInputValue = function(rdid, value) {
    const node = idToNode.get(rdid) || document.querySelector('[' + RDID + '="' + rdid + '"]');
    if (!node) return;
    // Use native setter to trigger React/framework change detection
    const proto = Object.getPrototypeOf(node);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value') ||
                       Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(node, value);
    } else {
      node.value = value;
    }
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };

  window.__rdm_focusElement = function(rdid) {
    const node = idToNode.get(rdid) || document.querySelector('[' + RDID + '="' + rdid + '"]');
    if (node && node.focus) node.focus();
  };

  window.__rdm_blurElement = function(rdid) {
    const node = idToNode.get(rdid) || document.querySelector('[' + RDID + '="' + rdid + '"]');
    if (node && node.blur) node.blur();
  };

  window.__rdm_scrollTo = function(rdid, scrollTop, scrollLeft) {
    if (rdid === 'root') {
      window.scrollTo(scrollLeft, scrollTop);
      return;
    }
    const node = idToNode.get(rdid) || document.querySelector('[' + RDID + '="' + rdid + '"]');
    if (node) {
      node.scrollTop = scrollTop;
      node.scrollLeft = scrollLeft;
    }
  };

  window.__rdm_getScrollInfo = function() {
    const de = document.documentElement;
    return {
      scrollTop: window.scrollY || de.scrollTop,
      scrollLeft: window.scrollX || de.scrollLeft,
      scrollHeight: de.scrollHeight,
      clientHeight: window.innerHeight
    };
  };

  // ── Init ──

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setupObserver();
      sendSnapshot();
    });
  } else {
    setupObserver();
    sendSnapshot();
  }
})();
`;
