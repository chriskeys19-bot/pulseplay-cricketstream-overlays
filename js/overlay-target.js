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

  global.PulsePlayDevice = {
    queryWithDevicePro: queryWithDevicePro,
    miniHref: miniHref,
    proNeedsNormalize: proNeedsNormalize,
    proHref: proHref,
    deviceLabel: deviceLabel,
    savedDevice: savedDevice,
    groundOptionLabel: groundOptionLabel,
    rendererQuery: rendererQuery,
    pagesRendererUrl: pagesRendererUrl
  };
})(window);
