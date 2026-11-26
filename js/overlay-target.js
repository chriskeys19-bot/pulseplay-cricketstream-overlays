/*
 * YoloBox Pro and YoloBox Ultra share renderer/pro.html and device=pro.
 * renderer/mini.html redirects there. A device=mini query on pro.html is
 * rewritten to device=pro. The stored value stays "pro"; "ultra" is not written.
 */
(function (global) {
  function decodePart(value) {
    try { return decodeURIComponent(String(value).replace(/\+/g, " ")); }
    catch (e) { return String(value); }
  }

  function queryWithDevicePro(search) {
    var raw = String(search || "");
    var q = raw.charAt(0) === "?" ? raw.substring(1) : raw;
    var parts = q.length ? q.split("&") : [];
    var kept = [];
    var placed = false;
    var i;
    var part;
    var eq;
    var key;
    for (i = 0; i < parts.length; i++) {
      part = parts[i];
      eq = part.indexOf("=");
      key = decodePart(eq === -1 ? part : part.substring(0, eq));
      if (key === "device") {
        if (!placed) {
          kept.push("device=pro");
          placed = true;
        }
        continue;
      }
      kept.push(part);
    }
    if (!placed) kept.push("device=pro");
    return "?" + kept.join("&");
  }

  function hashPart(hash) {
    var text;
    if (!hash) return "";
    text = String(hash);
    return text.charAt(0) === "#" ? text : "#" + text;
  }

  function miniHref(search, hash) {
    return "pro.html" + queryWithDevicePro(search) + hashPart(hash);
  }

  function deviceValues(search) {
    var raw = String(search || "");
    var q = raw.charAt(0) === "?" ? raw.substring(1) : raw;
    var parts = q.length ? q.split("&") : [];
    var values = [];
    var i;
    var part;
    var eq;
    var key;
    for (i = 0; i < parts.length; i++) {
      part = parts[i];
      eq = part.indexOf("=");
      key = decodePart(eq === -1 ? part : part.substring(0, eq));
      if (key === "device") values.push(decodePart(eq === -1 ? "" : part.substring(eq + 1)));
    }
    return values;
  }

  function proNeedsNormalize(search) {
    var values = deviceValues(search);
    var i;
    for (i = 0; i < values.length; i++) {
      if (String(values[i]).toLowerCase() === "mini") return true;
    }
    return false;
  }

  function proHref(pathname, search, hash) {
    return (pathname || "pro.html") + queryWithDevicePro(search) + hashPart(hash);
  }

  function deviceLabel() {
    return "YoloBox Pro / Ultra";
  }

  function savedDevice() {
    return "pro";
  }

  function groundOptionLabel(name) {
    return String(name || "") + " (" + deviceLabel() + ")";
  }

  function rendererQuery(groundId) {
    return "pro.html?ground=" + encodeURIComponent(groundId) + "&device=pro";
  }

  function pagesRendererUrl(origin, groundId) {
    return String(origin || "").replace(/\/+$/, "") + "/renderer/" + rendererQuery(groundId);
  }

  var PAGES_ORIGIN = "https://chriskeys19-bot.github.io/pulseplay-cricketstream-overlays";

  function httpUrl(value) {
    var text = String(value || "").replace(/^\s+|\s+$/g, "");
    if (!/^https?:\/\//i.test(text)) return "";
    return text;
  }

  function storedShortLink(ground) {
    return httpUrl(ground && ground.short_link);
  }

  function webOverlayUrl(ground, origin) {
    var shortLink = storedShortLink(ground);
    if (shortLink) return shortLink;
    if (!ground || !ground.id) return "";
    return pagesRendererUrl(origin || PAGES_ORIGIN, ground.id);
  }

  function overlayChoices(ground, origin) {
    var url;
    if (!ground) return [];
    url = webOverlayUrl(ground, origin);
    return url ? [{ label: "Web overlay", url: url }] : [];
  }

  function streamOverlayUrl(row, ground, origin) {
    var direct = httpUrl(row && row.overlay_url);
    if (direct) return direct;
    if (!ground) return "";
    return webOverlayUrl(ground, origin);
  }

  function buttonLabel(button) {
    if (!button || !button.getAttribute) return "Copy";
    return button.getAttribute("data-label") || "Copy";
  }

  function setButtonText(button, value) {
    if (!button) return;
    if (button.textContent !== undefined) button.textContent = value;
    else button.innerText = value;
  }

  function copyText(text, button) {
    var doc = global.document;
    var nav = global.navigator;
    function markCopied() {
      if (!button) return;
      if (button.copyTimer) global.clearTimeout(button.copyTimer);
      setButtonText(button, "Copied");
      if (button.classList) button.classList.add("is-copied");
      button.copyTimer = global.setTimeout(function () {
        setButtonText(button, buttonLabel(button));
        if (button.classList) button.classList.remove("is-copied");
      }, 1600);
    }
    function fallback() {
      var area;
      var copied = false;
      if (!doc || !doc.body || !doc.createElement) return;
      area = doc.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "readonly");
      area.style.position = "fixed";
      area.style.top = "0";
      area.style.left = "0";
      area.style.width = "1px";
      area.style.height = "1px";
      area.style.opacity = "0";
      area.style.fontSize = "16px";
      doc.body.appendChild(area);
      if (area.focus) area.focus();
      if (area.select) area.select();
      if (area.setSelectionRange) area.setSelectionRange(0, area.value.length);
      try { copied = doc.execCommand("copy"); } catch (e) { copied = false; }
      doc.body.removeChild(area);
      if (copied) markCopied();
    }
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      nav.clipboard.writeText(text).then(markCopied).catch(fallback);
      return;
    }
    fallback();
  }

  global.PulsePlayDevice = {
    queryWithDevicePro: queryWithDevicePro,
    miniHref: miniHref,
    proNeedsNormalize: proNeedsNormalize,
    proHref: proHref,
    deviceLabel: deviceLabel,
    savedDevice: savedDevice,
    groundOptionLabel: groundOptionLabel,
    rendererQuery: rendererQuery,
    pagesRendererUrl: pagesRendererUrl,
    httpUrl: httpUrl,
    storedShortLink: storedShortLink,
    webOverlayUrl: webOverlayUrl,
    overlayChoices: overlayChoices,
    streamOverlayUrl: streamOverlayUrl,
    copyText: copyText
  };
})(window);
