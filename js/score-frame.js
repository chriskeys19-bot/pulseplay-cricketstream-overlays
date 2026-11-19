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

  function attach(opts) {
    var iframe = opts.iframe;
    var fallback = opts.fallback;
    var link = opts.link;
    var url = opts.url;
    var linkLabel = opts.linkLabel || "Open score";
    var safe;
    var settled;

    if (!iframe) return;
    safe = store.safeUrl(url);

    if (link) {
      link.href = safe || "#";
      link.target = "_blank";
      link.rel = "noopener";
      setText(link, linkLabel);
    }

    if (!safe || store.hostBlocksEmbed(url)) {
      iframe.setAttribute("data-current", "");
      iframe.src = "about:blank";
      show(iframe, false);
      show(fallback, true);
      return;
    }

    if (iframe.getAttribute("data-current") === safe) return;
    iframe.setAttribute("data-current", safe);
    settled = false;

    function succeed() {
      if (settled) return;
      settled = true;
      show(iframe, true);
      show(fallback, false);
    }

    function fail() {
      if (settled) return;
      settled = true;
      show(iframe, false);
      show(fallback, true);
      iframe.src = "about:blank";
    }

    iframe.onload = function () {
      if (looksLive(iframe)) succeed();
    };
    iframe.onerror = function () {
      fail();
    };

    show(fallback, false);
    show(iframe, true);
    iframe.src = safe;

    global.setTimeout(function () {
      if (settled) return;
      if (looksLive(iframe)) succeed();
      else fail();
    }, 5000);
  }

  global.PulsePlayScore = { attach: attach };
})(window);
