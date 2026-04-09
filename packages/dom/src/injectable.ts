/**
 * Injectable script for Puppeteer.
 *
 * This is an IIFE string that bundles the observer + input-dispatcher
 * for injection into Chrome pages via page.evaluateOnNewDocument().
 *
 * It wires up:
 * - window.__rdm_sendOps (callback exposed by Puppeteer bridge)
 * - window.__rdm_resolveTarget, __rdm_setInputValue, etc (input helpers)
 * - MutationObserver watching the entire document
 * - Initial snapshot on DOMContentLoaded
 *
 * This is the ONLY file that has Puppeteer-specific assumptions.
 * The actual logic is identical to the observer/dispatcher modules
 * but inlined as a string since it runs in Chrome's context.
 */

export const INJECTED_SCRIPT = `
(function() {
  if (window.__rdm_initialized) return;
  window.__rdm_initialized = true;

  var RDID = 'data-rdid';
  var nodeToId = new WeakMap();
  var idToNode = new Map();

  // ── ID management ──

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function assignId(node) {
    if (node.nodeType === 1) {
      var id = node.getAttribute(RDID);
      if (!id) { id = generateId(); node.setAttribute(RDID, id); }
      nodeToId.set(node, id);
      idToNode.set(id, node);
      return id;
    }
    var id = nodeToId.get(node);
    if (!id) { id = generateId(); nodeToId.set(node, id); idToNode.set(id, node); }
    return id;
  }

  function walkAndAssign(node) {
    assignId(node);
    var children = node.childNodes;
    for (var i = 0; i < children.length; i++) walkAndAssign(children[i]);
  }

  function getIdOf(node) { return nodeToId.get(node) || assignId(node); }

  // ── Serialization ──

  function serializeNode(node) {
    var id = getIdOf(node);
    if (node.nodeType === 3) return { id: id, type: 3, data: node.textContent || '' };
    if (node.nodeType === 8) return { id: id, type: 8, data: node.textContent || '' };
    if (node.nodeType !== 1) return null;
    var attrs = {};
    for (var i = 0; i < node.attributes.length; i++) attrs[node.attributes[i].name] = node.attributes[i].value;
    var children = [];
    for (var i = 0; i < node.childNodes.length; i++) {
      var s = serializeNode(node.childNodes[i]);
      if (s) children.push(s);
    }
    return { id: id, type: 1, tag: node.tagName.toLowerCase(), attrs: attrs, children: children };
  }

  // ── Op batching ──

  var pendingOps = [];
  var rafScheduled = false;

  function queueOps(ops) {
    for (var i = 0; i < ops.length; i++) pendingOps.push(ops[i]);
    if (!rafScheduled) { rafScheduled = true; requestAnimationFrame(flushOps); }
  }

  function flushOps() {
    rafScheduled = false;
    if (pendingOps.length === 0) return;
    var batch = pendingOps;
    pendingOps = [];
    try { window.__rdm_sendOps(JSON.stringify(batch)); } catch(e) {}
  }

  // ── MutationObserver ──

  function setupObserver() {
    var observer = new MutationObserver(function(mutations) {
      var ops = [];
      for (var i = 0; i < mutations.length; i++) {
        var mut = mutations[i];
        if (mut.type === 'attributes' && mut.attributeName === RDID) continue;
        switch (mut.type) {
          case 'childList': {
            var targetId = getIdOf(mut.target);
            var added = [], removed = [];
            for (var j = 0; j < mut.addedNodes.length; j++) {
              walkAndAssign(mut.addedNodes[j]);
              var s = serializeNode(mut.addedNodes[j]);
              if (s) added.push(s);
            }
            for (var j = 0; j < mut.removedNodes.length; j++) {
              var rid = nodeToId.get(mut.removedNodes[j]);
              if (rid) removed.push(rid);
            }
            var beforeId = mut.nextSibling ? (nodeToId.get(mut.nextSibling) || null) : null;
            if (added.length || removed.length) ops.push({ type: 'childList', targetId: targetId, added: added, removed: removed, beforeId: beforeId });
            break;
          }
          case 'attributes':
            ops.push({ type: 'attributes', targetId: getIdOf(mut.target), name: mut.attributeName, value: mut.target.getAttribute(mut.attributeName) });
            break;
          case 'characterData':
            ops.push({ type: 'characterData', targetId: getIdOf(mut.target), data: mut.target.textContent });
            break;
        }
      }
      if (ops.length > 0) queueOps(ops);
    });
    observer.observe(document.documentElement, { childList: true, attributes: true, characterData: true, subtree: true });
    return observer;
  }

  // ── Snapshot ──

  function sendSnapshot() {
    walkAndAssign(document.documentElement);
    try { window.__rdm_sendOps(JSON.stringify([{ type: 'snapshot', html: document.documentElement.outerHTML, sessionId: '' }])); } catch(e) {}
  }

  // ── Input dispatch helpers (called by Puppeteer bridge) ──

  window.__rdm_resolveTarget = function(rdid) {
    var node = idToNode.get(rdid) || document.querySelector('[' + RDID + '="' + rdid + '"]');
    if (!node) return null;
    var rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };

  window.__rdm_setInputValue = function(rdid, value) {
    var node = idToNode.get(rdid) || document.querySelector('[' + RDID + '="' + rdid + '"]');
    if (!node) return;
    var desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(node, value); else node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };

  window.__rdm_focusElement = function(rdid) {
    var node = idToNode.get(rdid) || document.querySelector('[' + RDID + '="' + rdid + '"]');
    if (node && node.focus) node.focus();
  };

  window.__rdm_blurElement = function(rdid) {
    var node = idToNode.get(rdid) || document.querySelector('[' + RDID + '="' + rdid + '"]');
    if (node && node.blur) node.blur();
  };

  window.__rdm_scrollTo = function(rdid, scrollTop, scrollLeft) {
    if (rdid === 'root') { window.scrollTo(scrollLeft, scrollTop); return; }
    var node = idToNode.get(rdid) || document.querySelector('[' + RDID + '="' + rdid + '"]');
    if (node) { node.scrollTop = scrollTop; node.scrollLeft = scrollLeft; }
  };

  window.__rdm_getScrollInfo = function() {
    var de = document.documentElement;
    return { scrollTop: window.scrollY || de.scrollTop, scrollLeft: window.scrollX || de.scrollLeft, scrollHeight: de.scrollHeight, clientHeight: window.innerHeight };
  };

  // ── Lazy image fix ──

  function fixLazyImages() {
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var dataSrc = img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
      if (dataSrc && (!img.src || img.src.includes('placeholder') || img.src.includes('data:') || img.src.includes('pixel'))) {
        img.setAttribute('src', dataSrc);
      }
      img.removeAttribute('loading');
    }
  }

  // ── Init ──

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setupObserver(); fixLazyImages(); sendSnapshot(); });
  } else {
    setupObserver(); fixLazyImages(); sendSnapshot();
  }
})();
`;
