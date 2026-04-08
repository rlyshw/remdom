export interface ClientPageOptions {
  title?: string;
  styles?: string;
  /** Show a URL bar for navigating to arbitrary URLs */
  urlBar?: boolean;
  /** Bookmarks to show under the URL bar */
  bookmarks?: { label: string; url: string }[];
}

/**
 * Returns a self-contained HTML page that connects to the remote-dom server
 * via WebSocket, applies DOM mutations, and captures user input.
 */
export function getClientPage(options: ClientPageOptions = {}): string {
  const { title = "remote-dom", styles = "", urlBar = false, bookmarks = [] } = options;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
    #rdm-chrome {
      display: none !important; position: sticky !important; top: 0 !important; z-index: 99998 !important;
      background: #1a1a2e !important; padding: 6px 10px !important;
      border-bottom: 1px solid #333 !important; flex-shrink: 0 !important;
    }
    #rdm-chrome.visible { display: flex !important; align-items: center !important; gap: 8px !important; }
    #rdm-url-form { display: flex; flex: 1; gap: 6px; }
    .rdm-nav-btn {
      padding: 4px 10px; border-radius: 20px; border: 1px solid #444;
      background: transparent; color: #aaa; font-size: 16px;
      cursor: pointer; line-height: 1;
    }
    .rdm-nav-btn:hover { background: #2a2a4e; color: #ddd; }
    .rdm-nav-btn:disabled { opacity: 0.3; cursor: default; }
    .rdm-nav-btn:disabled:hover { background: transparent; color: #aaa; }
    #rdm-url {
      flex: 1; padding: 6px 12px; border-radius: 20px;
      border: 1px solid #444; background: #0f0f23; color: #e0e0e0;
      font-size: 14px; font-family: system-ui, monospace;
      outline: none;
    }
    #rdm-url:focus { border-color: #6c6cff; }
    #rdm-go {
      padding: 6px 16px; border-radius: 20px; border: none;
      background: #4a4aff; color: white; font-size: 13px;
      cursor: pointer; font-weight: 500;
    }
    #rdm-go:hover { background: #5e5eff; }
    #rdm-nav-status { color: #888; font-size: 12px; white-space: nowrap; }
    #rdm-bookmarks {
      display: none !important; background: #1a1a2e !important; padding: 2px 10px 6px !important;
      border-bottom: 1px solid #333 !important; gap: 4px !important; flex-wrap: wrap !important; flex-shrink: 0 !important;
    }
    #rdm-bookmarks.visible { display: flex !important; }
    .rdm-bookmark {
      padding: 3px 10px; border-radius: 12px; border: 1px solid #444;
      background: transparent; color: #aaa; font-size: 12px;
      cursor: pointer; text-decoration: none; white-space: nowrap;
    }
    .rdm-bookmark:hover { background: #2a2a4e; color: #ddd; border-color: #666; }
    #remote-dom-root {
      flex: 1 !important; width: 100% !important; overflow: auto !important;
      display: block !important; position: relative !important;
    }
    .rdm-status {
      position: fixed; bottom: 8px; right: 8px;
      padding: 4px 8px; border-radius: 4px; font-size: 12px;
      background: #333; color: #fff; opacity: 0.7; z-index: 99999;
    }
    .rdm-status.connected { background: #2d7d2d; }
    .rdm-status.disconnected { background: #7d2d2d; }
    ${styles}
  </style>
</head>
<body>
  <div id="rdm-chrome">
    <button id="rdm-back" class="rdm-nav-btn" disabled>&larr;</button>
    <button id="rdm-fwd" class="rdm-nav-btn" disabled>&rarr;</button>
    <form id="rdm-url-form">
      <input id="rdm-url" type="text" placeholder="Enter URL..." spellcheck="false" autocomplete="off">
      <button id="rdm-go" type="submit">Go</button>
    </form>
    <span id="rdm-nav-status"></span>
  </div>
  <div id="rdm-bookmarks"></div>
  <div id="remote-dom-root"></div>
  <div id="rdm-status" class="rdm-status disconnected">disconnected</div>
  <script>
    const RDID = "data-rdid";
    const container = document.getElementById("remote-dom-root");
    const statusEl = document.getElementById("rdm-status");

    // URL bar setup
    const rdmChrome = document.getElementById("rdm-chrome");
    const urlInput = document.getElementById("rdm-url");
    const urlForm = document.getElementById("rdm-url-form");
    const navStatus = document.getElementById("rdm-nav-status");
    const showUrlBar = ${urlBar};
    if (showUrlBar) rdmChrome.classList.add("visible");

    // Navigation history
    const backBtn = document.getElementById("rdm-back");
    const fwdBtn = document.getElementById("rdm-fwd");
    const navHistory = [];
    let navIndex = -1;
    let isHistoryNav = false;

    function pushHistory(url) {
      if (isHistoryNav) { isHistoryNav = false; return; }
      // Trim forward history
      navHistory.splice(navIndex + 1);
      navHistory.push(url);
      navIndex = navHistory.length - 1;
      updateNavButtons();
    }

    function updateNavButtons() {
      if (backBtn) backBtn.disabled = navIndex <= 0;
      if (fwdBtn) fwdBtn.disabled = navIndex >= navHistory.length - 1;
    }

    if (backBtn) backBtn.addEventListener("click", function() {
      if (navIndex > 0) {
        navIndex--;
        isHistoryNav = true;
        const url = navHistory[navIndex];
        if (urlInput) urlInput.value = url;
        if (navStatus) navStatus.textContent = "loading...";
        if (wsSend) wsSend({ type: "navigate", url: url });
        updateNavButtons();
      }
    });

    if (fwdBtn) fwdBtn.addEventListener("click", function() {
      if (navIndex < navHistory.length - 1) {
        navIndex++;
        isHistoryNav = true;
        const url = navHistory[navIndex];
        if (urlInput) urlInput.value = url;
        if (navStatus) navStatus.textContent = "loading...";
        if (wsSend) wsSend({ type: "navigate", url: url });
        updateNavButtons();
      }
    });

    // Bookmarks
    const bookmarksBar = document.getElementById("rdm-bookmarks");
    const bookmarks = ${JSON.stringify(bookmarks)};
    if (bookmarks.length > 0) {
      bookmarksBar.classList.add("visible");
      bookmarks.forEach(function(b) {
        const btn = document.createElement("button");
        btn.className = "rdm-bookmark";
        btn.textContent = b.label;
        btn.addEventListener("click", function() {
          if (urlInput) urlInput.value = b.url;
          if (navStatus) navStatus.textContent = "loading...";
          if (wsSend) wsSend({ type: "navigate", url: b.url });
        });
        bookmarksBar.appendChild(btn);
      });
    }

    function findNode(id) {
      return container.querySelector('[' + RDID + '="' + id + '"]');
    }

    function createNode(s) {
      if (s.type === 3) {
        const t = document.createTextNode(s.data || "");
        t.__rdid = s.id;
        return t;
      }
      if (s.type === 8) {
        const c = document.createComment(s.data || "");
        c.__rdid = s.id;
        return c;
      }
      const el = document.createElement(s.tag || "div");
      if (s.attrs) {
        for (const [k, v] of Object.entries(s.attrs)) {
          el.setAttribute(k, v);
        }
      }
      if (s.children) {
        for (const child of s.children) {
          el.appendChild(createNode(child));
        }
      }
      return el;
    }

    function applyOp(op) {
      if (op.type === "reload") { location.reload(); return; }
      if (op.type === "scroll") {
        remoteScrolling = true;
        const maxY = container.scrollHeight - container.clientHeight;
        const maxX = container.scrollWidth - container.clientWidth;
        container.scrollTop = op.scrollTop * maxY;
        container.scrollLeft = op.scrollLeft * maxX;
        requestAnimationFrame(() => { remoteScrolling = false; });
        return;
      }
      switch (op.type) {
        case "snapshot":
          container.innerHTML = op.html;
          break;
        case "childList": {
          const target = findNode(op.targetId);
          if (!target) break;
          for (const rid of op.removed) {
            const node = findNode(rid);
            if (node) { node.remove(); continue; }
            let found = false;
            for (const child of Array.from(target.childNodes)) {
              if (child.__rdid === rid) { child.remove(); found = true; break; }
            }
            if (!found) {
              for (const child of Array.from(target.childNodes)) {
                if (child.nodeType !== 1) child.remove();
              }
            }
          }
          const ref = op.beforeId ? findNode(op.beforeId) : null;
          for (const added of op.added) {
            const node = createNode(added);
            if (ref) target.insertBefore(node, ref);
            else target.appendChild(node);
          }
          break;
        }
        case "attributes": {
          const target = findNode(op.targetId);
          if (!target) break;
          if (op.value === null) target.removeAttribute(op.name);
          else target.setAttribute(op.name, op.value);
          break;
        }
        case "characterData": {
          const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);
          let node;
          while ((node = walker.nextNode())) {
            if (node.__rdid === op.targetId) { node.textContent = op.data; break; }
          }
          break;
        }
        case "property": {
          const target = findNode(op.targetId);
          if (target) target[op.prop] = op.value;
          break;
        }
      }
    }

    function getTargetId(e) {
      let el = e.target;
      while (el) {
        const id = el.getAttribute?.(RDID);
        if (id) return id;
        el = el.parentElement;
      }
      return null;
    }

    function getModifiers(e) {
      let m = 0;
      if (e.shiftKey) m |= 1;
      if (e.ctrlKey) m |= 2;
      if (e.altKey) m |= 4;
      if (e.metaKey) m |= 8;
      return m;
    }

    // URL bar navigation
    let wsSend = null;
    if (showUrlBar) {
      urlForm.addEventListener("submit", (e) => {
        e.preventDefault();
        let url = urlInput.value.trim();
        if (!url) return;
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          url = "https://" + url;
          urlInput.value = url;
        }
        navStatus.textContent = "loading...";
        if (wsSend) wsSend({ type: "navigate", url });
      });
    }

    // Set up input listeners once, use a mutable send reference
    let currentSend = function(op) {};

    // Intercept link clicks at capture phase
    container.addEventListener("click", (e) => {
      let el = e.target;
      while (el && el !== container) {
        if (el.tagName === "A" && el.getAttribute("href")) {
          const href = el.getAttribute("href");
          if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
            e.preventDefault();
            e.stopPropagation();
            if (showUrlBar) navStatus.textContent = "loading...";
            currentSend({ type: "navigate", url: href });
            return;
          }
        }
        el = el.parentElement;
      }
      const targetId = getTargetId(e);
      if (targetId) currentSend({ type: "click", targetId, x: e.clientX, y: e.clientY, button: e.button });
    }, true);
    for (const type of ["dblclick", "mousedown", "mouseup"]) {
      container.addEventListener(type, (e) => {
        const targetId = getTargetId(e);
        if (targetId) currentSend({ type, targetId, x: e.clientX, y: e.clientY, button: e.button });
      });
    }
    for (const type of ["keydown", "keyup", "keypress"]) {
      container.addEventListener(type, (e) => {
        const targetId = getTargetId(e);
        if (targetId) currentSend({ type, targetId, key: e.key, code: e.code, modifiers: getModifiers(e) });
      });
    }
    container.addEventListener("input", (e) => {
      const targetId = getTargetId(e);
      if (targetId) currentSend({ type: "input", targetId, value: e.target.value || "" });
    });
    container.addEventListener("focusin", (e) => {
      const targetId = getTargetId(e);
      if (targetId) currentSend({ type: "focus", targetId });
    });
    container.addEventListener("focusout", (e) => {
      const targetId = getTargetId(e);
      if (targetId) currentSend({ type: "blur", targetId });
    });
    let scrollSendRaf = null;
    let remoteScrolling = false;
    container.addEventListener("scroll", () => {
      if (remoteScrolling) return;
      if (!scrollSendRaf) {
        scrollSendRaf = requestAnimationFrame(() => {
          scrollSendRaf = null;
          const maxY = container.scrollHeight - container.clientHeight;
          const maxX = container.scrollWidth - container.clientWidth;
          const pctY = maxY > 0 ? container.scrollTop / maxY : 0;
          const pctX = maxX > 0 ? container.scrollLeft / maxX : 0;
          currentSend({ type: "scroll", targetId: "root", scrollTop: pctY, scrollLeft: pctX });
        });
      }
    }, { passive: true });
    window.addEventListener("resize", () => {
      currentSend({ type: "resize", width: window.innerWidth, height: window.innerHeight });
    });

    function connectWs() {
      const wsUrl = (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host;
      const ws = new WebSocket(wsUrl);

      function send(op) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(op));
      }

      ws.addEventListener("open", () => {
        currentSend = send;
        wsSend = send;
        statusEl.textContent = "connected";
        statusEl.className = "rdm-status connected";
      });

      ws.addEventListener("message", (event) => {
        try {
          const op = JSON.parse(event.data);
          if (op.type === "navigated" && showUrlBar) {
            urlInput.value = op.url;
            navStatus.textContent = "";
            pushHistory(op.url);
            return;
          }
          if (op.type === "snapshot" && showUrlBar) {
            navStatus.textContent = "";
          }
          applyOp(op);
        }
        catch (err) { console.error("[remote-dom] decode error:", err); }
      });

      ws.addEventListener("close", () => {
        currentSend = function() {};
        statusEl.textContent = "disconnected";
        statusEl.className = "rdm-status disconnected";
        setTimeout(connectWs, 1000);
      });
    }

    connectWs();
  </script>
</body>
</html>`;
}
