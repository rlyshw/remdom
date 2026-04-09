/**
 * Minimal test client page.
 *
 * Connects to the remdom server, renders the streamed DOM, captures
 * basic input. No browser chrome, no URL bar, no navigation controls.
 * For a full browser experience, see remdom-browser.
 */

export interface ClientPageOptions {
  title?: string;
}

export function getClientPage(options: ClientPageOptions = {}): string {
  const { title = "remote-dom" } = options;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; overflow: hidden; height: 100vh; }
    #rdm-root { width: 100%; height: 100%; overflow: auto; -webkit-overflow-scrolling: touch; }
    #rdm-status {
      position: fixed; bottom: 8px; right: 8px; padding: 4px 8px;
      border-radius: 4px; font-size: 11px; font-family: system-ui;
      background: #333; color: #fff; opacity: 0.6; z-index: 99999;
    }
  </style>
</head>
<body>
  <div id="rdm-root"></div>
  <div id="rdm-status">connecting...</div>
  <script>
    var RDID = "data-rdid";
    var root = document.getElementById("rdm-root");
    var statusEl = document.getElementById("rdm-status");

    // ── Applier ──

    function findNode(id) {
      return root.querySelector("[" + RDID + '="' + id + '"]');
    }

    function createNode(s) {
      if (s.type === 3) { var t = document.createTextNode(s.data || ""); t.__rdid = s.id; return t; }
      if (s.type === 8) { var c = document.createComment(s.data || ""); c.__rdid = s.id; return c; }
      var el = document.createElement(s.tag || "div");
      if (s.attrs) for (var k in s.attrs) el.setAttribute(k, s.attrs[k]);
      if (s.children) for (var i = 0; i < s.children.length; i++) el.appendChild(createNode(s.children[i]));
      return el;
    }

    function applyOp(op) {
      switch (op.type) {
        case "snapshot": root.innerHTML = op.html; break;
        case "childList": {
          var target = findNode(op.targetId); if (!target) break;
          for (var i = 0; i < op.removed.length; i++) {
            var n = findNode(op.removed[i]);
            if (n) n.remove();
            else for (var c of Array.from(target.childNodes)) { if (c.__rdid === op.removed[i]) { c.remove(); break; } }
          }
          var ref = op.beforeId ? findNode(op.beforeId) : null;
          for (var i = 0; i < op.added.length; i++) {
            var n = createNode(op.added[i]);
            ref ? target.insertBefore(n, ref) : target.appendChild(n);
          }
          break;
        }
        case "attributes": {
          var t = findNode(op.targetId); if (!t) break;
          op.value === null ? t.removeAttribute(op.name) : t.setAttribute(op.name, op.value);
          break;
        }
        case "characterData": {
          var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
          var n; while ((n = w.nextNode())) { if (n.__rdid === op.targetId) { n.textContent = op.data; break; } }
          break;
        }
        case "property": {
          var t = findNode(op.targetId); if (t) t[op.prop] = op.value;
          break;
        }
      }
    }

    // ── Input capture ──

    function getTargetId(e) {
      var el = e.target;
      while (el && el !== root) { var id = el.getAttribute && el.getAttribute(RDID); if (id) return id; el = el.parentElement; }
      return null;
    }

    var send = function() {};

    root.addEventListener("click", function(e) {
      // Intercept links
      var el = e.target;
      while (el && el !== root) {
        if (el.tagName === "A" && el.getAttribute("href")) {
          var href = el.getAttribute("href");
          if (href && href.charAt(0) !== "#" && href.indexOf("javascript:") !== 0) {
            e.preventDefault(); e.stopPropagation();
            send({ type: "navigate", url: href });
            return;
          }
        }
        el = el.parentElement;
      }
      var id = getTargetId(e);
      if (id) send({ type: "click", targetId: id, x: e.clientX, y: e.clientY, button: e.button });
    }, true);

    root.addEventListener("input", function(e) {
      var id = getTargetId(e);
      if (id) send({ type: "input", targetId: id, value: e.target.value || "" });
    });

    root.addEventListener("submit", function(e) {
      e.preventDefault(); e.stopPropagation();
      if (e.target && e.target.action) send({ type: "navigate", url: e.target.action });
    }, true);

    root.addEventListener("scroll", function() {
      var maxY = root.scrollHeight - root.clientHeight;
      send({ type: "scroll", targetId: "root", scrollTop: maxY > 0 ? root.scrollTop / maxY : 0, scrollLeft: 0 });
    }, { passive: true });

    // ── WebSocket ──

    function connect() {
      var wsUrl = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host;
      var ws = new WebSocket(wsUrl);

      ws.onopen = function() {
        statusEl.textContent = "connected";
        statusEl.style.background = "#2d7d2d";
        send = function(op) { if (ws.readyState === 1) ws.send(JSON.stringify(op)); };
      };

      ws.onmessage = function(e) {
        try { applyOp(JSON.parse(e.data)); } catch(err) { console.error(err); }
      };

      ws.onerror = function(e) {
        statusEl.textContent = "error";
        statusEl.style.background = "#7d2d2d";
        console.error("[remdom] WS error:", e);
      };

      ws.onclose = function() {
        statusEl.textContent = "reconnecting...";
        statusEl.style.background = "#7d5d2d";
        send = function() {};
        setTimeout(connect, 1000);
      };
    }

    connect();
  </script>
</body>
</html>`;
}
