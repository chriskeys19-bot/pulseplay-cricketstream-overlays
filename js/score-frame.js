/*
 * Point an iframe at a score_url, and if that host refuses to be framed
 * (or never paints), hide the frame and reveal the fallback link instead.
 */
(function (global) {
  var store = global.PulsePlayStore;

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

  function attach(opts) {
    var iframe = opts.iframe;
    var fallback = opts.fallback;
    var link = opts.link;
    var url = opts.url;
    var linkLabel = opts.linkLabel || "Open score";
    var safe = iframe ? store.safeUrl(url) : "";
    var key = safe || "";
    var blocked = !safe || store.hostBlocksEmbed(url);
    var token = blocked ? "blocked" : key;
    var ghost;

    if (!iframe) return;
    if ((iframe.getAttribute("data-current") || "") === token) return;
    if ((iframe.getAttribute("data-pending") || "") === token) return;

    if (link && link.getAttribute("href") !== (safe || "#")) {
      link.href = safe || "#";
      link.target = "_blank";
      link.rel = "noopener";
      setText(link, linkLabel);
    }

    if (blocked) {
      iframe.setAttribute("data-current", "blocked");
      iframe.removeAttribute("data-pending");
      if (iframe.getAttribute("src") && iframe.getAttribute("src") !== "about:blank") iframe.src = "about:blank";
      show(iframe, false);
      show(fallback, true);
      return;
    }

    iframe.setAttribute("data-pending", token);
    ghost = document.createElement("iframe");
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;";
    ghost.onload = function () {
      var live;
      ghost.onload = null;
      ghost.onerror = null;
      live = document.getElementById(iframe.id) || iframe;
      if (!live.parentNode || live.getAttribute("data-pending") !== token) {
        if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
        return;
      }
      ghost.id = live.id;
      ghost.removeAttribute("aria-hidden");
      ghost.removeAttribute("style");
      decorate(ghost);
      ghost.setAttribute("data-current", token);
      ghost.removeAttribute("data-pending");
      live.parentNode.replaceChild(ghost, live);
      show(ghost, true);
      show(fallback, false);
    };
    ghost.onerror = function () {
      var live;
      if (ghost.id === "score-frame") return;
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
      live = document.getElementById(iframe.id);
      if (!live || (live.getAttribute("data-pending") || "") !== token) return;
      live.setAttribute("data-current", token);
      live.removeAttribute("data-pending");
      if (live.getAttribute("src") !== safe) live.src = safe;
      show(live, true);
      show(fallback, false);
    };
    document.body.appendChild(ghost);
    ghost.src = safe;
  }

  global.PulsePlayScore = { attach: attach };
})(window);
