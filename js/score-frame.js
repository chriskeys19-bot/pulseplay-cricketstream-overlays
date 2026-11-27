/*
 * Point an iframe at a score_url. When the URL changes, swap a fresh iframe
 * into #score-slot immediately. YoloBox's WebView often never fires onload
 * for a hidden offscreen frame, so this does not preload in a 1×1 ghost.
 * data-current stays the canonical URL (no ppbust), and a short watchdog
 * retries a load that never reports onload.
 */
(function (global) {
  var store = global.PulsePlayStore;
  var WATCH_MS = 4000;
  var MAX_ATTEMPTS = 3;

  function show(node, on) {
    if (!node) return;
    if (on) node.classList.remove("is-off");
    else node.classList.add("is-off");
  }

  function setText(node, text) {
    if (!node) return;
    if (node.textContent !== undefined) node.textContent = text;
    else node.innerText = text;
  }

  function looksLive(iframe) {
    try {
      var doc = iframe.contentDocument;
      if (!doc) return true;
      var href = "";
      try {
        href = String(doc.location.href || "");
      } catch (e) {
        return true;
      }
      if (!href || href === "about:blank") return false;
      return true;
    } catch (e2) {
      return true;
    }
  }

  function decorate(frame) {
    frame.setAttribute("title", "Match score");
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("allowtransparency", "true");
    if (frame.style.backgroundColor !== "transparent") frame.style.backgroundColor = "transparent";
  }

  function stripPpbust(url) {
    var hash = "";
    var base = String(url || "");
    var cut = base.indexOf("#");
    if (cut !== -1) {
      hash = base.substring(cut);
      base = base.substring(0, cut);
    }
    base = base.replace(/([?&])ppbust=[^&]*&/g, "$1").replace(/([?&])ppbust=[^&]*$/g, "");
    if (base.charAt(base.length - 1) === "?" || base.charAt(base.length - 1) === "&") {
      base = base.substring(0, base.length - 1);
    }
    return base + hash;
  }

  function bustUrl(url) {
    var canonical = stripPpbust(url);
    var hash = "";
    var base = canonical;
    var cut = base.indexOf("#");
    var stamp = new Date().getTime();
    if (cut !== -1) {
      hash = base.substring(cut);
      base = base.substring(0, cut);
    }
    return base + (base.indexOf("?") === -1 ? "?" : "&") + "ppbust=" + stamp + hash;
  }

  function childList(node) {
    var kids = node.children || node.childNodes;
    var list = [];
    var i;
    if (!kids) return list;
    for (i = 0; i < kids.length; i++) list.push(kids[i]);
    return list;
  }

  function isGhostFrame(node) {
    var css;
    var left;
    var id;
    if (!node || String(node.tagName || node.nodeName || "").toUpperCase() !== "IFRAME") return false;
    id = node.id || (node.getAttribute && node.getAttribute("id")) || "";
    if (id === "score-frame") return false;
    if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return true;
    css = node.style && node.style.cssText ? String(node.style.cssText) : "";
    if (css.indexOf("-9999px") !== -1) return true;
    left = node.style && node.style.left ? String(node.style.left) : "";
    if (left.indexOf("-9999") !== -1) return true;
    return false;
  }

  function clearGhosts() {
    var root = document.body || document.documentElement;
    if (!root) return;
    walk(root);
    function walk(node) {
      var list = childList(node);
      var i;
      var child;
      for (i = 0; i < list.length; i++) {
        child = list[i];
        if (isGhostFrame(child)) {
          child.onload = null;
          child.onerror = null;
          if (child.parentNode) child.parentNode.removeChild(child);
        } else if (child) {
          walk(child);
        }
      }
    }
  }

  function clearWatch(frame) {
    if (!frame || !frame._ppWatch) return;
    if (global.clearTimeout) global.clearTimeout(frame._ppWatch);
    frame._ppWatch = null;
  }

  function pendingStale(frame) {
    var at = parseInt(frame.getAttribute("data-pending-at") || "0", 10);
    if (!at) return true;
    return new Date().getTime() - at >= WATCH_MS;
  }

  function copyLook(from, to) {
    var css;
    to.id = from.id || "score-frame";
    if (from.className) to.className = from.className;
    css = from.style && from.style.cssText;
    if (css && to.style) to.style.cssText = css;
    decorate(to);
    if (to.classList) to.classList.remove("is-off");
  }

  function mountFrame(iframe, fresh) {
    var parent = iframe.parentNode || document.getElementById("score-slot");
    if (!parent) return false;
    clearWatch(iframe);
    if (iframe.parentNode === parent) parent.replaceChild(fresh, iframe);
    else {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      parent.appendChild(fresh);
    }
    return true;
  }

  function armWatch(frame, token, opts) {
    clearWatch(frame);
    if (!global.setTimeout) return;
    frame._ppWatch = global.setTimeout(function () {
      var live = document.getElementById(frame.id);
      frame._ppWatch = null;
      if (!live || live !== frame) return;
      if ((live.getAttribute("data-current") || "") === token) return;
      if ((live.getAttribute("data-pending") || "") !== token) return;
      live.setAttribute("data-pending-at", "0");
      attach({
        iframe: live,
        fallback: opts.fallback,
        link: opts.link,
        url: opts.url,
        linkLabel: opts.linkLabel
      });
    }, WATCH_MS);
  }

  function attach(opts) {
    var iframe = opts && opts.iframe;
    var fallback = opts && opts.fallback;
    var link = opts && opts.link;
    var url = opts && opts.url;
    var linkLabel = (opts && opts.linkLabel) || "Open score";
    var safe = iframe ? store.safeUrl(url) : "";
    var key = stripPpbust(safe || "");
    var blocked = !safe || store.hostBlocksEmbed(url);
    var token = blocked ? "blocked" : key;
    var pending;
    var attempts;
    var fresh;

    clearGhosts();
    if (!iframe) return;
    if ((iframe.getAttribute("data-current") || "") === token) return;

    if (link && link.getAttribute("href") !== (safe || "#")) {
      link.href = safe || "#";
      link.target = "_blank";
      link.rel = "noopener";
      setText(link, linkLabel);
    }

    if (blocked) {
      clearWatch(iframe);
      iframe.setAttribute("data-current", "blocked");
      iframe.removeAttribute("data-pending");
      iframe.removeAttribute("data-pending-at");
      if (iframe.getAttribute("src") && iframe.getAttribute("src") !== "about:blank") iframe.src = "about:blank";
      show(iframe, false);
      show(fallback, true);
      return;
    }

    pending = iframe.getAttribute("data-pending") || "";
    attempts = parseInt(iframe.getAttribute("data-score-attempts") || "0", 10);
    if (!attempts || attempts < 0) attempts = 0;
    if (pending === token) {
      if (attempts >= MAX_ATTEMPTS) return;
      if (!pendingStale(iframe)) return;
    } else {
      attempts = 0;
    }
    attempts += 1;

    fresh = document.createElement("iframe");
    copyLook(iframe, fresh);
    fresh.setAttribute("data-pending", token);
    fresh.setAttribute("data-pending-at", String(new Date().getTime()));
    fresh.setAttribute("data-score-attempts", String(attempts));
    fresh.onload = function () {
      fresh.onload = null;
      fresh.onerror = null;
      if (!fresh.parentNode) return;
      if (document.getElementById(fresh.id) !== fresh) return;
      if ((fresh.getAttribute("data-pending") || "") !== token) return;
      fresh.setAttribute("data-current", token);
      fresh.removeAttribute("data-pending");
      fresh.removeAttribute("data-pending-at");
      fresh.removeAttribute("data-score-attempts");
      clearWatch(fresh);
      show(fresh, true);
      show(fallback, false);
    };
    if (!mountFrame(iframe, fresh)) return;
    fresh.src = bustUrl(key);
    if (attempts < MAX_ATTEMPTS) armWatch(fresh, token, opts);
  }

  function hostOf(url) {
    var anchor = document.createElement("a");
    var host;
    anchor.href = url || "";
    host = (anchor.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") return "";
    return host;
  }

  function pathOf(url) {
    var anchor = document.createElement("a");
    anchor.href = url || "";
    return (anchor.pathname || "").toLowerCase();
  }

  /*
   * 2.15 suits the short overlay.cricclubs.com bar. A static.cricclubs.com
   * ccindex page already draws a full-size bar, so it stays at 1.
   * full_size true forces 1. full_size false forces the compact 2.15
   * (for a short link whose target we cannot see).
   */
  function frameScale(url, meta) {
    var host;
    var path;
    var text = String(url || "");
    if (meta && meta.full_size === true) return 1;
    if (meta && meta.full_size === false) return 2.15;
    host = hostOf(text);
    path = pathOf(text);
    if (host === "overlay.cricclubs.com" || text.indexOf("overlay.cricclubs.com") !== -1) return 2.15;
    if (host === "static.cricclubs.com") return 1;
    if (path.indexOf("ccindex") !== -1 || path.indexOf("/overlay-cc/") !== -1) return 1;
    return 1;
  }

  /*
   * ccindex.html is authored for a broadcast frame. At max-width 1800px its
   * stylesheet scales the page to 0.75 and translates the score bar down by
   * 80% of its height, which shoves the overs row out of a short iframe.
   * Give that page a 1920×240 viewport (wider than the breakpoint, tall
   * enough for the 144px result graphic and its 30px bottom inset) and let
   * the renderer scale it down to the slot. Other score URLs stay slot-sized.
   * Measured on CC_1712: the painted bar is 1203×144 and sits 30px up.
   */
  var FULL_VIEW = { width: 1920, height: 240 };

  function fullSizePage(url, meta) {
    var host;
    var path;
    var text = String(url || "");
    if (meta && meta.full_size === true) return true;
    if (meta && meta.full_size === false) return false;
    host = hostOf(text);
    path = pathOf(text);
    if (host === "overlay.cricclubs.com" || text.indexOf("overlay.cricclubs.com") !== -1) return false;
    if (host === "static.cricclubs.com") return true;
    if (path.indexOf("ccindex") !== -1 || path.indexOf("/overlay-cc/") !== -1) return true;
    return false;
  }

  function frameViewport(url, meta) {
    if (!fullSizePage(url, meta)) return null;
    return { width: FULL_VIEW.width, height: FULL_VIEW.height };
  }

  global.PulsePlayScore = {
    attach: attach,
    frameScale: frameScale,
    frameViewport: frameViewport,
    WATCH_MS: WATCH_MS,
    MAX_ATTEMPTS: MAX_ATTEMPTS
  };
})(window);
