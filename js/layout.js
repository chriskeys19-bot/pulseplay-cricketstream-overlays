/*
 * Logo and score placement for the 1920x1080 stage.
 * Device CSS is the 100% size. A ground layout multiplies that size and
 * nudges the anchor. A logo's own scale multiplies the slot again.
 * Missing layout means the current shipped sizes.
 * Age is top-left, the tournament logo is top-right, and CricketCrazeUSA
 * is bottom-right. The tournament logo shares the age logo's top inset and
 * the CricketCrazeUSA logo's right inset. Positive x moves right. Positive
 * y moves down. Ground rows store only those nudges and a scale, so this
 * anchor is what places the tournament logo on every ground.
 */
(function (global) {
  var BASE = {
    pro: {
      age: { left: 40, top: 20, w: 168, h: 84 },
      tournament: { right: 40, top: 20, w: 135, h: 105 },
      cricketcraze: { right: 40, bottom: 20, w: 190, h: 146 },
      score: { bottom: 28, w: 1560, h: 297 }
    },
    mini: {
      age: { left: 36, top: 18, w: 224, h: 112 },
      tournament: { right: 28, top: 18, w: 158, h: 123 },
      cricketcraze: { right: 28, bottom: 13, w: 220, h: 169 },
      score: { bottom: 20, w: 1734, h: 372 }
    }
  };
  var SLOTS = ["age", "tournament", "cricketcraze", "score"];

  function clamp(value, min, max) {
    var n = Number(value);
    if (isNaN(n)) n = min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function slotOrDefault(raw, name) {
    var src = raw || {};
    var slot = {
      scale: clamp(src.scale == null ? 1 : src.scale, 0.25, 2),
      x: Math.round(clamp(src.x || 0, -400, 400)),
      y: Math.round(clamp(src.y || 0, -400, 400))
    };
    var width;
    if (name === "score" && src.width != null && src.width !== "") {
      width = clamp(src.width, 0.5, 1);
      if (Math.abs(width - 1) > 0.001) slot.width = Math.round(width * 1000) / 1000;
    }
    return slot;
  }

  function normalize(raw) {
    var out = {};
    var i;
    for (i = 0; i < SLOTS.length; i++) out[SLOTS[i]] = slotOrDefault(raw && raw[SLOTS[i]], SLOTS[i]);
    return out;
  }

  function defaults() {
    return normalize(null);
  }

  function isDefault(raw) {
    var layout = normalize(raw);
    var i;
    var slot;
    for (i = 0; i < SLOTS.length; i++) {
      slot = layout[SLOTS[i]];
      if (slot.scale !== 1 || slot.x !== 0 || slot.y !== 0) return false;
      if (slot.width != null && Math.abs(slot.width - 1) > 0.001) return false;
    }
    return true;
  }

  function logoMultiplier(value) {
    if (value == null || value === "") return 1;
    return clamp(value, 0.25, 2);
  }

  function clearBox(el) {
    el.style.top = "auto";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.left = "auto";
    el.style.marginLeft = "0";
  }

  function placeLogo(el, base, slot, logoScale, anchor) {
    var scale;
    var w;
    var h;
    if (!el) return;
    scale = slot.scale * logoMultiplier(logoScale);
    w = Math.round(base.w * scale);
    h = Math.round(base.h * scale);
    clearBox(el);
    el.style.width = w + "px";
    el.style.height = h + "px";
    if (anchor === "top") {
      el.style.left = (base.left + slot.x) + "px";
      el.style.top = (base.top + slot.y) + "px";
      return;
    }
    if (anchor === "top-right") {
      el.style.right = (base.right - slot.x) + "px";
      el.style.top = (base.top + slot.y) + "px";
      return;
    }
    if (anchor === "bottom-right") {
      el.style.right = (base.right - slot.x) + "px";
      el.style.bottom = (base.bottom - slot.y) + "px";
    }
  }

  function placeScore(el, base, slot) {
    var w;
    var h;
    if (!el) return;
    w = Math.round(base.w * slot.scale);
    h = Math.round(base.h * slot.scale);
    clearBox(el);
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.style.left = "50%";
    el.style.marginLeft = Math.round(-w / 2 + slot.x) + "px";
    el.style.bottom = (base.bottom - slot.y) + "px";
  }

  function place(opts) {
    var device = opts && opts.device === "mini" ? "mini" : "pro";
    var base = BASE[device];
    var layout = normalize(opts && opts.layout);
    var scales = (opts && opts.scales) || {};
    placeLogo(opts.age, base.age, layout.age, scales.age, "top");
    placeLogo(opts.tournament, base.tournament, layout.tournament, scales.tournament, "top-right");
    placeLogo(opts.cricketcraze, base.cricketcraze, layout.cricketcraze, scales.cricketcraze, "bottom-right");
    placeScore(opts.score, base.score, layout.score);
  }

  global.PulsePlayLayout = {
    slots: SLOTS,
    normalize: normalize,
    defaults: defaults,
    isDefault: isDefault,
    logoMultiplier: logoMultiplier,
    place: place
  };
})(window);
