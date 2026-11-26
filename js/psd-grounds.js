/*
 * PSD grounds that host a different division in the morning and the afternoon.
 * CTS West and Sycamore 2 switch branding between the 8:30 AM and 1:30 PM games.
 * A built renderer URL for one of these grounds adds &session=am or &session=pm.
 * A stored short link is used as saved and does not gain a session parameter.
 */
(function (global) {
  var SPLIT_IDS = {
    ctsu11: true,
    sycamore2: true
  };
  var SPLIT_NAMES = {
    "cts west": true,
    "sycamore 2": true,
    sycamore2: true
  };

  function isSplit(ground) {
    var id;
    var name;
    if (!ground) return false;
    if (typeof ground === "string") {
      id = String(ground).replace(/^\s+|\s+$/g, "").toLowerCase();
      return SPLIT_IDS[id] === true || SPLIT_NAMES[id] === true;
    }
    id = String(ground.id || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    name = String(ground.name || "").replace(/^\s+|\s+$/g, "").toLowerCase();
    return SPLIT_IDS[id] === true || SPLIT_NAMES[name] === true;
  }

  global.PulsePlayPsdGrounds = { isSplit: isSplit };
})(window);
